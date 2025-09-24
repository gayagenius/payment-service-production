// --------------------
// Tracing MUST be imported first
// --------------------
import './tracing.js';
import { tracer } from './tracing.js';

import 'dotenv/config';
import express from "express";
import bodyParser from "body-parser";

import payments from "../routes/payments.js";
import refunds from "../routes/refunds.js";
import methods from "../routes/methods.js";
import paymentHistory from "../routes/paymentHistory.js";
import queueHealthRouter from "../routes/queueHealth.js";
import testRouter from "../routes/test.js";

import payments from "../routes/payments-integrated.js";
import refunds from "../routes/refunds.js";
import methods from "../routes/methods.js";
import paymentHistory from "../routes/paymentHistory.js";
import webhooks from "../routes/webhooks.js";
import queueHealthRouter from "../routes/queueHealth.js"
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
// Business Metrics
// --------------------
app.use((req, res, next) => {
  res.on('finish', () => {
    // Payments success/failure metrics
    if (req.path.startsWith('/payments')) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        recordPaymentSuccess(req.method, req.path);
      } else if (res.statusCode >= 400) {
        recordPaymentFailure(req.method, req.path);
      }
    }

    // Refunds metrics
    if (req.path.startsWith('/refunds') && res.statusCode >= 200 && res.statusCode < 300) {
      recordRefund(req.method, req.path);
    }

    // Payment amount metric if available
    if (req.paymentAmount) {
      recordPaymentAmount(req.paymentAmount, req.method, req.path);
    }
  });
  next();
});

// --------------------
// Routes
// --------------------
app.use("/payments", payments);
app.use("/refunds", refunds);
app.use("/methods", methods);
app.use("/payments/methods", methods); // Add payment methods route under payments
app.use("/payment", methods); // Add payment types route
app.use("/payment-history", paymentHistory);
app.use("/webhooks", webhooks);
app.use("/queue", queueHealthRouter);
app.use("/test", testRouter);

// Serve Swagger UI on main port
app.use('/docs', express.static('docs'));
app.use('/api', express.static('api'));

// Return URL endpoint for Stripe redirects
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

// Health check route
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Payment service is running 🚀" });
});

// Manual tracing test route
app.get('/trace-test', (req, res) => {
  const span = tracer.startSpan('manual-test-span');
  span.addEvent("Trace test endpoint hit");
  span.end();
  res.json({ message: 'Span created!' });
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
  if (res.headersSent) {
    return next(err);
  }
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
// Start server
// --------------------
const startServer = () => {
  // Connect to RabbitMQ in background
  connect()
    .then(() => console.log("✅ RabbitMQ connected"))
    .catch(() => console.warn("⚠️ RabbitMQ offline - messaging disabled"));

  // Start Express server
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Payment service running on http://0.0.0.0:${PORT}`);
  });
};

startServer();
