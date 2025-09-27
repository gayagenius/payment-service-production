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
 * Update payment by Paystack reference
 */
async function updatePaymentByReference(reference, status, gatewayResponse) {
    try {
        console.log(`Looking up payment with reference: ${reference}`);
        
        // Find payment by reference (stored in idempotency_key)
        const findQuery = `
            SELECT id FROM payments 
            WHERE idempotency_key = $1
        `;
        
        const findResult = await dbPoolManager.executeRead(findQuery, [reference]);
        
        if (findResult.rows.length === 0) {
            console.error(`Payment not found for reference: ${reference}`);
            throw new Error(`Payment not found for reference: ${reference}`);
        }
        
        const payment_id = findResult.rows[0].id;
        console.log(`Found payment ID: ${payment_id} for reference: ${reference}`);
        
        // Update payment status, gateway_response, and updated_at
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

        console.log(`✅ Payment ${payment_id} updated to ${status} via webhook`);
    } catch (error) {
        console.error('❌ Failed to update payment from webhook:', error);
        throw error;
    }
}

/**
 * POST /webhooks/paystack - Handle Paystack webhooks
 */
router.post('/paystack', express.json(), async (req, res) => {
    try {
        console.log('Webhook received, processing...');

        const event = req.body;
        const { event: eventType, data } = event;
        
        console.log(`Received Paystack webhook: ${eventType}, reference: ${data.reference}`);
        
        if (eventType === 'charge.success') {
            await updatePaymentByReference(data.reference, 'SUCCEEDED', data);
        } else if (eventType === 'charge.failed') {
            await updatePaymentByReference(data.reference, 'FAILED', data);
        } else {
            console.log(`Unhandled webhook event: ${eventType}`);
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
