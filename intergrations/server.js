require("dotenv").config();
import express, { raw } from "express";
import { json } from "body-parser";
import { createPaymentIntent, confirmPaymentIntent, cancelPaymentIntent } from "./integrations/stripeClient";
import { mapStripeStatus } from "./services/statusMap";

const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

const app = express();

// JSON parser for normal routes
app.use("/payments", json());

// Stripe webhook must use raw body
app.post(
  "/webhook",
  raw({ type: "application/json" }),
  (req, res) => {
    let event = req.body;

    if (endpointSecret) {
      const signature = req.headers["stripe-signature"];
      try {
        event = stripe.webhooks.constructEvent(
          req.body,
          signature,
          endpointSecret
        );
      } catch (err) {
        console.error("⚠️ Webhook signature verification failed.", err.message);
        return res.sendStatus(400);
      }
    }

    // Handle events
    switch (event.type) {
      case "payment_intent.succeeded":
        const paymentIntent = event.data.object;
        console.log(
          `✅ PaymentIntent for ${paymentIntent.amount} succeeded!`
        );
        // TODO: update DB / notify Order Service
        break;
      case "payment_intent.payment_failed":
        console.log("❌ Payment failed");
        break;
      default:
        console.log(`Unhandled event type ${event.type}`);
    }

    res.send(); // ack
  }
);

// --- Normal API routes ---
app.post("/payments", async (req, res) => {
  const { userId, orderId, amount, currency } = req.body;
  const idempotencyKey = req.header("Idempotency-Key");

  try {
    const pi = await createPaymentIntent(
      userId,
      orderId,
      amount,
      currency,
      idempotencyKey
    );
    res.json({
      id: pi.id,
      status: mapStripeStatus(pi.status),
      clientSecret: pi.client_secret,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/payments/confirm", async (req, res) => {
  const { paymentIntentId, paymentMethodId } = req.body;
  const idempotencyKey = req.header("Idempotency-Key");

  try {
    const pi = await confirmPaymentIntent(
      paymentIntentId,
      paymentMethodId,
      idempotencyKey
    );
    res.json({
      id: pi.id,
      status: mapStripeStatus(pi.status),
      nextAction: pi.next_action || null,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.post("/payments/cancel", async (req, res) => {
  const { paymentIntentId } = req.body;
  const idempotencyKey = req.header("Idempotency-Key");

  try {
    const pi = await cancelPaymentIntent(
      paymentIntentId,
      idempotencyKey
    );
    res.json({ id: pi.id, status: mapStripeStatus(pi.status) });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

const port = process.env.PORT || 4242;
app.listen(port, () => console.log(`🚀 Payment service running on port ${port}`));
