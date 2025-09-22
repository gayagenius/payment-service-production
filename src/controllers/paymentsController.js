// src/controllers/paymentsController.js
import { createPaymentAndEnqueue } from '../services/paymentsService.js';

export async function createPayment(req, res, next) {
  try {
    const idempotencyKey = req.header('Idempotency-Key');
    const { userId, orderId, amount, currency } = req.body;

    const payment = await createPaymentAndEnqueue(
      { userId, orderId, amount, currency },
      idempotencyKey,
      { ip: req.ip }
    );

    return res.status(202).json({
      paymentId: payment.id,
      status: payment.status,
      createdAt: payment.createdAt,
      message: 'Payment queued for processing',
    });
  } catch (err) {
    next(err);
  }
}
