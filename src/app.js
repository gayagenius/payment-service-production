import 'dotenv/config';
import express from "express";
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import bodyParser from "body-parser";

// Import the Paystack webhook router
import paystackWebhook from "../routes/webhooks/paystack.js"; // Add this line

import payments from "../routes/payments-integrated.js";
import refunds from "../routes/refunds.js";
import methods from "../routes/methods.js";
import paymentHistory from "../routes/paymentHistory.js";
import queueHealthRouter from "../routes/queueHealth.js";
import testRouter from "../routes/test.js"; 
import { connect } from "../messaging/queueSetup.js";
import {
  paymentRateLimit,
  refundRateLimit,
  generalRateLimit,
  healthRateLimit
} from "../middlewares/rateLimit.js";

import EventConsumer from "../workers/eventConsumer.js";
import DLQManager from "../messaging/dlqSetUp.js";
import { initializeSchemaValidation } from "../utils/validateEventSchema.js";

import('./../docs-server.js');

const app = express();

app.set('trust proxy', 1);

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  optionsSuccessStatus: 200
}));
app.use(compression());

// Use the imported paystackWebhook router
app.use('/webhooks', paystackWebhook); // This line now uses the imported router


app.use(bodyParser.json());

app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(`${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`);
  });
  
  next();
});


// Routes
app.use("/payments", paymentRateLimit, payments);
app.use("/refunds", refundRateLimit, refunds);
app.use("/methods", generalRateLimit, methods);
app.use("/payments/methods", generalRateLimit, methods); // Add payment methods route under payments
app.use("/payment", generalRateLimit, methods); // Add payment types route
app.use("/payment-history", generalRateLimit, paymentHistory);
app.use("/queue",  healthRateLimit, queueHealthRouter);
app.use("/test", generalRateLimit, testRouter);

// Serve Swagger UI on main port
app.use('/docs', generalRateLimit, express.static('docs'));
// app.use('/api', generalRateLimit, express.static('api'));
app.get('/health', healthRateLimit, (req, res) => {
  res.json({
    status: 'healthy',
    service: 'payment-service',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0'
  });
});

// Return URL endpoint for paystack redirects
app.get('/payments/return', (req, res) => {
  const { payment_intent, payment_intent_client_secret } = req.query;
  
  if (payment_intent) {
    res.json({
      success: true,
      message: 'Payment completed successfully',
      payment_intent,
      payment_intent_client_secret
    });
  } else {
    res.json({
      success: false,
      message: 'Payment failed or was cancelled'
    });
  }
});

app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  res.status(error.status || 500).json({
    success: false,
    error: {
      code: error.code || 'INTERNAL_SERVER_ERROR',
      message: isDevelopment ? error.message : 'An internal server error occurred',
      timestamp: new Date().toISOString(),
      ...(isDevelopment && { stack: error.stack })
    }
  });
});

// 404 handler for unmatched routes (no path specified)
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: 'The requested resource was not found',
      path: req.originalUrl,
      method: req.method,
      timestamp: new Date().toISOString()
    }
  });
});

let rabbitmqConnection = null;
let eventConsumer = null;
let dlqManager = null;

async function initializeServices() {
  try {
    console.log('Initializing payment service...');
    
    // Initialize schema validation first (lightweight)
    initializeSchemaValidation();
    console.log('Schema validation initialized');

    // Wait a bit for Docker networking to stabilize
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Connect to RabbitMQ with better error handling
    try {
      rabbitmqConnection = await connect();
      console.log('✅ RabbitMQ connected successfully');
      
      // Initialize DLQ Manager
      dlqManager = new DLQManager(rabbitmqConnection);
      await dlqManager.initialize();
      console.log('✅ DLQ Manager initialized');

      // Initialize Webhook Consumer with correct queue name
      const WebhookConsumer = await import('../workers/webhookConsumer.js');
      eventConsumer = new WebhookConsumer.default({
        prefetchCount: 10,
        concurrency: 5,
        queueName: 'paystack.webhook.received_queue'  // Explicit queue name
      });
      
      await eventConsumer.initialize();
      await eventConsumer.startConsuming();
      console.log('✅ Webhook Consumer started');

    } catch (mqError) {
      console.error('❌ RabbitMQ connection failed:', mqError.message);
      console.warn('Messaging features disabled, but HTTP API remains available');
      // Don't throw - allow the service to start without RabbitMQ
    }

    console.log('✅ Payment service initialization complete');

  } catch (error) {
    console.error('❌ Failed to initialize services:', error);
    // Graceful degradation - start without messaging features
    console.warn('Starting with degraded mode (HTTP API only)');
  }
}

/**
 * Graceful shutdown handler
 */
async function gracefulShutdown(signal) {
  console.log(`\nReceived ${signal}, starting graceful shutdown...`);
  
  //timeout for forceful shutdown
  const shutdownTimeout = setTimeout(() => {
    console.error('Shutdown timeout reached, forcing exit');
    process.exit(1);
  }, 30000); // 30 seconds
  
  try {
    // Stop accepting new connections
    if (server) {
      server.close(() => {
        console.log('HTTP server closed');
      });
    }
    
    // // Shutdown event consumer
    // if (eventConsumer) {
    //   await eventConsumer.shutdown();
    //   console.log('Event consumer shut down');
    // }
    
    // Shutdown DLQ manager
    if (dlqManager) {
      await dlqManager.close();
      console.log('DLQ manager closed');
    }
    
    // Close RabbitMQ connection
    if (rabbitmqConnection) {
      await rabbitmqConnection.close();
      console.log('RabbitMQ connection closed');
    }
    
    clearTimeout(shutdownTimeout);
    console.log('Graceful shutdown complete');
    process.exit(0);
    
  } catch (error) {
    console.error('Error during shutdown:', error);
    clearTimeout(shutdownTimeout);
    process.exit(1);
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});


// Start server
const PORT = process.env.PORT || 8080;
let server = null;

const startServer = async () => {
  try {
    await initializeServices();
    
    server = app.listen(PORT, () => {
      console.log(`Payment service running on http://localhost:${PORT}`);
      console.log(`API docs at http://localhost:${PORT}/docs`);
      console.log(`Health check at http://localhost:${PORT}/health`);
      
      // Log environment info
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`Node version: ${process.version}`);
    });
    
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

export default app;
