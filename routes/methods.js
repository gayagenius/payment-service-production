import express from 'express';
import dbPoolManager from '../db/connectionPool.js';
import { createPaymentMethodForGateway } from '../services/paymentProcessor.js';
import { API_CONFIG, SECURITY_CONFIG } from '../config/constants.js';

const router = express.Router();

// GET /methods - Get all payment methods
router.get('/', (req, res) => {
    res.json({
        message: 'Get all payment methods',
        data: []
    });
});

// GET /payment/types - Get available payment method types
router.get('/types', async (req, res) => {
    try {
        const { active = true, sort = 'name', limit = 50 } = req.query;
        
        // Validate parameters
        const limitNum = Math.min(parseInt(limit) || 50, 100);
        const sortField = ['name', 'code'].includes(sort) ? sort : 'name';
        const activeFilter = active === 'true' || active === true;
        
        let query = `
            SELECT id, code, name, description, is_active, requires_brand, requires_last4, icon_url, created_at, updated_at
            FROM payment_method_types
            WHERE is_active = $1
            ORDER BY ${sortField}
            LIMIT $2
        `;
        
        const result = await dbPoolManager.executeRead(query, [activeFilter, limitNum]);
        
        res.json({
            success: true,
            data: result.rows.map(row => ({
                id: row.id,
                code: row.code,
                name: row.name,
                description: row.description,
                isActive: row.is_active,
                requiresBrand: row.requires_brand,
                requiresLast4: row.requires_last4,
                iconUrl: row.icon_url,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            })),
            pagination: {
                total: result.rows.length,
                limit: limitNum,
                cursor: null,
                hasMore: false
            },
            metadata: {
                status: 200,
                correlation_id: req.headers['x-request-id'] || 'unknown'
            }
        });
    } catch (error) {
        console.error('Get payment types error:', error);
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

// POST /methods - Add a new payment method
router.post('/', async (req, res) => {
    try {
        const {
            userId,
            type,
            details,
            isDefault = false
        } = req.body;

        // Validate required fields
        if (!userId || !type || !details) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Missing required fields',
                    details: 'userId, type, and details are required'
                }
            });
        }

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

        // Determine gateway based on type
        const gateway = type === 'MPESA' || type === 'MOBILE_MONEY' ? 'mpesa' : 'stripe';

        // Create payment method using gateway
        const paymentMethodData = {
            type,
            gateway,
            ...details
        };

        const result = await createPaymentMethodForGateway(paymentMethodData);

        if (!result.success) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'PAYMENT_METHOD_CREATION_FAILED',
                    message: result.error.message,
                    details: result.error
                }
            });
        }

        // Save payment method to database
        const query = `
            INSERT INTO user_payment_methods (
                user_id, payment_method_type_id, brand, last4, details_encrypted, is_default, created_at, updated_at
            ) VALUES (
                $1, (SELECT id FROM payment_method_types WHERE code = $2), $3, $4, $5, $6, NOW(), NOW()
            ) RETURNING id, created_at, updated_at
        `;

        const dbResult = await dbPoolManager.executeWrite(query, [
            userId,
            type,
            details.brand || null,
            details.last4 || null,
            JSON.stringify(result.gatewayResponse), // Store gateway response as encrypted details
            isDefault
        ]);

        const paymentMethod = dbResult.rows[0];

        res.status(201).json({
            success: true,
            data: {
                id: paymentMethod.id,
                userId,
                type,
                brand: details.brand || null,
                last4: details.last4 || null,
                isDefault,
                createdAt: paymentMethod.created_at,
                updatedAt: paymentMethod.updated_at
            },
            metadata: {
                status: 201,
                correlation_id: req.headers['x-request-id'] || 'unknown'
            }
        });

    } catch (error) {
        console.error('Add payment method error:', error);
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

// GET /methods/:id - Get payment method by ID
router.get('/:id', (req, res) => {
    res.json({
        message: `Get payment method ${req.params.id}`,
        data: { id: req.params.id }
    });
});

// DELETE /methods/:id - Remove payment method
router.delete('/:id', (req, res) => {
    res.json({
        message: `Remove payment method ${req.params.id}`,
        data: { id: req.params.id }
    });
});

export default router;
