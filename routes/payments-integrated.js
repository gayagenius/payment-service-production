import express from 'express';
import dbPoolManager from '../db/connectionPool.js';
import { API_CONFIG, PAYMENT_CONFIG, SECURITY_CONFIG } from '../config/constants.js';
import { processPayment, createPaymentMethodForGateway } from '../services/paymentProcessor.js';
import { publishPaymentEvent } from '../messaging/publishPaymentEvent.js';

const router = express.Router();

/**
 * GET /payments - Get all payments with pagination
 */
router.get('/', async (req, res) => {
    try {
        const {
            limit = API_CONFIG.DEFAULT_PAGINATION_LIMIT,
            offset = API_CONFIG.DEFAULT_PAGINATION_OFFSET,
            status,
            user_id,
            start_date,
            end_date
        } = req.query;

        // Validate parameters
        const limitNum = Math.min(parseInt(limit) || API_CONFIG.DEFAULT_PAGINATION_LIMIT, API_CONFIG.MAX_PAGINATION_LIMIT);
        const offsetNum = Math.max(parseInt(offset) || API_CONFIG.DEFAULT_PAGINATION_OFFSET, 0);

        // Build query
        let query = `
            SELECT p.id, p.user_id, p.order_id, p.amount, p.currency, p.status,
                   p.payment_method_id, p.gateway_response, p.idempotency_key,
                   p.created_at, p.updated_at
            FROM payments p
            WHERE 1=1
        `;
        
        const params = [];
        let paramCount = 0;

        if (status) {
            paramCount++;
            query += ` AND p.status = $${paramCount}`;
            params.push(status);
        }

        if (user_id) {
            paramCount++;
            query += ` AND p.user_id = $${paramCount}`;
            params.push(user_id);
        }

        if (start_date) {
            paramCount++;
            query += ` AND p.created_at >= $${paramCount}`;
            params.push(start_date);
        }

        if (end_date) {
            paramCount++;
            query += ` AND p.created_at <= $${paramCount}`;
            params.push(end_date);
        }

        query += ` ORDER BY p.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(limitNum, offsetNum);

        const result = await dbPoolManager.executeRead(query, params);

        res.json({
            success: true,
            data: result.rows.map(row => ({
                id: row.id,
                userId: row.user_id,
                orderId: row.order_id,
                amount: row.amount,
                currency: row.currency,
                status: row.status,
                paymentMethodId: row.payment_method_id,
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
        console.error('Get payments error:', error);
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
 * POST /payments - Create a new payment with real gateway processing
 */
router.post('/', async (req, res) => {
    try {
        const {
            userId: user_id,
            orderId: order_id,
            amount,
            currency,
            paymentMethodId,
            paymentMethod,
            metadata = {},
            idempotencyKey,
            retry = false
        } = req.body;

        // Validate required fields
        if (!user_id || !order_id || !amount || !currency) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Missing required fields',
                    details: 'user_id, order_id, amount, and currency are required'
                }
            });
        }

        // Validate amount
        if (amount <= PAYMENT_CONFIG.AMOUNT.MIN) {
            return res.status(API_CONFIG.STATUS_CODES.BAD_REQUEST).json({
                success: false,
                error: {
                    code: API_CONFIG.ERROR_CODES.VALIDATION_ERROR,
                    message: 'Invalid amount',
                    details: `Amount must be greater than ${PAYMENT_CONFIG.AMOUNT.MIN}`
                }
            });
        }

        // Validate currency
        if (currency.length !== PAYMENT_CONFIG.CURRENCY.LENGTH) {
            return res.status(API_CONFIG.STATUS_CODES.BAD_REQUEST).json({
                success: false,
                error: {
                    code: API_CONFIG.ERROR_CODES.VALIDATION_ERROR,
                    message: 'Invalid currency',
                    details: `Currency must be ${PAYMENT_CONFIG.CURRENCY.LENGTH} characters`
                }
            });
        }

        // Validate metadata structure
        if (metadata && typeof metadata === 'object') {
            // Validate user information in metadata
            if (metadata.user) {
                if (typeof metadata.user !== 'object') {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'INVALID_METADATA',
                            message: 'Invalid user metadata',
                            details: 'metadata.user must be an object'
                        }
                    });
                }
                
                // Validate user ID matches the main userId
                if (metadata.user.id && metadata.user.id !== user_id) {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'USER_ID_MISMATCH',
                            message: 'User ID mismatch',
                            details: 'metadata.user.id must match the main userId'
                        }
                    });
                }
            }

            // Validate order information in metadata
            if (metadata.order) {
                if (typeof metadata.order !== 'object') {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'INVALID_METADATA',
                            message: 'Invalid order metadata',
                            details: 'metadata.order must be an object'
                        }
                    });
                }
                
                // Validate order ID matches the main orderId
                if (metadata.order.id && metadata.order.id !== order_id) {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'ORDER_ID_MISMATCH',
                            message: 'Order ID mismatch',
                            details: 'metadata.order.id must match the main orderId'
                        }
                    });
                }
            }

            // Validate M-Pesa specific metadata
            if (metadata.phoneNumber && typeof metadata.phoneNumber !== 'string') {
                return res.status(400).json({
                    success: false,
                    error: {
                        code: 'INVALID_METADATA',
                        message: 'Invalid phone number',
                        details: 'metadata.phoneNumber must be a string'
                    }
                });
            }
        }

        // Generate idempotency key if not provided
        const finalIdempotencyKey = idempotencyKey || `${PAYMENT_CONFIG.IDEMPOTENCY.PREFIX}${PAYMENT_CONFIG.IDEMPOTENCY.SEPARATOR}${user_id}${PAYMENT_CONFIG.IDEMPOTENCY.SEPARATOR}${order_id}${PAYMENT_CONFIG.IDEMPOTENCY.SEPARATOR}${Date.now()}`;

        // Determine payment method type and gateway
        let paymentMethodType = 'CARD';
        let gateway = 'stripe';
        
        if (paymentMethod) {
            paymentMethodType = paymentMethod.type;
            gateway = paymentMethodType === 'MPESA' || paymentMethodType === 'MOBILE_MONEY' ? 'mpesa' : 'stripe';
        } else if (paymentMethodId) {
            // Get payment method details from database to determine type
            const methodQuery = `
                SELECT pmt.code as type 
                FROM user_payment_methods upm
                JOIN payment_method_types pmt ON upm.payment_method_type_id = pmt.id
                WHERE upm.id = $1
            `;
            const methodResult = await dbPoolManager.executeRead(methodQuery, [paymentMethodId]);
            if (methodResult.rows.length > 0) {
                paymentMethodType = methodResult.rows[0].type;
                gateway = paymentMethodType === 'MPESA' || paymentMethodType === 'MOBILE_MONEY' ? 'mpesa' : 'stripe';
            }
        }

        // Create payment in database first
        const query = `
            SELECT * FROM create_payment_with_history(
                $1, $2, $3, $4, $5, $6, $7, $8, $9
            )
        `;

        const result = await dbPoolManager.executeWrite(query, [
            user_id,
            order_id,
            amount,
            currency,
            paymentMethodId,
            JSON.stringify({}), // Will be updated after gateway processing
            finalIdempotencyKey,
            retry,
            JSON.stringify(metadata) // Store metadata
        ]);

        const paymentResult = result.rows[0];

        if (!paymentResult.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'PAYMENT_CREATION_FAILED',
                    message: 'Failed to create payment',
                    details: paymentResult.error_message
                }
            });
        }

        // Process payment with gateway
        const paymentData = {
            paymentMethodType,
            amount,
            currency,
            paymentMethodId,
            paymentMethod,
            metadata: {
                ...metadata,
                payment_id: paymentResult.payment_id,
                order_id,
                user_id
            },
            idempotencyKey: finalIdempotencyKey
        };

        // Add M-Pesa specific fields
        if (gateway === 'mpesa') {
            paymentData.phoneNumber = metadata.phoneNumber || paymentMethod?.phoneNumber || metadata.user?.phone;
            paymentData.accountReference = order_id;
            paymentData.transactionDesc = metadata.description || metadata.order?.description || `Payment for order ${order_id}`;
        }

        const gatewayResult = await processPayment(paymentData);

        // Update payment with gateway response
        if (gatewayResult.success) {
            const updateQuery = `
                UPDATE payments 
                SET status = $1, gateway_response = $2, updated_at = NOW()
                WHERE id = $3
            `;
            
            await dbPoolManager.executeWrite(updateQuery, [
                gatewayResult.status,
                JSON.stringify(gatewayResult.gatewayResponse),
                paymentResult.payment_id
            ]);

            // Publish payment event
            try {
                await publishPaymentEvent('payment_processed', {
                    paymentId: paymentResult.payment_id,
                    orderId: order_id,
                    userId: user_id,
                    amount: amount,
                    status: gatewayResult.status,
                    gateway: gateway,
                    correlationId: finalIdempotencyKey
                });
            } catch (eventError) {
                console.warn('Failed to publish payment event:', eventError.message);
            }
        } else {
            // Update payment with failure status
            const updateQuery = `
                UPDATE payments 
                SET status = 'FAILED', gateway_response = $1, updated_at = NOW()
                WHERE id = $2
            `;
            
            await dbPoolManager.executeWrite(updateQuery, [
                JSON.stringify(gatewayResult.error),
                paymentResult.payment_id
            ]);
        }

        // Return response
        const responseStatus = gatewayResult.success ? 201 : 400;
        const responseData = {
            id: paymentResult.payment_id,
            userId: user_id,
            orderId: order_id,
            amount: amount,
            currency: currency,
            status: gatewayResult.success ? gatewayResult.status : 'FAILED',
            paymentMethodId: paymentMethodId,
            gatewayResponse: gatewayResult.success ? gatewayResult.gatewayResponse : gatewayResult.error,
            idempotencyKey: finalIdempotencyKey,
            retry: retry,
            metadata: metadata,
            createdAt: paymentResult.created_at,
            updatedAt: new Date().toISOString()
        };

        if (gatewayResult.success) {
            res.status(responseStatus).json({
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
                    code: 'PAYMENT_PROCESSING_FAILED',
                    message: gatewayResult.error.message,
                    details: gatewayResult.error
                },
                data: responseData
            });
        }

    } catch (error) {
        console.error('Payment creation error:', error);
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
 * GET /payments/{id} - Get payment by ID
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
                    message: 'Invalid payment ID format',
                    details: 'Payment ID must be a valid UUID'
                }
            });
        }

        const query = `
            SELECT * FROM get_payment_by_id($1)
        `;

        const result = await dbPoolManager.executeRead(query, [id]);
        const payment = result.rows[0];

        if (!payment || !payment.found) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'PAYMENT_NOT_FOUND',
                    message: 'Payment not found',
                    details: `No payment found with ID: ${id}`
                }
            });
        }

        res.json({
            success: true,
            data: {
                id: payment.id,
                userId: payment.user_id,
                orderId: payment.order_id,
                amount: payment.amount,
                currency: payment.currency,
                status: payment.status,
                paymentMethodId: payment.payment_method_id,
                gatewayResponse: payment.gateway_response,
                idempotencyKey: payment.idempotency_key,
                createdAt: payment.created_at,
                updatedAt: payment.updated_at
            },
            metadata: {
                status: 200,
                correlation_id: req.headers['x-request-id'] || 'unknown'
            }
        });

    } catch (error) {
        console.error('Get payment error:', error);
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
 * GET /payments/user/{userId} - Get payments for a user
 */
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit = 20, offset = 0, status } = req.query;

        // Validate UUID format
        if (!SECURITY_CONFIG.UUID_PATTERN.test(userId)) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_UUID',
                    message: 'Invalid user ID format',
                    details: 'User ID must be a valid UUID'
                }
            });
        }

        const limitNum = Math.min(parseInt(limit) || 20, 100);
        const offsetNum = Math.max(parseInt(offset) || 0, 0);

        const query = `
            SELECT * FROM get_payments_by_user($1, $2, $3, $4)
        `;

        const result = await dbPoolManager.executeRead(query, [
            userId,
            limitNum,
            offsetNum,
            status && status !== '0' ? status : null
        ]);

        const payments = result.rows.map(row => ({
            id: row.id,
            userId: row.user_id,
            orderId: row.order_id,
            amount: row.amount,
            currency: row.currency,
            status: row.status,
            paymentMethodId: row.payment_method_id,
            gatewayResponse: row.gateway_response,
            idempotencyKey: row.idempotency_key,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));

        res.json({
            success: true,
            data: payments,
            metadata: {
                status: 200,
                correlation_id: req.headers['x-request-id'] || 'unknown',
                total_count: result.rows.length > 0 ? result.rows[0].total_count : 0
            }
        });

    } catch (error) {
        console.error('Get user payments error:', error);
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
