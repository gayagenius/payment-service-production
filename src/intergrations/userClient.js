// src/integrations/userClient.js
// Simple client to call User service for notifications (e.g., add payment method) or to validate user state.

import axios from 'axios';
import { createCircuitBreaker } from '../utils/circuitBreaker.js';
import { retry } from '../utils/retry.js';

const USER_BASE = process.env.USER_SERVICE_URL || 'http://user-service:4001';
const TIMEOUT = Number(process.env.INTEGRATION_TIMEOUT_MS || 5000);

const axiosInstance = axios.create({
  baseURL: USER_BASE,
  timeout: TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'payment-service/1.0',
  },
});

async function addUserPaymentMethod({ userId, paymentMethod }) {
  const res = await axiosInstance.post(`/users/${userId}/payment-methods`, paymentMethod);
  return res.data;
}

const breaker = createCircuitBreaker(addUserPaymentMethod, {
  timeout: 5000,
  errorThresholdPercentage: 60,
  resetTimeout: 20000,
});

export async function savePaymentMethod(payload) {
  return retry(async () => breaker.fire(payload), { retries: 2, factor: 2, minTimeout: 200 });
}
