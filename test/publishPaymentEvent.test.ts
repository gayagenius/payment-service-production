import { vi, describe, it, expect } from 'vitest';
import { publishPaymentEvent } from '../messaging/publishPaymentEvent.js';
import * as queueSetup from '../messaging/queueSetup.js';

vi.mock('../messaging/queueSetup.js', () => ({
  connect: vi.fn(),
  publish: vi.fn(),
}));

const mockedQueueSetup = vi.mocked(queueSetup);

describe('publishPaymentEvent', () => {
  it('should call publish with the correct payload', () => {
    const mockPayload = {
      paymentId: 'pay_123',
      orderId: 'ord_456',
      userId: 'user_789',
      amount: 1000,
      status: 'initiated',
      correlationId: 'corr_xyz',
    };

    publishPaymentEvent('payment_initiated', mockPayload);

    expect(mockedQueueSetup.publish).toHaveBeenCalledTimes(1);

    const [eventType, payload] = mockedQueueSetup.publish.mock.calls[0];

    expect(eventType).toBe('payment_initiated');
    expect(payload).toMatchObject({
      eventType: 'payment_initiated',
      ...mockPayload,
    });
    expect(typeof payload.timestamp).toBe('string');
    expect(new Date(payload.timestamp).toISOString()).toBe(payload.timestamp);
  });
});
