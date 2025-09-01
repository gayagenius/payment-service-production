const express = require("express");
const router = express.Router();
const { addPaymentMethod, listPaymentMethods } = require("../models");

router.post("/", async (req, res) => {
  const { userId, type, details } = req.body;
  if (!userId || !type) return res.status(400).json({ error: "Missing fields" });

  const method = await addPaymentMethod(userId, type, details);
  res.json({ message: "Payment method added", method });
});

router.get("/:userId", async (req, res) => {
  const methods = await listPaymentMethods(req.params.userId);
  res.json({ methods });
});

module.exports = router;
