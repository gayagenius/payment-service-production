import 'dotenv/config';
import express from "express";
import bodyParser from "body-parser";
import payments from "../routes/payments.js";
import refunds from "../routes/refunds.js";
import methods from "../routes/methods.js";
import paymentHistory from "../routes/paymentHistory.js";
import queueHealthRouter from "../routes/queueHealth.js";
import testRouter from "../routes/test.js"; 
import { connect } from "../messaging/queueSetup.js";
import('../docs-server.js');

const app = express();
app.use(bodyParser.json());

// Routes
app.use("/payments", payments);
app.use("/refunds", refunds);
app.use("/methods", methods);
app.use("/payment-history", paymentHistory);
app.use("/queue", queueHealthRouter); 
app.use("/test", testRouter);

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
