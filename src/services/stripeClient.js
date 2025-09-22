import dotenv from 'dotenv';
dotenv.config();

import Stripe from 'stripe';

const stripeKey = process.env.STRIPE_API_KEY || process.env.STRIPE_SECRET_KEY || '';

const stripe = new Stripe(stripeKey, {
apiVersion: process.env.STRIPE_API_VERSION || '2023-08-16',
  maxNetworkRetries: Number(process.env.STRIPE_MAX_NETWORK_RETRIES || 2),
});

export default stripe;
