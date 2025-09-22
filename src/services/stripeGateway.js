import stripe from './stripeClient.js';
/**
  Stripe PaymentIntent (wrapper)
 * @param {Object} opts
 * @param {number} opts.amount - integer (cents)
 * @param {string} opts.currency - ISO 3-letter
 * @param {Object} [opts.metadata]
 * @param {string} [opts.idempotencyKey]
 */
export async function createPaymentIntent({ amount, currency = 'USD', metadata = {}, idempotencyKey } = {}) {
  const params = {
    amount,
    currency,
    metadata,
  };

  const intent = await stripe.paymentIntents.create(params, {
    idempotencyKey,
  });

  return intent;
}

/**
 * Refund a charge
 * @param {Object} opts
 * @param {string} opts.chargeId
 * @param {number} [opts.amount]
 * @param {string} [opts.idempotencyKey]
 */
export async function refundCharge({ chargeId, amount, idempotencyKey } = {}) {
  const params = {
    charge: chargeId,
  };
  if (typeof amount === 'number') params.amount = amount;

  const refund = await stripe.refunds.create(params, {
    idempotencyKey,
  });

  return refund;
}


/**
 * Construct and verify Stripe webhook event 
 * @param {Buffer} rawBody - raw request body
 * @param {string} signature - Stripe signature header
 * @param {string} secret - webhook signing secret
 * @returns {Object} Stripe event
 */
export function constructWebhookEvent(rawBody, signature, secret) {
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}