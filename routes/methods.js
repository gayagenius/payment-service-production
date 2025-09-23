import express from 'express';
import dbPoolManager from '../db/connectionPool.js';

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
        const query = `
            SELECT id, code, name, description, is_active, requires_brand, requires_last4, icon_url, created_at, updated_at
            FROM payment_method_types
            ORDER BY name
        `;
        
        const result = await dbPoolManager.executeRead(query, []);
        
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
router.post('/', (req, res) => {
    res.json({
        message: 'Add payment method',
        data: req.body
    });
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
