import express from "express";
import bodyParser from "body-parser";
import payments from "./routes/payments.js";
import refunds from "./routes/refunds.js";
import methods from "./routes/methods.js";
import queueHealthRouter from "./routes/queueHealth.js"
import testRouter from "./routes/test.js"; 
import { connect } from "../messaging/queueSetup.js";

const app = express();
app.use(bodyParser.json());

// Routes
app.use("/payments", payments);
app.use("/refunds", refunds);
app.use("/methods", methods);
app.use("/queue", queueHealthRouter); 
app.use("/test", testRouter);

// Health check route
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Payment service is running 🚀" });
});

// Start server
const PORT = process.env.PORT || 8080;

const startServer = async () => {
  try {
    await connect();
    const PORT = process.env.PORT || 8080;
    app.listen(PORT, () => console.log(`Payment service running on port http://localhost:${PORT}`));
  } catch (error) {
    console.error("Failed to connect to RabbitMQ, server will not start:", error);
    process.exit(1);
  }
};

startServer();
