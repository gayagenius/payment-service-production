// import express from 'express';
// const router = express.Router();
// import { connect } from '../../messaging/queueSetup.js';

// router.get('/health', async (req, res) => {
//   try {
//     const isConnected = !!connect();
//     const backlogSize = 0; // backlog size depends on an API or a custom function
//     res.status(200).json({
//       connected: isConnected,
//       backlogSize: backlogSize,
//       message: isConnected ? 'Connected to RabbitMQ.' : 'Not connected to RabbitMQ.'
//     });
//   } catch (err) {
//     res.status(503).json({
//       connected: false,
//       backlogSize: 0,
//       message: 'Failed to connect to RabbitMQ.'
//     });
//   }
// });

// export default router;

// routes/queueHealth.js
import express from 'express';
import amqp from 'amqplib';

const router = express.Router();

// Cache connection status to avoid frequent checks
let connectionStatus = {
  connected: false,
  lastChecked: null,
  backlogSize: 0,
  error: null
};

const RABBITMQ_HOST = process.env.RABBITMQ_HOST || 'localhost';
const RABBITMQ_USER = process.env.RABBITMQ_USER || 'guest';
const RABBITMQ_PASS = process.env.RABBITMQ_PASS || 'guest';
const RABBITMQ_VHOST = process.env.RABBITMQ_VHOST || '/';
const QUEUE_NAME = process.env.RABBITMQ_QUEUE || 'payment_webhooks_queue';

/**
 * Check RabbitMQ connection and queue status
 */
const checkQueueStatus = async () => {
  try {
    const uri = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@${RABBITMQ_HOST}:${RABBITMQ_VHOST}`;
    const connection = await amqp.connect(uri);
    const channel = await connection.createChannel();
    
    // Check if queue exists and get message count
    const queueInfo = await channel.checkQueue(QUEUE_NAME);
    
    connectionStatus = {
      connected: true,
      lastChecked: new Date().toISOString(),
      backlogSize: queueInfo.messageCount,
      error: null
    };

    await channel.close();
    await connection.close();
    
    return connectionStatus;
  } catch (error) {
    connectionStatus = {
      connected: false,
      lastChecked: new Date().toISOString(),
      backlogSize: 0,
      error: error.message
    };
    
    return connectionStatus;
  }
};

/**
 * GET /queue/health - Get queue health status
 */
router.get('/health', async (req, res) => {
  try {
    // Check if we need to refresh status (cache for 30 seconds)
    const now = Date.now();
    const lastCheck = connectionStatus.lastChecked ? new Date(connectionStatus.lastChecked).getTime() : 0;
    const shouldRefresh = now - lastCheck > 30000; // 30 seconds

    if (shouldRefresh || !connectionStatus.lastChecked) {
      await checkQueueStatus();
    }

    const healthStatus = {
      status: connectionStatus.connected ? 'healthy' : 'unhealthy',
      queue: {
        connected: connectionStatus.connected,
        backlogSize: connectionStatus.backlogSize,
        lastChecked: connectionStatus.lastChecked
      },
      timestamp: new Date().toISOString()
    };

    if (!connectionStatus.connected) {
      healthStatus.error = connectionStatus.error;
      return res.status(503).json(healthStatus);
    }

    res.status(200).json(healthStatus);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      message: 'Failed to check queue health',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * GET /queue/metrics - Get detailed queue metrics
 */
router.get('/metrics', async (req, res) => {
  try {
    const status = await checkQueueStatus();
    
    const metrics = {
      queue_connected: status.connected ? 1 : 0,
      queue_backlog_size: status.backlogSize,
      queue_last_check_timestamp: new Date(status.lastChecked).getTime() / 1000,
      service_uptime: process.uptime(),
      memory_usage: process.memoryUsage()
    };

    res.status(200).json(metrics);
  } catch (error) {
    res.status(500).json({
      error: 'Failed to get queue metrics',
      message: error.message
    });
  }
});

export default router;