const express = require("express");
const router = express.Router();
const { refundTransaction } = require("../models");

router.post("/", async (req, res) => {
  const { transactionId } = req.body;
  if (!transactionId) return res.status(400).json({ error: "Missing transactionId" });

  const refund = await refundTransaction(transactionId);
  res.json({ message: "Refund processed", refund });
});

module.exports = router;
