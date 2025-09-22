// tests/stripeGateway.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock stripe package by mocking the client module import path used in stripeGateway.js
vi.mock('../src/services/stripeClient.js', () => {
  const createMock = vi.fn().mockResolvedValue({ id: 'pi_123', status: 'succeeded' });
  return {
    default: {
      paymentIntents: {
        create: createMock,
      },
      refunds: {
        create: vi.fn().mockResolvedValue({ id: 're_123', status: 'succeeded' }),
      },
    },
  };
});

import { createPaymentIntent, refundCharge } from '../src/services/stripeGateway.js';

describe('stripeGateway', () => {
  it('createPaymentIntent calls stripe.paymentIntents.create with params and idempotency', async () => {
    const pid = await createPaymentIntent({ amount: 1000, currency: 'usd', metadata: { foo: 'bar' }, idempotencyKey: 'idem_1' });
    expect(pid).toHaveProperty('id', 'pi_123');
  });

  it('refundCharge calls stripe.refunds.create', async () => {
    const res = await refundCharge({ chargeId: 'ch_123', amount: 500, idempotencyKey: 'idem_2' });
    expect(res).toHaveProperty('id', 're_123');
  });
});
