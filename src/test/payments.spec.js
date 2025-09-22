// test/payments.spec.js
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import paymentsRouter from '../src/routes/payments.js';

// mocks
vi.mock('../src/services/paymentsService.js', () => {
  return {
    createPaymentAndEnqueue: vi.fn(),
    listPayments: vi.fn(),
    getPaymentById: vi.fn(),
    updatePayment: vi.fn(),
    deletePayment: vi.fn(),
  };
});

import * as paymentService from '../src/services/paymentsService.js';

let app;
beforeEach(() => {
  app = express();
  app.use(express.json());
  app.use('/payments', paymentsRouter);
  // minimal error handler to make tests receive JSON
  app.use((err, req, res, next) => {
    res.status(500).json({ status: 'error', message: err.message || 'err' });
  });
});

afterEach(() => {
  vi.resetAllMocks();
});

describe('POST /payments', () => {
  it('returns 400 when missing idempotency key', async () => {
    const res = await request(app).post('/payments').send({
      userId: '550e8400-e29b-41d4-a716-446655440000',
      orderId: 'order-1',
      amount: 100,
      currency: 'USD',
    });
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('message', 'Missing Idempotency-Key header');
  });

  it('queues payment and returns 202 on success', async () => {
    paymentService.createPaymentAndEnqueue.mockResolvedValue({
      id: 'pay_123',
      status: 'PENDING',
      createdAt: '2025-09-22T00:00:00Z'
    });

    const res = await request(app)
      .post('/payments')
      .set('Idempotency-Key', 'idem-key-1')
      .send({
        userId: '550e8400-e29b-41d4-a716-446655440000',
        orderId: 'order-1',
        amount: 100,
        currency: 'USD',
      });

    expect(paymentService.createPaymentAndEnqueue).toHaveBeenCalled();
    expect(res.status).toBe(202);
    expect(res.body).toHaveProperty('status', 'success');
    expect(res.body.data).toHaveProperty('paymentId', 'pay_123');
  });

  it('returns 422 on invalid body', async () => {
    const res = await request(app)
      .post('/payments')
      .set('Idempotency-Key', 'idem-key-2')
      .send({ userId: 'not-a-uuid', orderId: '', amount: -1 });
    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('status', 'error');
  });
});

describe('GET /payments', () => {
  it('lists payments', async () => {
    paymentService.listPayments.mockResolvedValue([{ id: 'p1' }]);
    const res = await request(app).get('/payments');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([{ id: 'p1' }]);
  });
});

describe('GET /payments/:id', () => {
  it('returns 404 when not found', async () => {
    paymentService.getPaymentById.mockResolvedValue(null);
    const res = await request(app).get('/payments/nonexistent');
    expect(res.status).toBe(404);
  });

  it('returns payment when present', async () => {
    paymentService.getPaymentById.mockResolvedValue({ id: 'p1' });
    const res = await request(app).get('/payments/p1');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ id: 'p1' });
  });
});
