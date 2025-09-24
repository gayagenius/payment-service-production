import { publish, connect } from '../messaging/queueSetup.js';
import { initializeTransaction, verifyTransaction } from '../src/services/paystackGateway.js';
import { createCircuitBreaker } from '../utils/circuitBreaker.js';
import { retry } from '../utils/retry.js';
import { publishPaymentEvent } from '../messaging/publishPaymentEvent.js';

const PAYSTACK_CHARGE_QUEUE = process.env.PAYSTACK_CHARGE_QUEUE || 'paystack_charge_queue';
const PAYSTACK_WEBHOOK_QUEUE = process.env.PAYSTACK_WEBHOOK_QUEUE || 'paystack_webhook_events';
const PAYMENT_EVENTS_EXCHANGE = process.env.PAYMENT_EVENTS_EXCHANGE || 'payment_events';
const MAX_RETRIES = Number(process.env.PAYSTACK_WORKER_MAX_RETRIES || 3);

async function handleChargeJob(job) {
  // { paymentId, orderId, userId, amount, currency, idempotencyKey, email, metadata }
  const { paymentId, orderId, userId, amount, idempotencyKey, email, metadata = {}, reference } = job;

  const init = await initializeTransaction({ amount, email, metadata, reference });
  return init;
}

const breaker = createCircuitBreaker(async (job) => handleChargeJob(job), {
  timeout: 15000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000,
});

breaker.on('open', () => console.warn('[paystackWorker] Circuit breaker OPEN'));
breaker.on('close', () => console.info('[paystackWorker] Circuit breaker CLOSED'));
breaker.on('halfOpen', () => console.info('[paystackWorker] Circuit breaker HALF_OPEN'));

async function consumeQueue(queueName, channel) {
  await channel.assertQueue(queueName, { durable: true });
  channel.prefetch(Number(process.env.PAYSTACK_WORKER_PREFETCH || 5));

  channel.consume(queueName, async (msg) => {
    if (!msg) return;
    let job;
    try {
      job = JSON.parse(msg.content.toString());
    } catch (err) {
      console.error('[paystackWorker] invalid job payload', err);
      channel.ack(msg);
      return;
    }

    try {
      const resp = await retry(async () => breaker.fire(job), {
        retries: MAX_RETRIES,
        factor: 2,
        minTimeout: 500,
        maxTimeout: 10000,
      });

      // Publish a business event
      await publishPaymentEvent('payment_initiated', {
        paymentId: job.paymentId,
        orderId: job.orderId,
        userId: job.userId,
        amount: job.amount,
        status: 'pending',
        correlationId: job.correlationId,
      });

      // ack
      channel.ack(msg);
    } catch (err) {
      console.error('[paystackWorker] job failed', err);
      channel.nack(msg, false, false); 
    }
  }, { noAck: false });
}

async function start() {
  const conn = await connect();
  const channel = await conn.createChannel();

  await channel.assertQueue(PAYSTACK_CHARGE_QUEUE, { durable: true });
  await channel.assertQueue(PAYSTACK_WEBHOOK_QUEUE, { durable: true });

  await consumeQueue(PAYSTACK_CHARGE_QUEUE, channel);
  await consumeQueue(PAYSTACK_WEBHOOK_QUEUE, channel);

  console.info('[paystackWorker] started and consuming queues');
}

if (process.env.NODE_ENV !== 'test') {
  start().catch((err) => {
    console.error('[paystackWorker] failed to start', err);
    process.exit(1);
  });
}

export default { start };
