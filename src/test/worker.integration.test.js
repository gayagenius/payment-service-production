// tests/worker.integration.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock messaging to simulate subscribing and publishing
const mockSubscribe = vi.fn();
const mockPublish = vi.fn();
vi.mock('../messaging/queueSetup.js', () => ({
  subscribe: (topic, handler) => {
    mockSubscribe(topic, handler);
    // return consumerTag-like object
    return Promise.resolve();
  },
  publish: mockPublish,
  PAYMENT_TOPICS: { PAYMENT_INITIATED: 'payment_initiated', PAYMENT_COMPLETED: 'payment_completed' },
}));

// mock stripeGateway createPaymentIntent
vi.mock('../src/services/stripeGateway.js', () => ({
  createPaymentIntent: vi.fn().mockResolvedValue({ id: 'pi_test', status: 'succeeded' }),
}));

// import the worker module (it should register subscribe when loaded)
import stripeWorkerModule from '../workers/stripeWorker.js';
import { createPaymentIntent } from '../src/services/stripeGateway.js';
import { i } from 'vitest/dist/reporters-w_64AS5f.js';
import { PAYMENT_TOPICS } from '../messaging/queueSetup.js';

describe('stripeWorker light integration', () => {
  it('registers subscription and publishes payment_completed on successful stripe call', async () => {
    // find the handler that subscribe was called with
    expect(mockSubscribe).toHaveBeenCalled();

    // get handler from first call
    const [topic, handler] = mockSubscribe.mock.calls[0];

    // simulate a queue message payload
    const job = {
      paymentId: 'pay_1',
      orderId: 'ord_1',
      userId: 'user_1',
      amount: 1000,
      currency: 'usd',
      idempotencyKey: 'idem_1',
    };

    // call handler like subscribe would do — in your subscribe implementation handler(payload, msg)
    // The handler in stripeWorker likely acknowledges with channel. To keep this test light, call only the logic part if exposed.
    // Here we try to call handler(job). If handler expects (payload, msg), pass minimal msg-like object.
    const fakeMsg = { properties: {}, fields: {}, content: Buffer.from(JSON.stringify(job)) };

    // If your subscribe wrapper passes 'payload' not raw message, adapt accordingly
    // Attempt to call handler with parsed payload
    await handler(job); // if handler signature (payload) this should work

    expect(createPaymentIntent).toHaveBeenCalledWith(expect.objectContaining({ amount: job.amount, idempotencyKey: job.idempotencyKey }));
    expect(mockPublish).toHaveBeenCalledWith('payment_completed', expect.any(Object));
  });
});
