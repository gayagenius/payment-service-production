// src/utils/validators.js
import Joi from 'joi';

export const createPaymentSchema = Joi.object({
  userId: Joi.string().guid({ version: 'uuidv4' }).required(),
  orderId: Joi.string().max(255).required(),
  amount: Joi.number().integer().min(1).required(),
  currency: Joi.string().length(3).uppercase().required(),
});

export const updatePaymentSchema = Joi.object({
  status: Joi.string().valid('PENDING','AUTHORIZED','SUCCEEDED','FAILED','REFUNDED','PARTIALLY_REFUNDED','CANCELLED'),
  gateway_response: Joi.object().optional(),
}).min(1);
