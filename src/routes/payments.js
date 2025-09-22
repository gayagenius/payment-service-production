import express from 'express';
import Joi from 'joi';
import * as paymentService from '../services/paymentsService.js';

import idempotencyMiddleware from '../../middlewares/idempotency.js';
import validateBody from '../../middlewares/validateBody.js';

const router = express.Router();


const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Joi schema for creating payments 
const createPaymentSchema = Joi.object({
  userId: Joi.string().uuid({ version: ['uuidv4', 'uuidv5', 'uuidv1', 'uuidv3'] }).required(),
  orderId: Joi.string().min(1).required(),
  amount: Joi.number().integer().positive().required(),
  currency: Joi.string().length(3).uppercase().optional()
});

// GET /payments
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const items = await paymentService.listPayments();
    return res.status(200).json({ data: items || [] });
  })
);

// POST /payments
// - require idempotency
// - validate body
router.post(
  '/',
  idempotencyMiddleware,
  validateBody(createPaymentSchema),
  asyncHandler(async (req, res) => {
    const idempotencyKey = req.idempotencyKey || req.header('Idempotency-Key') || req.header('idempotency-key');

    const { userId, orderId, amount, currency } = req.body;

    const payment = await paymentService.createPaymentAndEnqueue(
      { userId, orderId, amount, currency },
      idempotencyKey,
      { ip: req.ip }
    );

    return res.status(202).json({
      status: 'success',
      data: { paymentId: payment.id }
    });
  })
);

// GET /payments/:id
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const payment = await paymentService.getPaymentById(id);
    if (!payment) {
      return res.status(404).json({ status: 'error', message: 'Not found' });
    }
    return res.status(200).json({ data: payment });
  })
);

router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const updated = await paymentService.updatePayment(req.params.id, req.body);
    return res.status(200).json({ data: updated });
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await paymentService.deletePayment(req.params.id);
    return res.status(204).send();
  })
);

export default router;
