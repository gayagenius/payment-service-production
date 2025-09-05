import express from "express";
import bodyParser from "body-parser";
import payments from "./routes/payments.js";
import refunds from "./routes/refunds.js";
import methods from "./routes/methods.js";

const app = express();
app.use(bodyParser.json());

// Routes
app.use("/payments", payments);
app.use("/refunds", refunds);
app.use("/methods", methods);


// Health check route
app.get("/", (req, res) => {
  res.json({ status: "ok", message: "Payment service is running 🚀" });
});


// Start server
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`Payment service running on port ${PORT}`));