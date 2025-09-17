import express from "express";
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import prometheus from 'prom-client';
import { collectRateLimitMetrics, rateLimitRegister } from "./metrics/rateLimitMetrics.js";
import { consumerRegister } from "./metrics/consumerMetrics.js";
import payments from "./routes/payments.js";
import refunds from "./routes/refunds.js";
import methods from "./routes/methods.js";
import queueHealthRouter from "./routes/queueHealth.js"
import testRouter from "./routes/test.js"; 

import { 
  paymentRateLimit, 
  refundRateLimit, 
  generalRateLimit, 
  healthRateLimit 
} from './middlewares/rateLimit.js';

import { connect } from "./messaging/queueSetup.js";
import EventConsumer from './workers/eventConsumer.js';
import DLQManager from "./messaging/dlqSetUp.js";
import { initializeSchemaValidation } from "./utils/validateEventSchema.js";
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

// Global rate limiting with custom headers
app.use('/api', generalRateLimit);
app.use('/api', collectRateLimitMetrics('api', 'general'));
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

// Metrics endpoint for Prometheus
app.get('/metrics', async (req, res) => {
  if (!rateLimitRegister || !consumerRegister || !prometheus?.register) {
  throw new Error('One or more metric registries are not initialized');
}
  try {
    // Combine metrics from different registries
    const rateLimitMetrics = await rateLimitRegister.metrics();
    const consumerMetrics = await consumerRegister.metrics();
    const defaultMetrics = await prometheus.register.metrics();
    
    const allMetrics = [rateLimitMetrics, consumerMetrics, defaultMetrics]
      .filter(Boolean)
      .join('\n');
      
    res.set('Content-Type', prometheus.register.contentType);
    res.send(allMetrics);
  } catch (error) {
    console.error('Error generating metrics:', error);
    res.status(500).json({ error: 'Failed to generate metrics' });
  }
});


// Routes with specific rate limiting
app.use('/payments', paymentRateLimit, collectRateLimitMetrics('payments', 'payment'), payments);
app.use('/refunds', refundRateLimit, collectRateLimitMetrics('refunds', 'refund'), refunds);
app.use('/methods', generalRateLimit, collectRateLimitMetrics('methods', 'general'), methods);
app.use('/queue', healthRateLimit, collectRateLimitMetrics('queue', 'health'), queueHealthRouter);
app.use('/test', generalRateLimit, collectRateLimitMetrics('test', 'general'), testRouter);


// Global error handler
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

app.use('*', (req, res) => {
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

// Application state
let rabbitmqConnection = null;
let eventConsumer = null;
let dlqManager = null;

async function initializeServices() {
  try {
    console.log('Initializing payment service...');
    
    // Initialize schema validation
    initializeSchemaValidation();
    console.log('Schema validation initialized');
    
    // Connect to RabbitMQ 
    try {
      rabbitmqConnection = await connect();
      console.log('RabbitMQ connected');
      
      // Initialize DLQ Manager
      dlqManager = new DLQManager(rabbitmqConnection);
      await dlqManager.initialize();
      
      // Start DLQ monitoring
      dlqManager.startMonitoring(100); 
      dlqManager.on('alert', (alert) => {
        console.warn('DLQ Alert:', alert);
      });
      
      console.log('DLQ Manager initialized');
      
      // Initialize Event Consumer
      eventConsumer = new EventConsumer({
        prefetchCount: 10,
        concurrency: 5,
        deduplicationTtl: 24 * 60 * 60 
      });
      
      await eventConsumer.initialize();
      await eventConsumer.startConsuming();
      
      // Log consumer metrics periodically
      setInterval(() => {
        const stats = eventConsumer.getStats();
        console.log('Consumer stats:', stats);
      }, 60000); // Every minute
      
      console.log('Event Consumer started');
      
    } catch (mqError) {
      console.warn('RabbitMQ connection failed, messaging features disabled:', mqError.message);
      // Continue without messaging - service can still handle HTTP requests
    }
    
    console.log('Payment service initialization complete');
    
  } catch (error) {
    console.error('Failed to initialize services:', error);
    throw error;
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
    
    // Shutdown event consumer
    if (eventConsumer) {
      await eventConsumer.shutdown();
      console.log('Event consumer shut down');
    }
    
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
let server;

const startServer = async () => {
  try {
    await initializeServices();
    
    server = app.listen(PORT, () => {
      console.log(`Payment service running on http://localhost:${PORT}`);
      console.log(`Metrics available at http://localhost:${PORT}/metrics`);
      console.log(`API docs at http://localhost:${PORT}/api-docs`);
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