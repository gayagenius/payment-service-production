// routes/stripeWebhook.js
import express from "express";
import Stripe from "stripe";

const router = express.Router();

// Initialize Stripe client
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2025-01-27.acacia", // always pin to latest stable
});

// Stripe requires the raw body to validate webhook signatures
router.post(
  "/",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["stripe-signature"];
    let event;

    try {
      event = stripe.webhooks.constructEvent(
        req.body,
        sig,
        process.env.STRIPE_WEBHOOK_SECRET
      );
    } catch (err) {
      console.error("❌ Webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle event types
    switch (event.type) {
      case "payment_intent.succeeded":
        console.log("✅ PaymentIntent succeeded:", event.data.object.id);
        break;
      case "payment_intent.payment_failed":
        console.log("❌ PaymentIntent failed:", event.data.object.id);
        break;
      default:
        console.log(`ℹ️  Received unhandled event: ${event.type}`);
    }

    // Acknowledge receipt
    res.json({ received: true });
  }
);

export default router;
