import express from 'express';

const router = express.Router();

// GET /refunds - Get all refunds
router.get('/', (req, res) => {
    res.json({
        message: 'Get all refunds',
        data: []
    });
});

// POST /refunds - Create a new refund
router.post('/', (req, res) => {
    res.json({
        message: 'Create refund',
        data: req.body
    });
});

// GET /refunds/:id - Get refund by ID
router.get('/:id', (req, res) => {
    res.json({
        message: `Get refund ${req.params.id}`,
        data: { id: req.params.id }
    });
});

export default router;
