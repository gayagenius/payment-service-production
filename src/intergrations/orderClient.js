// src/integrations/orderClient.js
// Lightweight HTTP client to call Order service for synchronous notifications (fallback only).
// The recommended path is to publish to payment_events and let Order consume.
//
// This client uses axios and the existing circuit-breaker util to guard calls.

import axios from 'axios';
import { createCircuitBreaker } from '../utils/circuitBreaker.js';
import { retry } from '../utils/retry.js';

const ORDER_BASE = process.env.ORDER_SERVICE_URL || 'http://order-service:4000';
const TIMEOUT = Number(process.env.INTEGRATION_TIMEOUT_MS || 5000);

const axiosInstance = axios.create({
  baseURL: ORDER_BASE,
  timeout: TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
    'User-Agent': 'payment-service/1.0',
  },
});

/**
 * notifyOrderPaymentCompleted - synchronous call to Order service to mark order paid.
 * This is a fallback approach; prefer event-driven.
 */
async function notifyOrderPaymentCompleted(payload) {
  // payload: { orderId, paymentId, amount, currency, gatewayResponse }
  const res = await axiosInstance.post(`/orders/${payload.orderId}/payments`, payload);
  return res.data;
}

const breaker = createCircuitBreaker(notifyOrderPaymentCompleted, {
  timeout: 5000,
  errorThresholdPercentage: 50,
  resetTimeout: 20000,
});

export async function notifyOrder(payload) {
  // wrap with retry + circuit
  return retry(async () => breaker.fire(payload), { retries: 2, factor: 2, minTimeout: 200 });
}
