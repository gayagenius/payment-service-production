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
 * Update refund from webhook data
 */
async function updateRefundFromWebhook(refund_id, status, gatewayResponse) {
    try {
        const updateQuery = `
            UPDATE refunds 
            SET 
                status = $1,
                gateway_response = $2,
                updated_at = NOW()
            WHERE id = $3
        `;
        
        await dbPoolManager.executeWrite(updateQuery, [
            status,
            JSON.stringify(gatewayResponse),
            refund_id
        ]);

        // Publish refund event
        try {
            await publishPaymentEvent('refund_updated', {
                refund_id,
                status,
                gatewayResponse,
                source: 'webhook'
            });
        } catch (publishError) {
            console.warn('Failed to publish refund event:', publishError.message);
            // Don't throw - webhook should still succeed even if event publishing fails
        }

        console.log(`Refund ${refund_id} updated to ${status} via webhook`);
    } catch (error) {
        console.error('Failed to update refund from webhook:', error);
        throw error;
    }
}

/**
 * Update refund by Paystack refund ID
 */
async function updateRefundByPaystackId(paystackRefundId, status, gatewayResponse) {
    try {
        console.log(`Looking up refund with Paystack ID: ${paystackRefundId}`);
        
        // Find refund by Paystack refund ID (stored in gateway_response)
        const findRefundQuery = `
            SELECT id, payment_id, amount, status
            FROM refunds
            WHERE gateway_response->>'id' = $1
            ORDER BY created_at DESC
            LIMIT 1
        `;
        
        const refundResult = await dbPoolManager.executeRead(findRefundQuery, [paystackRefundId]);
        
        if (refundResult.rows.length === 0) {
            console.warn(`No refund found with Paystack ID: ${paystackRefundId}`);
            return;
        }
        
        const refund = refundResult.rows[0];
        console.log(`Found refund ${refund.id} for Paystack refund ${paystackRefundId}`);
        
        // Check if refund is already in final state to prevent duplicate processing
        if (['SUCCEEDED', 'FAILED'].includes(refund.status)) {
            console.log(`Refund ${refund.id} already in final state: ${refund.status}, skipping webhook update`);
            return;
        }
        
        await updateRefundFromWebhook(refund.id, status, gatewayResponse);
        
        // Update payment status if refund succeeded
        if (status === 'SUCCEEDED') {
            const updatePaymentQuery = `
                UPDATE payments 
                SET status = 'REFUNDED', updated_at = NOW()
                WHERE id = $1
            `;
            await dbPoolManager.executeWrite(updatePaymentQuery, [refund.payment_id]);
            console.log(`Payment ${refund.payment_id} marked as REFUNDED`);
        }
        
    } catch (error) {
        console.error('Failed to update refund by Paystack ID:', error);
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
        } else if (eventType === 'refund.processed') {
            // Refund succeeded
            await updateRefundByPaystackId(data.id, 'SUCCEEDED', data);
        } else if (eventType === 'refund.failed') {
            // Refund failed
            await updateRefundByPaystackId(data.id, 'FAILED', data);
        } else if (eventType === 'refund.pending') {
            // Refund is pending (optional - you might not need this)
            console.log(`Refund ${data.id} is pending`);
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
                supported_events: {
                    payments: ['charge.success', 'charge.failed'],
                    refunds: ['refund.processed', 'refund.failed', 'refund.pending']
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
