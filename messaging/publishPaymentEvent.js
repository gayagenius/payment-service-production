import { publish } from './queueSetup.js';

/**
 * Publishes a payment event to the RabbitMQ queue.
 * @param {string} eventType - The type of event, e.g. "payment_initiated"
 * @param {Object} payload - The payment data payload
 */
export const publishPaymentEvent = (eventType, payload) => {
  const eventPayload = {
    eventType,
    timestamp: new Date().toISOString(),
    ...payload,
  };

  publish(eventType, eventPayload);
  console.log(`Event published: ${eventType}`);
};
