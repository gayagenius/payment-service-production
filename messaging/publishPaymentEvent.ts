import { publish } from './queueSetup.js';

export interface PaymentPayload {
  paymentId: string;
  orderId: string;
  userId: string;
  amount: number;
  status: string;
  correlationId: string;
}

/**
 * Publishes a payment event to the RabbitMQ queue.
 * @param eventType - The type of event, e.g. "payment_initiated"
 * @param payload - The payment data payload
 */
export const publishPaymentEvent = (
  eventType: string,
  payload: PaymentPayload
): void => {
  const eventPayload = {
    eventType,
    timestamp: new Date().toISOString(),
    ...payload,
  };

  publish(eventType, eventPayload);
  console.log(`Event published: ${eventType}`);
};
