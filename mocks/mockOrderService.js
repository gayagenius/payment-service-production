import express from "express";

const app = express();
app.use(express.json());

app.post("/orders/:id/confirm", (req, res) => {
  if (req.params.id === "fail") {
    return res.status(500).json({ error: "Order confirmation failed" });
  }
  res.json({ orderId: req.params.id, status: "confirmed", paymentId: req.body.paymentId });
});

const PORT = process.env.MOCK_ORDER_PORT || 5001;
app.listen(PORT, () => console.log(`Mock Order Service running on ${PORT}`));
