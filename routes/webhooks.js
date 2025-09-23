import express from 'express';
import dbPoolManager from '../db/connectionPool.js';
import { verifyWebhookSignature, handleWebhookEvent } from '../services/paymentProcessor.js';
import { publishPaymentEvent } from '../messaging/publishPaymentEvent.js';

const router = express.Router();

/**
 * POST /webhooks/stripe - Handle Stripe webhooks
 */
router.post('/stripe', express.raw({ type: 'application/json' }), async (req, res) => {
    try {
        const signature = req.headers['stripe-signature'];
        const payload = req.body;

        if (!signature) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'MISSING_SIGNATURE',
                    message: 'Stripe signature header is required'
                }
            });
        }

        // Verify webhook signature
        const verificationResult = await verifyWebhookSignature('stripe', payload, signature);
        
        if (!verificationResult.success) {
            console.error('Stripe webhook verification failed:', verificationResult.error);
            return res.status(400).json({
                success: false,
                error: {
                    code: 'WEBHOOK_VERIFICATION_FAILED',
                    message: verificationResult.error.message
                }
            });
        }

        // Handle webhook event
        const handleResult = await handleWebhookEvent('stripe', verificationResult.event);
        
        if (!handleResult.success) {
            console.error('Stripe webhook handling failed:', handleResult.error);
            return res.status(500).json({
                success: false,
                error: {
                    code: 'WEBHOOK_HANDLING_FAILED',
                    message: handleResult.error.message
                }
            });
        }

        // Update payment status in database
        if (handleResult.paymentId) {
            await updatePaymentFromWebhook(handleResult.paymentId, handleResult.status, handleResult.gatewayResponse);
            
            // Publish webhook event
            try {
                await publishPaymentEvent('webhook_received', {
                    paymentId: handleResult.paymentId,
                    status: handleResult.status,
                    gateway: 'stripe',
                    eventType: verificationResult.event.type,
                    correlationId: verificationResult.event.id
                });
            } catch (eventError) {
                console.warn('Failed to publish webhook event:', eventError.message);
            }
        }

        res.json({ success: true, message: 'Webhook processed successfully' });

    } catch (error) {
        console.error('Stripe webhook error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Internal server error',
                details: error.message
            }
        });
    }
});

/**
 * POST /webhooks/mpesa - Handle M-Pesa webhooks
 */
router.post('/mpesa', express.json(), async (req, res) => {
    try {
        const payload = JSON.stringify(req.body);
        const signature = req.headers['x-mpesa-signature'] || '';

        // Verify webhook (M-Pesa doesn't use signature verification like Stripe)
        const verificationResult = await verifyWebhookSignature('mpesa', payload, signature);
        
        if (!verificationResult.success) {
            console.error('M-Pesa webhook verification failed:', verificationResult.error);
            return res.status(400).json({
                success: false,
                error: {
                    code: 'WEBHOOK_VERIFICATION_FAILED',
                    message: verificationResult.error.message
                }
            });
        }

        // Handle webhook event
        const handleResult = await handleWebhookEvent('mpesa', verificationResult.event);
        
        if (!handleResult.success) {
            console.error('M-Pesa webhook handling failed:', handleResult.error);
            return res.status(500).json({
                success: false,
                error: {
                    code: 'WEBHOOK_HANDLING_FAILED',
                    message: handleResult.error.message
                }
            });
        }

        // Update payment status in database
        if (handleResult.paymentId) {
            await updatePaymentFromWebhook(handleResult.paymentId, handleResult.status, handleResult.gatewayResponse);
            
            // Publish webhook event
            try {
                await publishPaymentEvent('webhook_received', {
                    paymentId: handleResult.paymentId,
                    status: handleResult.status,
                    gateway: 'mpesa',
                    eventType: 'stk_callback',
                    correlationId: handleResult.gatewayResponse?.checkout_request_id
                });
            } catch (eventError) {
                console.warn('Failed to publish webhook event:', eventError.message);
            }
        }

        res.json({ success: true, message: 'Webhook processed successfully' });

    } catch (error) {
        console.error('M-Pesa webhook error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Internal server error',
                details: error.message
            }
        });
    }
});

/**
 * Update payment status from webhook
 */
const updatePaymentFromWebhook = async (paymentId, status, gatewayResponse) => {
    try {
        const query = `
            UPDATE payments 
            SET 
                status = $1,
                gateway_response = $2,
                updated_at = NOW()
            WHERE id = $3
        `;

        await dbPoolManager.executeWrite(query, [
            status,
            JSON.stringify(gatewayResponse),
            paymentId
        ]);

        // Log status change in payment history
        const historyQuery = `
            INSERT INTO payment_history (
                payment_id, status, created_at, updated_at
            ) VALUES (
                $1, $2, NOW(), NOW()
            )
        `;

        await dbPoolManager.executeWrite(historyQuery, [paymentId, status]);

        console.log(`Payment ${paymentId} status updated to ${status} via webhook`);

    } catch (error) {
        console.error('Failed to update payment from webhook:', error);
        throw error;
    }
};

/**
 * GET /webhooks/health - Webhook health check
 */
router.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'Webhook endpoints are healthy',
        endpoints: {
            stripe: '/webhooks/stripe',
            mpesa: '/webhooks/mpesa'
        },
        timestamp: new Date().toISOString()
    });
});

export default router;
