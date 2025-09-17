import express from 'express';
import dbPoolManager from '../db/connectionPool.js';
import { API_CONFIG, SECURITY_CONFIG } from '../config/constants.js';

const router = express.Router();

/**
 * GET /payment-history/:paymentId - Get payment history for a specific payment
 */
router.get('/:paymentId', async (req, res) => {
    try {
        const { paymentId } = req.params;

        // Validate UUID format
        const uuidRegex = SECURITY_CONFIG.UUID_PATTERN;
        if (!uuidRegex.test(paymentId)) {
            return res.status(API_CONFIG.STATUS_CODES.BAD_REQUEST).json({
                success: false,
                error: {
                    code: API_CONFIG.ERROR_CODES.VALIDATION_ERROR,
                    message: 'Invalid payment ID format',
                    details: 'Payment ID must be a valid UUID'
                }
            });
        }

        // Use safe helper function
        const query = 'SELECT * FROM get_payment_history($1)';
        const result = await dbPoolManager.executeRead(query, [paymentId]);

        res.status(API_CONFIG.STATUS_CODES.OK).json({
            success: true,
            data: {
                payment_id: paymentId,
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

        // Use safe helper function
        const query = 'SELECT * FROM get_user_payment_history($1, $2, $3)';
        const result = await dbPoolManager.executeRead(query, [userId, limitNum, offsetNum]);

        res.status(API_CONFIG.STATUS_CODES.OK).json({
            success: true,
            data: {
                user_id: userId,
                history: result.rows,
                pagination: {
                    limit: limitNum,
                    offset: offsetNum,
                    count: result.rows.length
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

        // Use safe helper function
        const query = `
            SELECT * FROM create_payment_history_entry(
                $1, $2, $3, $4, $5, $6
            )
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

        if (!historyResult.success) {
            return res.status(API_CONFIG.STATUS_CODES.BAD_REQUEST).json({
                success: false,
                error: {
                    code: API_CONFIG.ERROR_CODES.VALIDATION_ERROR,
                    message: 'Failed to create payment history entry',
                    details: historyResult.error_message
                }
            });
        }

        res.status(API_CONFIG.STATUS_CODES.CREATED).json({
            success: true,
            data: {
                history_id: historyResult.history_id,
                payment_id,
                status,
                previous_status,
                changed_by,
                change_reason,
                metadata
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
