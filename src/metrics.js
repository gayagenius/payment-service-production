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
  labelNames: ['method', 'route', 'status']
});
register.registerMetric(httpRequestCounter);

// --------------------
// Request Duration Histogram
// --------------------
export const httpRequestDuration = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5] // fine-grained latency
});
register.registerMetric(httpRequestDuration);

// --------------------
// Business Metrics
// --------------------
export const paymentsSuccess = new client.Counter({
  name: 'payments_success_total',
  help: 'Total successful payments',
  labelNames: ['method', 'route']
});
export const paymentsFailed = new client.Counter({
  name: 'payments_failed_total',
  help: 'Total failed payments',
  labelNames: ['method', 'route']
});
export const refundsTotal = new client.Counter({
  name: 'refunds_total',
  help: 'Total refunds',
  labelNames: ['method', 'route']
});
export const paymentAmount = new client.Histogram({
  name: 'payment_amount',
  help: 'Distribution of payment amounts',
  labelNames: ['method', 'route'],
  buckets: [1, 10, 50, 100, 500, 1000, 5000]
});

register.registerMetric(paymentsSuccess);
register.registerMetric(paymentsFailed);
register.registerMetric(refundsTotal);
register.registerMetric(paymentAmount);

// --------------------
// Business Metric Recorders
// --------------------
export const recordPaymentSuccess = (method, route) => {
  paymentsSuccess.inc({ method, route });
};
export const recordPaymentFailure = (method, route) => {
  paymentsFailed.inc({ method, route });
};
export const recordRefund = (method, route) => {
  refundsTotal.inc({ method, route });
};
export const recordPaymentAmount = (amount, method, route) => {
  paymentAmount.observe({ method, route }, amount);
};

// --------------------
// Middleware for metrics + tracing
// --------------------
export const metricsMiddleware = (req, res, next) => {
  const endTimer = httpRequestDuration.startTimer();
  const span = trace.getSpan(context.active());

  if (span) {
    const traceId = span.spanContext().traceId;
    res.setHeader('x-trace-id', traceId);
    console.log(`📡 Handling ${req.method} ${req.url} traceId=${traceId}`);
  }

  res.on('finish', () => {
    httpRequestCounter.inc({
      method: req.method,
      route: req.path,
      status: res.statusCode
    });

    // stop duration timer
    endTimer({ method: req.method, route: req.path, status: res.statusCode });
  });

  next();
};
