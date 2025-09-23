import express from 'express';
import dbPoolManager from '../db/connectionPool.js';
import { verifyWebhookSignature, handleWebhookEvent } from '../services/paymentProcessor.js';
import { publishPaymentEvent } from '../messaging/publishPaymentEvent.js';

const router = express.Router();

/**
 * Update payment from webhook data
 */
async function updatePaymentFromWebhook(payment_id, status, gatewayResponse) {
    try {
        const updateQuery = `
            UPDATE payments 
            SET 
                status = $1,
                gateway_response = $2,
                updated_at = NOW()
            WHERE id = $3
        `;
        
        await dbPoolManager.executeWrite(updateQuery, [
            status,
            JSON.stringify(gatewayResponse),
            payment_id
        ]);

        // Publish payment event
        await publishPaymentEvent('payment_updated', {
            payment_id,
            status,
            gatewayResponse,
            source: 'webhook'
        });

        console.log(`Payment ${payment_id} updated to ${status} via webhook`);
    } catch (error) {
        console.error('Failed to update payment from webhook:', error);
        throw error;
    }
}

/**
 * POST /webhooks/paystack - Handle Paystack webhooks
 */
router.post('/paystack', express.json(), async (req, res) => {
    try {
        // Verify webhook signature
        if (!verifyWebhookSignature('paystack', req)) {
            return res.status(400).json({ success: false, message: 'Invalid Paystack webhook signature' });
        }

        const event = req.body;
        const processedEvent = handleWebhookEvent('paystack', event);

        if (processedEvent && processedEvent.type === 'payment_update') {
            const { payment_id, status, gatewayResponse } = processedEvent;
            await updatePaymentFromWebhook(payment_id, status, gatewayResponse);
        } else if (processedEvent && processedEvent.type === 'refund_update') {
            // Handle refund updates
            const { refundId, status, gatewayResponse } = processedEvent;
            console.log(`Paystack refund ${refundId} status updated to ${status} via webhook`);
        }

        res.status(200).json({ success: true, message: 'Webhook received and processed' });
    } catch (error) {
        console.error('Paystack webhook error:', error);
        res.status(500).json({ success: false, message: 'Internal server error' });
    }
});

/**
 * GET /webhooks/status - Get webhook status
 */
router.get('/status', async (req, res) => {
    try {
        res.json({
            success: true,
            data: {
                webhooks: {
                    paystack: '/webhooks/paystack'
                },
                status: 'active'
            }
        });
    } catch (error) {
        console.error('Webhook status error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Internal server error'
            }
        });
    }
});

export default router;
