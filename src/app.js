import 'dotenv/config';
import express from "express";
import bodyParser from "body-parser";
import payments from "../routes/payments-integrated.js";
import refunds from "../routes/refunds.js";
import methods from "../routes/methods.js";
import paymentHistory from "../routes/paymentHistory.js";
import webhooks from "../routes/webhooks.js";
import queueHealthRouter from "../routes/queueHealth.js"
import testRouter from "../routes/test.js"; 
import { connect } from "../messaging/queueSetup.js";
import('./../docs-server.js');

const app = express();
app.use(bodyParser.json());

// Routes
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

// Start server
const PORT = process.env.PORT || 8080;

const startServer = () => {
  // Try to connect to RabbitMQ in the background (non-blocking)
  connect().then(() => {
    console.log("✅ RabbitMQ connected");
  }).catch(() => {
    console.warn("⚠️  RabbitMQ offline - messaging disabled");
  });
  
  // Start the server immediately (independent of RabbitMQ)
  app.listen(PORT, () => {
    console.log(`🚀 Payment service running on http://localhost:${PORT}`);
  });
};

startServer();
