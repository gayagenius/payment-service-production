import client from 'prom-client';

const registry = client.register;

// Histogram for Stripe request latencies
export const stripeRequestDuration = new client.Histogram({
  name: 'stripe_request_duration_seconds',
  help: 'Stripe API request duration in seconds',
  labelNames: ['operation', 'status'],
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 5],
});

// Counter for Stripe errors
export const stripeErrorsTotal = new client.Counter({
  name: 'stripe_errors_total',
  help: 'Total number of Stripe errors',
  labelNames: ['operation', 'error_type'],
});

// Counter for processed webhook events
export const stripeWebhookEventsProcessed = new client.Counter({
  name: 'stripe_webhook_events_processed_total',
  help: 'Total number of stripe webhook events processed',
  labelNames: ['event_type', 'result'],
});

export function getMetrics() {
  return registry.metrics();
}
