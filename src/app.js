// --------------------
// Tracing MUST be imported first
// --------------------
import './tracing.js';
import { tracer } from './tracing.js';

import 'dotenv/config';
import express from "express";
import bodyParser from "body-parser";

import payments from "../routes/payments-integrated.js"; 
import refunds from "../routes/refunds.js";
import paymentHistory from "../routes/paymentHistory.js";
import webhooks from "../routes/webhooks.js";
import queueHealthRouter from "../routes/queueHealth.js";
import testRouter from "../routes/test.js";
import { connect } from "../messaging/queueSetup.js";
import('./../docs-server.js');

import {
  paymentsSuccess,
  paymentsFailed,
  refundsTotal,
  paymentAmount,
  register,
  recordPaymentSuccess,
  recordPaymentFailure,
  recordRefund,
  recordPaymentAmount,
  metricsMiddleware
} from "./metrics.js"; // Metrics + tracing

const app = express();
const PORT = process.env.PORT || 8080;

app.use(bodyParser.json());

// --------------------
// Metrics & Tracing Middleware
// --------------------
app.use(metricsMiddleware);

// --------------------
// Business Metrics for payments/refunds
// --------------------
app.use((req, res, next) => {
  res.on('finish', () => {
    const method = req.method;
    const route = req.path;

    // Payments
    if (route.startsWith('/payments')) {
      if (res.statusCode >= 200 && res.statusCode < 300) recordPaymentSuccess(method, route);
      else if (res.statusCode >= 400) recordPaymentFailure(method, route);
    }

    // Refunds
    if (route.startsWith('/refunds') && res.statusCode >= 200 && res.statusCode < 300) {
      recordRefund(method, route);
    }

    // Payment amount (optional)
    if (req.paymentAmount) {
      recordPaymentAmount(req.paymentAmount, method, route);
    }
  });
  next();
});

// --------------------
// Routes
// --------------------
app.use("/payments", payments);
app.use("/refunds", refunds);
app.use("/payment-history", paymentHistory);
app.use("/webhooks", webhooks);
app.use("/queue", queueHealthRouter);
app.use("/test", testRouter);

// --------------------
// Swagger / API docs
// --------------------
app.use('/docs', express.static('docs'));
app.use('/api', express.static('api'));

// --------------------
// Stripe return endpoint
// --------------------
app.get('/payments/return', (req, res) => {
  const { payment_intent, payment_intent_client_secret } = req.query;

  if (payment_intent) {
    res.json({
      success: true,
      message: 'Payment completed successfully',
      payment_intent,
      payment_intent_client_secret
    });
  } else {
    res.json({
      success: false,
      message: 'Payment failed or was cancelled'
    });
  }
});

// --------------------
// Health check
// --------------------
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Payment service is running 🚀" });
});

// --------------------
// Prometheus metrics endpoint
// --------------------
app.get("/metrics", async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

// --------------------
// Global Error Handler
// --------------------
app.use((err, req, res, next) => {
  console.error("❌ Unhandled error:", err.stack || err);
  if (res.headersSent) return next(err);
  res.status(500).json({
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: "Unexpected server error",
      details: err.message
    }
  });
});

// --------------------
// Global Error Handlers (Prevent Server Crashes)
// --------------------

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Promise Rejection at:', promise, 'reason:', reason);
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  process.exit(0);
});

// Handle SIGTERM gracefully
process.on('SIGTERM', () => {
  console.log('📴 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

// Handle SIGINT gracefully
process.on('SIGINT', () => {
  console.log('📴 SIGINT received, shutting down gracefully');
  process.exit(0);
});

// --------------------
// Start server
// --------------------
const startServer = () => {
  connect()
    .then(() => console.log("✅ RabbitMQ connected"))
    .catch(() => console.warn("⚠️ RabbitMQ offline - messaging disabled"));

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Payment service running on http://0.0.0.0:${PORT}`);
    console.log(`📊 Metrics available at http://0.0.0.0:${PORT}/metrics`);
  });
};

startServer();
