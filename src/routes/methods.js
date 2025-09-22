import express from 'express';

const router = express.Router();

// GET /methods - Get all payment methods
router.get('/', (req, res) => {
    res.json({
        message: 'Get all payment methods',
        data: []
    });
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
