import express from 'express';
import dbPoolManager from '../db/connectionPool.js';
import { API_CONFIG, PAYMENT_CONFIG, SECURITY_CONFIG } from '../config/constants.js';
import { processRefundForGateway } from '../services/paymentProcessor.js';
import { publishPaymentEvent } from '../messaging/publishPaymentEvent.js';

const router = express.Router();

/**
 * POST /refunds - Create a refund for a payment
 */
router.post('/', async (req, res) => {
    try {
        const {
            payment_id,
            amount,
            reason,
            metadata = {},
            idempotencyKey
        } = req.body;

        // Validate required fields
        if (!payment_id || !amount) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Missing required fields',
                    details: 'payment_id and amount are required'
                }
            });
        }

        // Validate amount
        if (amount <= 0) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_AMOUNT',
                    message: 'Invalid refund amount',
                    details: 'Refund amount must be greater than 0'
                }
            });
        }

        // Get payment details
        const paymentQuery = `
            SELECT p.*, pmt.code as payment_method_type
            FROM payments p
            LEFT JOIN user_payment_methods upm ON p.payment_method_id = upm.id
            LEFT JOIN payment_method_types pmt ON upm.payment_method_type_id = pmt.id
            WHERE p.id = $1
        `;

        const paymentResult = await dbPoolManager.executeRead(paymentQuery, [payment_id]);
        const payment = paymentResult.rows[0];

        if (!payment) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'PAYMENT_NOT_FOUND',
                    message: 'Payment not found',
                    details: `No payment found with ID: ${payment_id}`
                }
            });
        }

        // Check refund amount doesn't exceed payment amount
        if (amount > payment.amount) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'REFUND_AMOUNT_EXCEEDED',
                    message: 'Refund amount exceeds payment amount',
                    details: `Refund amount ${amount} exceeds payment amount ${payment.amount}`
                }
            });
        }

        // Get existing refunds for this payment
        const existingRefundsQuery = `
            SELECT COALESCE(SUM(amount), 0) as total_refunded
            FROM refunds
            WHERE payment_id = $1 AND status = 'SUCCEEDED'
        `;

        const refundsResult = await dbPoolManager.executeRead(existingRefundsQuery, [payment_id]);
        const totalRefunded = parseInt(refundsResult.rows[0].total_refunded);

        // Check if refund amount exceeds available amount
        const availableAmount = payment.amount - totalRefunded;
        if (amount > availableAmount) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'REFUND_AMOUNT_EXCEEDED',
                    message: 'Refund amount exceeds available amount',
                    details: `Refund amount ${amount} exceeds available amount ${availableAmount}`
                }
            });
        }

        // Determine gateway
        const gateway = 'paystack';

        // Generate idempotency key if not provided
        const finalIdempotencyKey = idempotencyKey || `refund_${payment_id}_${Date.now()}`;

        // Create refund in database using direct SQL to avoid function conflicts
        const createRefundQuery = `
            INSERT INTO refunds (
                payment_id, amount, currency, status, reason, idempotency_key
            ) VALUES (
                $1, $2, $3, 'PENDING', $4, $5
            ) RETURNING id as refund_id, payment_id, amount, currency, status, reason, created_at
        `;

        const refundResult = await dbPoolManager.executeWrite(createRefundQuery, [
            payment_id,
            amount,
            payment.currency,
            reason || 'Customer requested refund',
            finalIdempotencyKey
        ]);

        const refund = refundResult.rows[0];

        // Process refund with gateway
        const refundData = {
            gateway,
            transactionId: payment?.gateway_response?.reference,
            amount,
            reason: reason || 'Customer requested refund',
            metadata: {
                ...metadata,
                refund_id: refund.id,
                payment_id,
                user_id: payment.user_id,
                order_id: payment.order_id
            },
            idempotencyKey: finalIdempotencyKey
        };

        // Paystack specific fields (if needed)
        if (gateway === 'paystack') {
            // Add any Paystack-specific fields here if needed
        }

        const gatewayResult = await processRefundForGateway(refundData);

        // Update refund with gateway response
        if (gatewayResult.success) {
            const updateRefundQuery = `
                UPDATE refunds 
                SET status = $2, updated_at = NOW()
                WHERE id = $1
            `;
            
            await dbPoolManager.executeWrite(updateRefundQuery, [
                refund.refund_id,
                gatewayResult.status
            ]);

            // Update payment status if fully refunded
            if (amount === availableAmount) {
                const updatePaymentQuery = `
                    UPDATE payments 
                    SET status = 'REFUNDED', updated_at = NOW()
                    WHERE id = $1
                `;
                await dbPoolManager.executeWrite(updatePaymentQuery, [payment_id]);
            } else {
                const updatePaymentQuery = `
                    UPDATE payments 
                    SET status = 'PARTIALLY_REFUNDED', updated_at = NOW()
                    WHERE id = $1
                `;
                await dbPoolManager.executeWrite(updatePaymentQuery, [payment_id]);
            }

            // Publish refund event
            try {
                await publishPaymentEvent('refund_processed', {
                    refundId: refund.id,
                    payment_id: payment_id,
                    orderId: payment.order_id,
                    userId: payment.user_id,
                    amount: amount,
                    status: gatewayResult.status,
                    gateway: gateway,
                    correlationId: finalIdempotencyKey
                });
            } catch (eventError) {
                console.warn('Failed to publish refund event:', eventError.message);
            }
        } else {
            // Update refund with failure status
            const updateRefundQuery = `
                UPDATE refunds 
                SET status = 'FAILED', updated_at = NOW()
                WHERE id = $1
            `;
            
            await dbPoolManager.executeWrite(updateRefundQuery, [
                refund.refund_id
            ]);
        }

        // Return response
        const responseStatus = gatewayResult.success ? 201 : 400;
        const responseData = {
            id: refund.refund_id,
            payment_id: payment_id,
            amount: amount,
            currency: payment.currency,
            status: gatewayResult.success ? gatewayResult.status : 'FAILED',
            reason: reason || 'Customer requested refund',
            gatewayResponse: gatewayResult.success ? gatewayResult.gatewayResponse : gatewayResult.error,
            idempotencyKey: finalIdempotencyKey,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        if (gatewayResult.success) {
            res.status(responseStatus).json({
                success: true,
                data: responseData,
                metadata: {
                    status: responseStatus,
                    correlation_id: req.headers['x-request-id'] || 'unknown'
                }
            });
        } else {
            res.status(responseStatus).json({
                success: false,
                error: {
                    code: 'REFUND_PROCESSING_FAILED',
                    message: gatewayResult.error.message,
                    details: gatewayResult.error
                },
                data: responseData
            });
        }

    } catch (error) {
        console.error('Refund creation error:', error);
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
 * GET /refunds - Get all refunds with pagination
 */
router.get('/', async (req, res) => {
    try {
        const {
            limit = API_CONFIG.DEFAULT_PAGINATION_LIMIT,
            offset = API_CONFIG.DEFAULT_PAGINATION_OFFSET,
            status,
            payment_id,
            start_date,
            end_date
        } = req.query;

        // Validate parameters
        const limitNum = Math.min(parseInt(limit) || API_CONFIG.DEFAULT_PAGINATION_LIMIT, API_CONFIG.MAX_PAGINATION_LIMIT);
        const offsetNum = Math.max(parseInt(offset) || API_CONFIG.DEFAULT_PAGINATION_OFFSET, 0);

        // Build query
        let query = `
            SELECT r.id, r.payment_id, r.amount, r.currency, r.status, r.reason,
                   r.gateway_response, r.idempotency_key, r.created_at, r.updated_at
            FROM refunds r
            WHERE 1=1
        `;
        
        const params = [];
        let paramCount = 0;

        if (status) {
            paramCount++;
            query += ` AND r.status = $${paramCount}`;
            params.push(status);
        }

        if (payment_id) {
            paramCount++;
            query += ` AND r.payment_id = $${paramCount}`;
            params.push(payment_id);
        }

        if (start_date) {
            paramCount++;
            query += ` AND r.created_at >= $${paramCount}`;
            params.push(start_date);
        }

        if (end_date) {
            paramCount++;
            query += ` AND r.created_at <= $${paramCount}`;
            params.push(end_date);
        }

        query += ` ORDER BY r.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(limitNum, offsetNum);

        const result = await dbPoolManager.executeRead(query, params);

    res.json({
            success: true,
            data: result.rows.map(row => ({
                id: row.id,
                payment_id: row.payment_id,
                amount: row.amount,
                currency: row.currency,
                status: row.status,
                reason: row.reason,
                gatewayResponse: row.gateway_response,
                idempotencyKey: row.idempotency_key,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            })),
            metadata: {
                status: 200,
                correlation_id: req.headers['x-request-id'] || 'unknown'
            }
        });

    } catch (error) {
        console.error('Get refunds error:', error);
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
 * GET /refunds/{id} - Get refund by ID
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Validate UUID format
        if (!SECURITY_CONFIG.UUID_PATTERN.test(id)) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_UUID',
                    message: 'Invalid refund ID format',
                    details: 'Refund ID must be a valid UUID'
                }
            });
        }

        const query = `
            SELECT * FROM refunds WHERE id = $1
        `;

        const result = await dbPoolManager.executeRead(query, [id]);
        const refund = result.rows[0];

        if (!refund) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'REFUND_NOT_FOUND',
                    message: 'Refund not found',
                    details: `No refund found with ID: ${id}`
                }
            });
        }

    res.json({
            success: true,
            data: {
                id: refund.id,
                payment_id: refund.payment_id,
                amount: refund.amount,
                currency: refund.currency,
                status: refund.status,
                reason: refund.reason,
                gatewayResponse: refund.gateway_response,
                idempotencyKey: refund.idempotency_key,
                createdAt: refund.created_at,
                updatedAt: refund.updated_at
            },
            metadata: {
                status: 200,
                correlation_id: req.headers['x-request-id'] || 'unknown'
            }
        });

    } catch (error) {
        console.error('Get refund error:', error);
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

export default router;
