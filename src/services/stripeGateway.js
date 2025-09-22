// src/services/stripeGateway.js
// High-level stripe operations used by workers/services.
// Keep calls idempotent by passing idempotencyKey in options.

import stripe from './stripeClient.js';

/**
 * Create a Payment Intent (or Charge depending on your flow).
 * amount: integer (minor units)
 * currency: string
 * metadata: object
 * idempotencyKey: string
 */
export async function createPaymentIntent({ amount, currency = 'usd', metadata = {}, idempotencyKey }) {
  const params = {
    amount,
    currency,
    metadata,
    payment_method_types: ['card'],
    // optionally set capture_method: 'manual' if you want separate capture flow
  };

  const result = await stripe.paymentIntents.create(params, { idempotencyKey });
  return result;
}

/**
 * Capture a paymentIntent (if you used manual capture)
 */
export async function capturePaymentIntent(paymentIntentId, { idempotencyKey } = {}) {
  return stripe.paymentIntents.capture(paymentIntentId, {}, { idempotencyKey });
}

/**
 * Refund a charge (chargeId is stripe charge id)
 */
export async function refundCharge({ chargeId, amount, idempotencyKey }) {
  const opts = {};
  if (idempotencyKey) opts.idempotencyKey = idempotencyKey;
  return stripe.refunds.create({ charge: chargeId, amount }, opts);
}

/**
 * Verify a webhook signature and return the parsed event.
 * Throws on invalid signature.
 */
export function constructWebhookEvent(rawBody, sigHeader, webhookSecret) {
  return stripe.webhooks.constructEvent(rawBody, sigHeader, webhookSecret);
}
