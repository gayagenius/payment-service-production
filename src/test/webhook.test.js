// tests/webhook.test.js
import request from 'supertest';
import express from 'express';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// mock constructWebhookEvent and publish
vi.mock('../src/services/stripeGateway.js', () => {
  return {
    constructWebhookEvent: vi.fn(),
  };
});
vi.mock('../messaging/queueSetup.js', () => {
  return {
    publish: vi.fn().mockResolvedValue('msg_1'),
  };
});

import { constructWebhookEvent } from '../src/services/stripeGateway.js';
import { publish } from '../messaging/queueSetup.js';

import stripeWebhookRouter from '../src/routes/webhooks/stripe.js';

describe('POST /webhooks/stripe', () => {
  let app;
  beforeEach(() => {
    app = express();
    // mount raw route — supertest sends Buffer if we set content-type text/plain, so simulate
    app.use('/webhooks', stripeWebhookRouter);
  });

  it('returns 200 and enqueues event when signature valid', async () => {
    const fakeEvent = { id: 'evt_1', type: 'payment_intent.succeeded' };
    constructWebhookEvent.mockReturnValue(fakeEvent);

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 't=1,v1=abc')
      .send(JSON.stringify(fakeEvent)) // body goes as text; express.raw will receive buffer
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(200);
    expect(publish).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ id: 'evt_1', type: 'payment_intent.succeeded' }));
  });

  it('returns 400 for invalid signature', async () => {
    constructWebhookEvent.mockImplementation(() => { throw new Error('Invalid signature'); });

    const res = await request(app)
      .post('/webhooks/stripe')
      .set('stripe-signature', 'bad')
      .send('{}')
      .set('Content-Type', 'application/json');

    expect(res.status).toBe(400);
  });
});
