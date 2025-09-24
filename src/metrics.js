import client from 'prom-client';
import { context, trace } from '@opentelemetry/api';

// --------------------
// Prometheus Registry
// --------------------
export const register = new client.Registry();

// Default Node.js metrics (CPU, memory, GC, etc.)
client.collectDefaultMetrics({ register });

// --------------------
// HTTP Request Counter
// --------------------
export const httpRequestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total number of HTTP requests',
  labelNames: ['method', 'route', 'status', 'trace_id'] // added trace_id
});
register.registerMetric(httpRequestCounter);

// --------------------
// Request Duration Histogram
// --------------------
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status', 'trace_id'], // added trace_id
  buckets: [0.01, 0.05, 0.1, 0.3, 0.5, 1, 2, 5]
});
register.registerMetric(httpRequestDuration);

// --------------------
// Business Metrics
// --------------------
export const paymentsSuccess = new client.Counter({
  name: 'payments_success_total',
  help: 'Total successful payments',
  labelNames: ['method', 'route', 'trace_id']
});
export const paymentsFailed = new client.Counter({
  name: 'payments_failed_total',
  help: 'Total failed payments',
  labelNames: ['method', 'route', 'trace_id']
});
export const refundsTotal = new client.Counter({
  name: 'refunds_total',
  help: 'Total refunds processed',
  labelNames: ['method', 'route', 'trace_id']
});
export const paymentAmount = new client.Histogram({
  name: 'payment_amount_usd',
  help: 'Distribution of payment amounts (USD)',
  labelNames: ['method', 'route', 'trace_id'],
  buckets: [1, 10, 50, 100, 500, 1000, 5000]
});

register.registerMetric(paymentsSuccess);
register.registerMetric(paymentsFailed);
register.registerMetric(refundsTotal);
register.registerMetric(paymentAmount);

// --------------------
// Business Metric Recorders
// --------------------
const getTraceId = () => {
  const span = trace.getSpan(context.active());
  return span?.spanContext().traceId || 'none';
};

export const recordPaymentSuccess = (method, route) => {
  paymentsSuccess.inc({ method, route, trace_id: getTraceId() });
};
export const recordPaymentFailure = (method, route) => {
  paymentsFailed.inc({ method, route, trace_id: getTraceId() });
};
export const recordRefund = (method, route) => {
  refundsTotal.inc({ method, route, trace_id: getTraceId() });
};
export const recordPaymentAmount = (amount, method, route) => {
  paymentAmount.observe({ method, route, trace_id: getTraceId() }, amount);
};

// --------------------
// Middleware for metrics + tracing
// --------------------
export const metricsMiddleware = (req, res, next) => {
  const endTimer = httpRequestDuration.startTimer();
  const traceId = getTraceId();

  res.setHeader('x-trace-id', traceId);

  res.on('finish', () => {
    httpRequestCounter.inc({
      method: req.method,
      route: req.path,
      status: res.statusCode,
      trace_id: traceId
    });

    endTimer({
      method: req.method,
      route: req.path,
      status: res.statusCode,
      trace_id: traceId
    });
  });

  next();
};

// --------------------
// Optional: helper to record payments + refunds in one call
// --------------------
export const recordPaymentEvent = ({ success, amount, method, route }) => {
  if (success) recordPaymentSuccess(method, route);
  else recordPaymentFailure(method, route);

  if (amount) recordPaymentAmount(amount, method, route);
};
