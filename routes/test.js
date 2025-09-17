// src/routes/test.js

import express from "express";
import { publishPaymentEvent } from "../messaging/publishPaymentEvent.js";

const router = express.Router();

router.get("/publish", (req, res) => {
    publishPaymentEvent('payment_initiated', {
        paymentId: 'test_pay_1',
        orderId: 'test_order_1',
        userId: 'test_user_1',
        amount: 5000,
        status: 'initiated',
        correlationId: 'test_corr_1',
    });
    res.send('Event published!');
});

export default router;