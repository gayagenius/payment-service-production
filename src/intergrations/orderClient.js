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

// notifyOrderPaymentCompleted - synchronous call to Order service to mark order paid.
 
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
    return retry(async () => breaker.fire(payload), { retries: 2, factor: 2, minTimeout: 200 });
}
