import { vi, describe, it, expect } from 'vitest';
import { publishPaymentEvent } from '../../messaging/publishPaymentEvent.js';
import { publish } from '../../messaging/queueSetup.js';

vi.mock('../../messaging/queueSetup.js', () => ({
  connect: vi.fn(),
  publish: vi.fn(),
}));

describe('publishPaymentEvent', () => {
  it('should call the publish function with the correct payload', () => {
    const mockPayload = {
      paymentId: 'pay_123',
      orderId: 'ord_456',
      userId: 'user_789',
      amount: 1000,
      status: 'initiated',
      correlationId: 'corr_xyz',
    };
    const expectedPayload = {
      eventType: 'payment_initiated',
      timestamp: expect.any(String),
      ...mockPayload,
    };

    publishPaymentEvent('payment_initiated', mockPayload);

    expect(publish).toHaveBeenCalledWith('payment_initiated', expectedPayload);
  });
});
