import { publish } from "./queueSetup.js";

/**
 * Publishes a payment event to the RabbitMQ queue.
 * @param {string} eventType - The type of event type e.g payment_iniatiated
 * @param {object} payload - The payment data payload.
 */
export const publishPaymentEvent = (eventType, { paymentId, orderId, userId, amount, status, correlationId }) => {
  const eventPayload = {
    eventType,
    timestamp: new Date().toISOString(),
    paymentId,
    orderId,
    userId,
    amount,
    status,
    correlationId
  };

  publish(eventType, eventPayload);
  console.log(`Event published: ${eventType}`);
};