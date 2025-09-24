import express from "express";
import crypto from "crypto";
import { publish } from "../../messaging/queueSetup.js";
import { validateEventSchema } from "../../utils/validateEventSchema.js";
import { createCircuitBreaker } from "../../utils/circuitBreaker.js";

const router = express.Router();

const PAYSTACK_WEBHOOK_QUEUE =
  process.env.PAYSTACK_WEBHOOK_QUEUE || "paystack_webhook_events";
const PAYSTACK_EVENT_TOPIC = "paystack.webhook.received";

const webhookCircuitBreaker = createCircuitBreaker(
  async (payload, signature) => {
    return await processWebhookWithRetry(payload, signature);
  },
  {
    timeout: 10000,
    errorThresholdPercentage: 50,
    resetTimeout: 30000,
  }
);


export const verifyPaystackSignature = (rawBody, signature, secret) => {
  if (!secret || !signature || !rawBody) return false;
  try {
    const hash = crypto
      .createHmac("sha512", secret)
      .update(rawBody)
      .digest("hex");

    // defensive: ensure both are strings and lowercase hex
    const provided = signature.toString().trim().toLowerCase();
    const computed = hash.toString().trim().toLowerCase();

    // debug logs (remove or reduce in prod)
    console.debug(
      "[Webhook][verify] provided signature len=%d computed len=%d",
      provided.length,
      computed.length
    );
    if (provided.length !== computed.length) {
      console.warn("[Webhook][verify] signature length mismatch", {
        providedLen: provided.length,
        computedLen: computed.length,
      });
      return false;
    }

    // use timingSafeEqual on Buffers of same length
    const ok = crypto.timingSafeEqual(
      Buffer.from(provided, "utf8"),
      Buffer.from(computed, "utf8")
    );
    return ok;
  } catch (err) {
    console.error("Signature verification error:", err);
    return false;
  }
};

export const parseWebhookPayload = (rawBody) => {
  try {
    const payload = JSON.parse(rawBody.toString());

    // Basic validation
    if (!payload.event || !payload.data) {
      throw new Error("Invalid webhook payload: missing event or data");
    }

    return payload;
  } catch (error) {
    throw new Error(`Failed to parse webhook payload: ${error.message}`);
  }
};

/**
 * Map Paystack event to internal event type
 */
export const mapPaystackEvent = (paystackEvent) => {
  const eventMap = {
    "charge.success": "payment_succeeded",
    "charge.failed": "payment_failed",
    "charge.authorized": "payment_authorized",
    "refund.processed": "refund_processed",
    "transfer.success": "transfer_succeeded",
    "transfer.failed": "transfer_failed",
  };

  return eventMap[paystackEvent] || "unknown_event";
};

/**
 * Extract idempotency key from webhook payload
 */
export const extractIdempotencyKey = (payload) => {
  return (
    payload.data?.reference ||
    payload.data?.id?.toString() ||
    `paystack_${payload.event}_${Date.now()}`
  );
};

// Use raw body middleware for signature verification
router.post(
  "/paystack",
  express.raw({ type: "application/json", limit: "10mb" }),
  async (req, res) => {
    const startTime = Date.now();
    const correlationId =
      req.headers["x-request-id"] ||
      req.headers["x-correlation-id"] ||
      `webhook_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    // Log incoming webhook
    console.log(`[Webhook][${correlationId}] Received Paystack webhook`, {
      event: req.headers["x-paystack-signature"] ? "present" : "missing",
      ip: req.ip,
      userAgent: req.get("User-Agent"),
    });

    const signature = req.headers["x-paystack-signature"];
    const secret =
      process.env.PAYSTACK_WEBHOOK_SECRET || process.env.PAYSTACK_SECRET_KEY;

    // Validate required configuration
    if (!secret) {
      console.error(
        `[Webhook][${correlationId}] Webhook secret not configured`
      );
      return res.status(500).json({
        error: "Webhook not configured",
        correlationId,
      });
    }

    if (!signature) {
      console.warn(`[Webhook][${correlationId}] Missing signature header`);
      return res.status(400).json({
        error: "Missing signature header",
        correlationId,
      });
    }

    try {
      // Verify signature
      const isValidSignature = verifyPaystackSignature(
        req.body,
        signature,
        secret
      );
      if (!isValidSignature) {
        console.warn(`[Webhook][${correlationId}] Invalid signature`);
        return res.status(400).json({
          error: "Invalid signature",
          correlationId,
        });
      }

      // Parse payload
      const payload = parseWebhookPayload(req.body);
      const internalEventType = mapPaystackEvent(payload.event);
      const idempotencyKey = extractIdempotencyKey(payload);

      // Create webhook event message
      const webhookEvent = {
        eventType: internalEventType,
        payload: payload,
        metadata: {
          correlationId,
          idempotencyKey,
          receivedAt: new Date().toISOString(),
          signature: signature.substring(0, 16) + "...", // Log partial for security
        },
      };

      // Validate against schema
      const schemaName =
        internalEventType !== "unknown_event"
          ? internalEventType
          : "paystack_webhook";
      const validation = validateEventSchema(schemaName, webhookEvent);

      if (!validation.valid) {
        console.warn(
          `[Webhook][${correlationId}] Schema validation failed for ${schemaName}:`,
          validation.errors
        );
        return res.status(400).json({
          error: "Invalid webhook payload structure",
          details: validation.errors,
          correlationId,
        });
      }

      // Publish to queue with circuit breaker
      await webhookCircuitBreaker.fire(webhookEvent, signature);

      console.log(`[Webhook][${correlationId}] Successfully processed`, {
        eventType: internalEventType,
        idempotencyKey,
        processingTime: Date.now() - startTime,
      });

      return res.status(200).json({
        received: true,
        event: internalEventType,
        correlationId,
      });
    } catch (error) {
      console.error(
        `[Webhook][${correlationId}] Webhook processing error:`,
        error
      );

      // Determine appropriate status code
      let statusCode = 500;
      if (
        error.message.includes("parse") ||
        error.message.includes("Invalid")
      ) {
        statusCode = 400;
      }

      return res.status(statusCode).json({
        error: "Webhook processing failed",
        message: error.message,
        correlationId,
      });
    }
  }
);

/**
 * Process webhook with retry logic for queue publishing
 */
async function processWebhookWithRetry(webhookEvent, signature) {
  const maxRetries = 3;
  const baseDelay = 1000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const messageBody = {
        payload: {
          // keep old structure but namespace it as `payload` for consumer
          eventType: webhookEvent.eventType,
          payload: webhookEvent.payload,
        },
        metadata: webhookEvent.metadata,
      };

      await publish(PAYSTACK_EVENT_TOPIC, messageBody, {
        persistent: true,
        messageId: webhookEvent.metadata.idempotencyKey,
        correlationId: webhookEvent.metadata.correlationId,
        headers: {
          "x-webhook-type": "paystack",
          "x-attempt": attempt,
          "x-original-signature": signature.substring(0, 16) + "...",
        },
      });

      console.log(
        `[Webhook] Successfully published to queue on attempt ${attempt}`
      );
      return;
    } catch (error) {
      if (attempt === maxRetries) {
        throw new Error(
          `Failed to publish webhook after ${maxRetries} attempts: ${error.message}`
        );
      }

      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt - 1) + Math.random() * 1000;
      console.warn(
        `[Webhook] Queue publish failed on attempt ${attempt}, retrying in ${delay}ms:`,
        error.message
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export default router;
