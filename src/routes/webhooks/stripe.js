// src/routes/webhooks/stripe.js
// Express route for Stripe webhooks. Register BEFORE bodyParser.json() in app.js

import express from 'express';
import { constructWebhookEvent } from '../../services/stripeGateway.js';
import { publish } from '../../../messaging/queueSetup.js';

const router = express.Router();

// Queue name used to reliably process webhook events (worker will handle them)
const STRIPE_WEBHOOK_QUEUE = process.env.STRIPE_WEBHOOK_QUEUE || 'stripe_webhook_events';

// Use express.raw in route registration (we do it here to be explicit)
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const raw = req.body; // Buffer from express.raw
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    console.error('[webhook] Stripe webhook secret is not configured');
    return res.status(500).send('Webhook not configured');
  }

  let event;
  try {
    event = constructWebhookEvent(raw, sig, secret);
  } catch (err) {
    console.warn('[webhook] invalid signature:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // publish to a durable queue for processing by workers
    // store minimal info — workers can fetch more details if needed
    await publish(STRIPE_WEBHOOK_QUEUE, {
      id: event.id,
      type: event.type,
      created: event.created,
      payload: event, // optional: you may choose to store only event.data.object
    });

    // respond quickly to Stripe
    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('[webhook] failed to publish webhook event', err);
    // 500 so Stripe will retry delivery
    return res.status(500).send('failed to enqueue webhook');
  }
});

export default router;
