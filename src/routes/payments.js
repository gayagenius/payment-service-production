import express from 'express';
import dbPoolManager from '../db/connectionPool.js';
import { API_CONFIG, PAYMENT_CONFIG, SECURITY_CONFIG } from '../config/constants.js';

const router = express.Router();

/**
 * GET /payments - Get all payments with pagination
 * 
 * Query Parameters:
 * - limit: Number of payments to return (default: 50, max: 100)
 * - offset: Number of payments to skip (default: 0)
 * - status: Filter by payment status
 * - user_id: Filter by user ID
 * - start_date: Filter payments created after this date
 * - end_date: Filter payments created before this date
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
                   p.gateway_response, p.idempotency_key, p.metadata,
                   p.created_at, p.updated_at
            FROM payments_partitioned p
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

        // Execute query
        const result = await dbPoolManager.executeRead(query, params);

        res.json({
            success: true,
            data: result.rows,
            pagination: {
                limit: limitNum,
                offset: offsetNum,
                count: result.rows.length
            }
        });

    } catch (error) {
        console.error('Error getting payments:', error.message);
        res.status(API_CONFIG.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
            success: false,
            error: {
                code: API_CONFIG.ERROR_CODES.INTERNAL_ERROR,
                message: 'Failed to retrieve payments',
                details: error.message
            }
        });
    }
});

/**
 * POST /payments - Create a new payment with retry support
 * 
 * Request Body:
 * - user_id: UUID of the user
 * - order_id: Order identifier
 * - amount: Payment amount in minor units
 * - currency: Currency code (3 characters)
 * - metadata: Optional payment metadata
 * - gateway_response: Optional gateway response data
 * - idempotency_key: Optional idempotency key for retry safety
 * - retry: Boolean indicating if this is a retry attempt
 */
router.post('/', async (req, res) => {
    try {
        const {
            user_id,
            order_id,
            amount,
            currency,
            metadata,
            gateway_response = {},
            idempotency_key,
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

        // Generate idempotency key if not provided
        const finalIdempotencyKey = idempotency_key || `${PAYMENT_CONFIG.IDEMPOTENCY.PREFIX}${PAYMENT_CONFIG.IDEMPOTENCY.SEPARATOR}${user_id}${PAYMENT_CONFIG.IDEMPOTENCY.SEPARATOR}${order_id}${PAYMENT_CONFIG.IDEMPOTENCY.SEPARATOR}${Date.now()}`;

        // Use database helper function for atomic payment creation
        const query = `
            SELECT * FROM create_payment_with_history(
                $1, $2, $3, $4, $5, $6, $7, $8
            )
        `;

        const result = await dbPoolManager.executeWrite(query, [
            user_id,
            order_id,
            amount,
            currency,
            metadata,
            JSON.stringify(gateway_response),
            finalIdempotencyKey,
            retry
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

        // Check if this was a retry (existing payment returned)
        if (paymentResult.error_message === 'Payment already exists') {
            return res.status(200).json({
                success: true,
                data: {
                    id: paymentResult.payment_id,
                    status: paymentResult.status,
                    created_at: paymentResult.created_at,
                    idempotency_key: finalIdempotencyKey,
                    retry: true,
                    message: 'Payment already exists (idempotency)'
                }
            });
        }

        // Return successful payment creation
        res.status(201).json({
            success: true,
            data: {
                id: paymentResult.payment_id,
                user_id,
                order_id,
                amount,
                currency,
                status: paymentResult.status,
                metadata,
                gateway_response,
                idempotency_key: finalIdempotencyKey,
                created_at: paymentResult.created_at,
                retry: false
            }
        });

    } catch (error) {
        console.error('Error creating payment:', error.message);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Failed to create payment',
                details: error.message
            }
        });
    }
});

/**
 * GET /payments/:id - Get payment by ID
 * 
 * Path Parameters:
 * - id: Payment UUID
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Validate UUID format
        const uuidRegex = SECURITY_CONFIG.UUID_PATTERN;
        if (!uuidRegex.test(id)) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid payment ID format',
                    details: 'Payment ID must be a valid UUID'
                }
            });
        }

        // Use database helper function
        const query = `SELECT * FROM get_payment_by_id($1)`;
        const result = await dbPoolManager.executeRead(query, [id]);

        const payment = result.rows[0];

        if (!payment.found) {
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
                user_id: payment.user_id,
                order_id: payment.order_id,
                amount: payment.amount,
                currency: payment.currency,
                status: payment.status,
                metadata: payment.metadata,
                gateway_response: payment.gateway_response,
                idempotency_key: payment.idempotency_key,
                created_at: payment.created_at,
                updated_at: payment.updated_at
            }
        });

    } catch (error) {
        console.error('Error getting payment:', error.message);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Failed to retrieve payment',
                details: error.message
            }
        });
    }
});

/**
 * PUT /payments/:id - Update payment status
 * 
 * Path Parameters:
 * - id: Payment UUID
 * 
 * Request Body:
 * - status: New payment status
 * - gateway_response: Optional updated gateway response
 */
router.put('/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, gateway_response } = req.body;

        // Validate UUID format
        const uuidRegex = SECURITY_CONFIG.UUID_PATTERN;
        if (!uuidRegex.test(id)) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid payment ID format',
                    details: 'Payment ID must be a valid UUID'
                }
            });
        }

        // Validate status
        if (!status) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Status is required',
                    details: 'Payment status must be provided'
                }
            });
        }

        // Use database helper function
        const query = `SELECT * FROM update_payment_status($1, $2, $3)`;
        const result = await dbPoolManager.executeWrite(query, [
            id,
            status,
            gateway_response ? JSON.stringify(gateway_response) : null
        ]);

        const updateResult = result.rows[0];

        if (!updateResult.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'PAYMENT_UPDATE_FAILED',
                    message: 'Failed to update payment',
                    details: updateResult.error_message
                }
            });
        }

        res.json({
            success: true,
            data: {
                id,
                old_status: updateResult.old_status,
                new_status: updateResult.new_status,
                updated_at: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('Error updating payment:', error.message);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Failed to update payment',
                details: error.message
            }
        });
    }
});

/**
 * GET /payments/user/:userId - Get payments for a specific user
 * 
 * Path Parameters:
 * - userId: User UUID
 * 
 * Query Parameters:
 * - limit: Number of payments to return (default: 50, max: 100)
 * - offset: Number of payments to skip (default: 0)
 * - status: Filter by payment status
 */
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit = 50, offset = 0, status } = req.query;

        // Validate UUID format
        const uuidRegex = SECURITY_CONFIG.UUID_PATTERN;
        if (!uuidRegex.test(userId)) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid user ID format',
                    details: 'User ID must be a valid UUID'
                }
            });
        }

        // Validate parameters
        const limitNum = Math.min(parseInt(limit) || 50, 100);
        const offsetNum = Math.max(parseInt(offset) || 0, 0);

        // Use database helper function
        const query = `SELECT * FROM get_payments_by_user($1, $2, $3, $4)`;
        const result = await dbPoolManager.executeRead(query, [
            userId,
            limitNum,
            offsetNum,
            status || null
        ]);

        const payments = result.rows;
        const totalCount = payments.length > 0 ? payments[0].total_count : 0;

        res.json({
            success: true,
            data: payments.map(payment => ({
                id: payment.id,
                user_id: payment.user_id,
                order_id: payment.order_id,
                amount: payment.amount,
                currency: payment.currency,
                status: payment.status,
                metadata: payment.metadata,
                gateway_response: payment.gateway_response,
                idempotency_key: payment.idempotency_key,
                created_at: payment.created_at,
                updated_at: payment.updated_at
            })),
            pagination: {
                limit: limitNum,
                offset: offsetNum,
                total: totalCount,
                count: payments.length
            }
        });

    } catch (error) {
        console.error('Error getting user payments:', error.message);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Failed to retrieve user payments',
                details: error.message
            }
        });
    }
});

export default router;
