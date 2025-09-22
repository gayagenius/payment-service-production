// src/services/stripeClient.js
// Centralized Stripe client wrapper
import dotenv from 'dotenv';
dotenv.config();

import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
apiVersion: process.env.STRIPE_API_VERSION || '2023-08-16',
  maxNetworkRetries: Number(process.env.STRIPE_MAX_NETWORK_RETRIES || 2),
});

export default stripe;
