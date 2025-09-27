import express from 'express';
import dbPoolManager from '../db/connectionPool.js';
import { API_CONFIG, SECURITY_CONFIG } from '../config/constants.js';

const router = express.Router();

/**
 * GET /payment-history - Get all payment history with pagination
 */
router.get('/', async (req, res) => {
    try {
        const { limit = API_CONFIG.DEFAULT_PAGINATION_LIMIT, offset = API_CONFIG.DEFAULT_PAGINATION_OFFSET } = req.query;

        const limitNum = Math.min(parseInt(limit) || API_CONFIG.DEFAULT_PAGINATION_LIMIT, API_CONFIG.MAX_PAGINATION_LIMIT);
        const offsetNum = Math.max(parseInt(offset) || API_CONFIG.DEFAULT_PAGINATION_OFFSET, 0);

        // Use archival lookup function to get payment history from both main and archived tables
        const query = `SELECT * FROM get_payment_history_with_archive(NULL, NULL, $1, $2)`;

        const result = await dbPoolManager.executeRead(query, [limitNum, offsetNum]);

        const countQuery = 'SELECT COUNT(*) as total FROM payments';
        const countResult = await dbPoolManager.executeRead(countQuery, []);
        const total = parseInt(countResult.rows[0].total);

        const formattedHistory = result.rows.map(row => ({
            payment_id: row.payment_id,
            user_id: row.user_id,
            order_id: row.order_id,
            amount: row.amount,
            currency: row.currency,
            status: row.status,
            gateway_response: row.gateway_response,
            idempotency_key: row.idempotency_key,
            metadata: row.metadata,
            created_at: row.created_at,
            updated_at: row.updated_at,
            user: row.metadata?.user || null,
            order: row.metadata?.order || null,
            payment_method: row.gateway_response?.authorization?.authorization_code ? {
                type: row.gateway_response?.channel || 'unknown',
                authorization_code: row.gateway_response?.authorization?.authorization_code,
                card_type: row.gateway_response?.authorization?.card_type,
                last4: row.gateway_response?.authorization?.last4,
                exp_month: row.gateway_response?.authorization?.exp_month,
                exp_year: row.gateway_response?.authorization?.exp_year,
                bank: row.gateway_response?.authorization?.bank,
                country_code: row.gateway_response?.authorization?.country_code
            } : null
        }));

        res.status(API_CONFIG.STATUS_CODES.OK).json({
            success: true,
            data: {
                history: formattedHistory,
                pagination: {
                    limit: limitNum,
                    offset: offsetNum,
                    count: result.rows.length,
                    total: total
                }
            }
        });

    } catch (error) {
        console.error('Error getting all payment history:', error.message);
        res.status(API_CONFIG.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
            success: false,
            error: {
                code: API_CONFIG.ERROR_CODES.INTERNAL_ERROR,
                message: 'Failed to retrieve payment history',
                details: error.message
            }
        });
    }
});

/**
 * GET /payment-history/:payment_id - Get payment history for a specific payment
 */
router.get('/:payment_id', async (req, res) => {
    try {
        const { payment_id } = req.params;

        // Validate UUID format
        const uuidRegex = SECURITY_CONFIG.UUID_PATTERN;
        if (!uuidRegex.test(payment_id)) {
            return res.status(API_CONFIG.STATUS_CODES.BAD_REQUEST).json({
                success: false,
                error: {
                    code: API_CONFIG.ERROR_CODES.VALIDATION_ERROR,
                    message: 'Invalid payment ID format',
                    details: 'Payment ID must be a valid UUID'
                }
            });
        }

        // Use direct SQL query to avoid function conflicts
        const query = `
            SELECT 
                ph.id as history_id,
                ph.payment_id,
                ph.status,
                ph.previous_status,
                ph.changed_by,
                ph.change_reason,
                ph.metadata,
                ph.created_at,
                p.user_id,
                p.order_id,
                p.amount,
                p.currency,
                p.gateway_response,
                p.idempotency_key
            FROM payment_history ph
            JOIN payments p ON ph.payment_id = p.id
            WHERE ph.payment_id = $1
            ORDER BY ph.created_at DESC
        `;
        const result = await dbPoolManager.executeRead(query, [payment_id]);

        res.status(API_CONFIG.STATUS_CODES.OK).json({
            success: true,
            data: {
                payment_id: payment_id,
                history: result.rows
            }
        });

    } catch (error) {
        console.error('Error getting payment history:', error.message);
        res.status(API_CONFIG.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
            success: false,
            error: {
                code: API_CONFIG.ERROR_CODES.INTERNAL_ERROR,
                message: 'Failed to retrieve payment history',
                details: error.message
            }
        });
    }
});

/**
 * GET /payment-history/user/:userId - Get payment history for a user
 */
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit = API_CONFIG.DEFAULT_PAGINATION_LIMIT, offset = API_CONFIG.DEFAULT_PAGINATION_OFFSET } = req.query;

        // Validate UUID format
        const uuidRegex = SECURITY_CONFIG.UUID_PATTERN;
        if (!uuidRegex.test(userId)) {
            return res.status(API_CONFIG.STATUS_CODES.BAD_REQUEST).json({
                success: false,
                error: {
                    code: API_CONFIG.ERROR_CODES.VALIDATION_ERROR,
                    message: 'Invalid user ID format',
                    details: 'User ID must be a valid UUID'
                }
            });
        }

        // Validate pagination parameters
        const limitNum = Math.min(parseInt(limit) || API_CONFIG.DEFAULT_PAGINATION_LIMIT, API_CONFIG.MAX_PAGINATION_LIMIT);
        const offsetNum = Math.max(parseInt(offset) || API_CONFIG.DEFAULT_PAGINATION_OFFSET, 0);

        // Use direct SQL query to avoid function conflicts
        const query = `
            SELECT 
                p.id as payment_id,
                p.user_id,
                p.order_id,
                p.amount,
                p.currency,
                p.status,
                p.gateway_response,
                p.idempotency_key,
                p.metadata,
                p.created_at,
                p.updated_at,
                COUNT(*) OVER() as total_count
            FROM payments p
            WHERE p.user_id = $1
            ORDER BY p.created_at DESC
            LIMIT $2 OFFSET $3
        `;
        const result = await dbPoolManager.executeRead(query, [userId, limitNum, offsetNum]);

        // Format the response with complete payment data
        const formattedHistory = result.rows.map(row => ({
            payment_id: row.payment_id,
            user_id: row.user_id,
            order_id: row.order_id,
            amount: row.amount,
            currency: row.currency,
            status: row.status,
            gateway_response: row.gateway_response,
            idempotency_key: row.idempotency_key,
            metadata: row.metadata,
            created_at: row.created_at,
            updated_at: row.updated_at,
            // Extract user info from metadata
            user: row.metadata?.user || null,
            // Extract order info from metadata
            order: row.metadata?.order || null,
            // Extract payment method info from gateway response
            payment_method: row.gateway_response?.authorization?.authorization_code ? {
                type: row.gateway_response?.channel || 'unknown',
                authorization_code: row.gateway_response?.authorization?.authorization_code,
                card_type: row.gateway_response?.authorization?.card_type,
                last4: row.gateway_response?.authorization?.last4,
                exp_month: row.gateway_response?.authorization?.exp_month,
                exp_year: row.gateway_response?.authorization?.exp_year,
                bank: row.gateway_response?.authorization?.bank,
                country_code: row.gateway_response?.authorization?.country_code
            } : null
        }));

        res.status(API_CONFIG.STATUS_CODES.OK).json({
            success: true,
            data: {
                user_id: userId,
                history: formattedHistory,
                pagination: {
                    limit: limitNum,
                    offset: offsetNum,
                    count: result.rows.length,
                    total: result.rows.length > 0 ? result.rows[0].total_count : 0
                }
            }
        });

    } catch (error) {
        console.error('Error getting user payment history:', error.message);
        res.status(API_CONFIG.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
            success: false,
            error: {
                code: API_CONFIG.ERROR_CODES.INTERNAL_ERROR,
                message: 'Failed to retrieve user payment history',
                details: error.message
            }
        });
    }
});

/**
 * POST /payment-history - Manually create a payment history entry
 */
router.post('/', async (req, res) => {
    try {
        const {
            payment_id,
            status,
            previous_status,
            changed_by,
            change_reason,
            metadata = {}
        } = req.body;

        // Validate required fields
        if (!payment_id || !status) {
            return res.status(API_CONFIG.STATUS_CODES.BAD_REQUEST).json({
                success: false,
                error: {
                    code: API_CONFIG.ERROR_CODES.VALIDATION_ERROR,
                    message: 'Missing required fields',
                    details: 'payment_id and status are required'
                }
            });
        }

        // Validate UUID format for payment_id
        const uuidRegex = SECURITY_CONFIG.UUID_PATTERN;
        if (!uuidRegex.test(payment_id)) {
            return res.status(API_CONFIG.STATUS_CODES.BAD_REQUEST).json({
                success: false,
                error: {
                    code: API_CONFIG.ERROR_CODES.VALIDATION_ERROR,
                    message: 'Invalid payment ID format',
                    details: 'Payment ID must be a valid UUID'
                }
            });
        }

        // Validate UUID format for changed_by if provided
        if (changed_by && !uuidRegex.test(changed_by)) {
            return res.status(API_CONFIG.STATUS_CODES.BAD_REQUEST).json({
                success: false,
                error: {
                    code: API_CONFIG.ERROR_CODES.VALIDATION_ERROR,
                    message: 'Invalid changed_by ID format',
                    details: 'Changed by ID must be a valid UUID'
                }
            });
        }

        // Use direct SQL query to avoid function conflicts
        const query = `
            INSERT INTO payment_history (
                payment_id, status, previous_status, changed_by, change_reason, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id as history_id, payment_id, status, previous_status, changed_by, change_reason, metadata, created_at
        `;
        const result = await dbPoolManager.executeWrite(query, [
            payment_id,
            status,
            previous_status,
            changed_by,
            change_reason,
            JSON.stringify(metadata)
        ]);

        const historyResult = result.rows[0];

        res.status(API_CONFIG.STATUS_CODES.CREATED).json({
            success: true,
            data: {
                history_id: historyResult.history_id,
                payment_id: historyResult.payment_id,
                status: historyResult.status,
                previous_status: historyResult.previous_status,
                changed_by: historyResult.changed_by,
                change_reason: historyResult.change_reason,
                metadata: historyResult.metadata,
                created_at: historyResult.created_at
            }
        });

    } catch (error) {
        console.error('Error creating payment history entry:', error.message);
        res.status(API_CONFIG.STATUS_CODES.INTERNAL_SERVER_ERROR).json({
            success: false,
            error: {
                code: API_CONFIG.ERROR_CODES.INTERNAL_ERROR,
                message: 'Failed to create payment history entry',
                details: error.message
            }
        });
    }
});

export default router;
