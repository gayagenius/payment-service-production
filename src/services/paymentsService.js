// src/services/paymentsService.js
import { publish, PAYMENT_TOPICS } from '../messaging/queueSetup.js';
import db from '../db/connectionPool.js';
import { PAYMENT_CONFIG } from '../config/constants.js';

/**
 * Creates a payment in DB (via SQL helper function) and enqueues a job for the worker
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.orderId
 * @param {number} params.amount
 * @param {string} [params.currency='USD']
 * @param {string} idempotencyKey - must be provided in request header
 * @param {Object} [meta={}] - additional metadata
 */
export async function createPaymentAndEnqueue(
  { userId, orderId, amount, currency = 'USD' },
  idempotencyKey,
  meta = {}
) {
  if (!idempotencyKey) {
    throw new Error('Missing Idempotency-Key header');
  }

  // Call DB function inside a transaction
  const result = await db.executeTransaction(async (client) => {
    const sql = `
      SELECT * FROM create_payment_with_history(
        $1, $2, $3, $4,
        NULL, -- payment_method_id
        '{}'::jsonb, -- gateway_response placeholder
        $5,          -- idempotency_key
        FALSE        -- retry flag
      )
    `;
    const { rows } = await client.query(sql, [
      userId,
      orderId,
      amount,
      currency,
      idempotencyKey,
    ]);
    return rows[0];
  });

  if (!result || !result.success) {
    throw new Error(result?.error_message || 'Payment creation failed');
  }

  // Build the job payload for the worker
  const job = {
    paymentId: result.payment_id,
    orderId,
    userId,
    amount,
    currency,
    idempotencyKey,
    metadata: meta,
  };

  // Publish event that the worker consumes
  await publish(PAYMENT_TOPICS.PAYMENT_INITIATED, job, {
    correlationId: idempotencyKey,
  });

  return {
    id: result.payment_id,
    status: result.status || PAYMENT_CONFIG.STATUS.PENDING,
    createdAt: result.created_at,
  };
}
