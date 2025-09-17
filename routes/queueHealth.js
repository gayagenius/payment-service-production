import express from 'express';
const router = express.Router();
import { connect } from '../messaging/queueSetup.js';

router.get('/health', async (req, res) => {
  try {
    const isConnected = !!connect();
    const backlogSize = 0; // backlog size depends on an API or a custom function
    res.status(200).json({
      connected: isConnected,
      backlogSize: backlogSize,
      message: isConnected ? 'Connected to RabbitMQ.' : 'Not connected to RabbitMQ.'
    });
  } catch (err) {
    res.status(503).json({
      connected: false,
      backlogSize: 0,
      message: 'Failed to connect to RabbitMQ.'
    });
  }
});

export default router;
