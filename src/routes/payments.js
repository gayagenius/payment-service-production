import express from 'express';

const router = express.Router();

// GET /payments - Get all payments
router.get('/', (req, res) => {
    res.json({
        message: 'Get all payments',
        data: []
    });
});

// POST /payments - Create a new payment
router.post('/', (req, res) => {
    res.json({
        message: 'Create payment',
        data: req.body
    });
});

// GET /payments/:id - Get payment by ID
router.get('/:id', (req, res) => {
    res.json({
        message: `Get payment ${req.params.id}`,
        data: { id: req.params.id }
    });
});

// PUT /payments/:id - Update payment
router.put('/:id', (req, res) => {
    res.json({
        message: `Update payment ${req.params.id}`,
        data: { id: req.params.id, ...req.body }
    });
});

// DELETE /payments/:id - Delete payment
router.delete('/:id', (req, res) => {
    res.json({
        message: `Delete payment ${req.params.id}`,
        data: { id: req.params.id }
    });
});

export default router;
