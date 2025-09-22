// workers/stripeWorker.js
// Consumer that handles stripe_charge_queue and stripe_webhook_events
// This worker implements: circuit-breaker + retry + publish events to payment_events exchange

import { publish, connect } from '../messaging/queueSetup.js';
import { createPaymentIntent, refundCharge } from '../src/services/stripeGateway.js';
import { createCircuitBreaker } from '../utils/circuitBreaker.js';
import { retry } from '../utils/retry.js';
import { publishPaymentEvent } from '../messaging/publishPaymentEvent.js';
import { maskGatewayResponse } from '../utils/gatewayMasker.js'; // optional util to mask responses

const STRIPE_CHARGE_QUEUE = process.env.STRIPE_CHARGE_QUEUE || 'stripe_charge_queue';
const STRIPE_WEBHOOK_QUEUE = process.env.STRIPE_WEBHOOK_QUEUE || 'stripe_webhook_events';
const PAYMENT_EVENTS_EXCHANGE = process.env.PAYMENT_EVENTS_EXCHANGE || 'payment_events';
const MAX_RETRIES = Number(process.env.STRIPE_WORKER_MAX_RETRIES || 3);

async function handleChargeJob(job) {
  // job expected shape:
  // { paymentId, orderId, userId, amount, currency, idempotencyKey, metadata, paymentIntentId? }
  const { paymentId, orderId, userId, amount, currency, idempotencyKey, metadata = {} } = job;

  // Create payment intent (idempotent on stripe side via idempotencyKey)
  const result = await createPaymentIntent({ amount, currency, metadata, idempotencyKey });
  return result;
}

// Circuit breaker around handleChargeJob to protect Stripe
const breaker = createCircuitBreaker(async (job) => {
  return handleChargeJob(job);
}, {
  timeout: 15000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
});

breaker.on('open', () => {
  console.warn('[stripeWorker] Circuit breaker OPEN - will short-circuit Stripe calls');
});
breaker.on('close', () => {
  console.info('[stripeWorker] Circuit breaker CLOSED');
});
breaker.on('halfOpen', () => {
  console.info('[stripeWorker] Circuit breaker HALF_OPEN');
});

async function consumeQueue(queueName, channel) {
  await channel.assertQueue(queueName, { durable: true });

  channel.prefetch(Number(process.env.STRIPE_WORKER_PREFETCH || 5));

  channel.consume(queueName, async (msg) => {
    if (!msg) return;
    const raw = msg.content.toString();
    let job;
    try {
      job = JSON.parse(raw);
    } catch (err) {
      console.error('[stripeWorker] invalid job payload', err);
      // drop bad message (ack) or send to DLQ depending on policy
      channel.ack(msg);
      return;
    }

    try {
      // Retry wrapper with exponential backoff
      const stripeResp = await retry(async () => {
        // If circuit breaker is open, opossum will throw fast
        return breaker.fire(job);
      }, {
        retries: MAX_RETRIES,
        factor: 2,
        minTimeout: 500,
        maxTimeout: 10000,
      });

      // Map stripe response to DB update + publish events
      // Mask gateway response before storing/publishing
      const masked = maskGatewayResponse ? maskGatewayResponse(stripeResp) : { id: stripeResp.id, status: stripeResp.status };

      // Publish business event to exchange that Order & User services consume
      await publishPaymentEvent('payment_completed', {
        paymentId: job.paymentId,
        orderId: job.orderId,
        userId: job.userId,
        amount: job.amount,
        currency: job.currency,
        gateway: 'stripe',
        gatewayResponse: masked,
        stripeRaw: { id: stripeResp.id, status: stripeResp.status },
      });

      // Acknowledge job
      channel.ack(msg);
    } catch (err) {
      console.error('[stripeWorker] job failed', err);

      // If job has attempts metadata, increment and requeue with backoff, else move to DLQ after retries.
      // Here we use a simple nack without requeue → rely on dead-letter config in broker to move message to retry queue/DLQ.
      // Prefer broker-level DLQ & retry setup (delayed retries via headers).
      channel.nack(msg, false, false);
    }
  }, { noAck: false });
}

async function start() {
  const conn = await connect();
  const channel = await conn.createChannel();

  // Ensure queues exist
  await channel.assertQueue(STRIPE_CHARGE_QUEUE, { durable: true });
  await channel.assertQueue(STRIPE_WEBHOOK_QUEUE, { durable: true });

  // optionally create exchanges / bindings here if needed

  // consume both queues — webhook events may be processed to create charges, refunds etc.
  await consumeQueue(STRIPE_CHARGE_QUEUE, channel);
  await consumeQueue(STRIPE_WEBHOOK_QUEUE, channel);

  console.info('[stripeWorker] started and consuming queues');
}

// run if executed directly
if (process.env.NODE_ENV !== 'test') {
  start().catch((err) => {
    console.error('[stripeWorker] failed to start', err);
    process.exit(1);
  });
}

export default { start };
