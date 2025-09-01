const express = require("express");
const router = express.Router();
const { saveTransaction } = require("../models");

// Simulate processing a payment
router.post("/", async (req, res) => {
  const { userId, methodId, amount, currency } = req.body;

  if (!userId || !methodId || !amount) {
    return res.status(400).json({ error: "Missing fields" });
  }

  // Simulate success/failure
  const status = Math.random() > 0.2 ? "SUCCESS" : "FAILED";

  const tx = await saveTransaction(userId, methodId, amount, currency, status);

  res.json({ message: "Payment processed", transaction: tx });
});

module.exports = router;
