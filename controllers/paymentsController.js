import { createPaymentIntent, confirmPaymentIntent, cancelPaymentIntent } from "../integrations/stripeClient.js";
import { mapStripeStatus } from "../services/statusMap.js";
import db from "../db/index.js"; // your Postgres client/pool

// ---------------------------
// CREATE PAYMENT
// ---------------------------
async function createPayment(req, res) {
  const { userId, orderId, amount, currency, metadata = {}, phone, paymentMethodId } = req.body;
  const idempotencyKey = req.headers["idempotency-key"];

  if (!userId || !orderId || !amount || !currency) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Missing required fields",
        details: "userId, orderId, amount, and currency are required",
      },
    });
  }

  try {
    // 1️⃣ Create PaymentIntent in Stripe
    const pi = await createPaymentIntent(userId, orderId, amount, currency, idempotencyKey);

    // 2️⃣ Insert into payments table (lean schema)
    const result = await db.query(
      `INSERT INTO payments (
        user_id, order_id, amount, currency, status, idempotency_key, gateway_response, payment_method_id, metadata, phone
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id`,
      [
        userId,
        orderId,
        amount,
        currency,
        "PENDING",
        idempotencyKey,
        pi,               // Stripe response as JSONB
        paymentMethodId || null,
        metadata,
        phone || null,
      ]
    );

    const paymentId = result.rows[0].id;

    // ✅ Trigger automatically populates payment_history

    res.json({
      success: true,
      paymentId,
      stripeId: pi.id,
      clientSecret: pi.client_secret,
      status: mapStripeStatus(pi.status),
    });
  } catch (err) {
    console.error("❌ Error creating payment:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ---------------------------
// CONFIRM PAYMENT
// ---------------------------
async function confirmPayment(req, res) {
  const { paymentIntentId, paymentMethodId } = req.body;
  const idempotencyKey = req.headers["idempotency-key"];

  if (!paymentIntentId || !paymentMethodId) {
    return res.status(400).json({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "paymentIntentId and paymentMethodId are required",
      },
    });
  }

  try {
    // 1️⃣ Confirm PaymentIntent in Stripe
    const pi = await confirmPaymentIntent(paymentIntentId, paymentMethodId, idempotencyKey);

    // 2️⃣ Update payment status in DB
    const result = await db.query(
      `UPDATE payments
       SET status = $1, gateway_response = $2, updated_at = now()
       WHERE gateway_response->>'id' = $3
       RETURNING id`,
      [mapStripeStatus(pi.status), pi, paymentIntentId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Payment not found" });
    }

    // ✅ Trigger automatically populates payment_history

    res.json({
      success: true,
      paymentId: result.rows[0].id,
      stripeId: pi.id,
      status: mapStripeStatus(pi.status),
      nextAction: pi.next_action || null,
    });
  } catch (err) {
    console.error("❌ Error confirming payment:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}

// ---------------------------
// CANCEL PAYMENT
// ---------------------------
async function cancelPayment(req, res) {
  const { paymentIntentId } = req.body;
  const idempotencyKey = req.headers["idempotency-key"];

  if (!paymentIntentId) {
    return res.status(400).json({
      success: false,
      error: { code: "VALIDATION_ERROR", message: "paymentIntentId is required" },
    });
  }

  try {
    // 1️⃣ Cancel PaymentIntent in Stripe
    const pi = await cancelPaymentIntent(paymentIntentId, idempotencyKey);

    // 2️⃣ Update payment status in DB
    const result = await db.query(
      `UPDATE payments
       SET status = $1, gateway_response = $2, updated_at = now()
       WHERE gateway_response->>'id' = $3
       RETURNING id`,
      [mapStripeStatus(pi.status), pi, paymentIntentId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Payment not found" });
    }

    res.json({
      success: true,
      paymentId: result.rows[0].id,
      stripeId: pi.id,
      status: mapStripeStatus(pi.status),
    });
  } catch (err) {
    console.error("❌ Error canceling payment:", err);
    res.status(500).json({ success: false, error: err.message });
  }
}

export default { createPayment, confirmPayment, cancelPayment };
