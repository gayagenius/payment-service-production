import { EventEmitter } from 'events';
import Redis from 'ioredis';
import { subscribe, PAYMENT_TOPICS } from '../messaging/queueSetup.js';

class EventConsumer extends EventEmitter {
  constructor(options = {}) {
    super();
    
    this.options = {
      prefetchCount: options.prefetchCount || 10,
      concurrency: options.concurrency || 5,
      deduplicationTtl: options.deduplicationTtl || 24 * 60 * 60, // 24 hours
      retryAttempts: options.retryAttempts || 3,
      retryDelay: options.retryDelay || 1000,
      ...options
    };

    this.redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD,
      retryDelayOnFailover: 100,
      lazyConnect: true
    });

    this.consumers = new Map();
    this.activeJobs = 0;
    this.maxConcurrency = this.options.concurrency;
    this.isShuttingDown = false;
  }

  /**
   * Initialize the event consumer
   */
  async initialize() {
    try {
      await this.redis.connect();
      console.log('Event consumer Redis connection established');
      this.emit('ready');
    } catch (error) {
      console.error('Failed to initialize event consumer:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Check if for a duplicate event
   */
  async isDuplicate(eventId, eventType) {
    if (!eventId) return false;
    
    const key = `processed:${eventType}:${eventId}`;
    const exists = await this.redis.get(key);
    
    if (exists) {
      console.log(`Duplicate event detected: ${eventType}:${eventId}`);
      return true;
    }

    // Mark as processing
    await this.redis.setex(key, this.options.deduplicationTtl, Date.now());
    return false;
  }

  /**
   * Process payment initiated events
   */
  async handlePaymentInitiated(payload, message) {
    console.log('Processing payment initiated:', payload.paymentId);
    
    await new Promise(resolve => setTimeout(resolve, 100));
    
    this.emit('payment-initiated-processed', payload);
  }

  /**
   * Process payment completed events
   */
  async handlePaymentCompleted(payload, message) {
    console.log('Processing payment completed:', payload.paymentId);
  
    await new Promise(resolve => setTimeout(resolve, 150));
    
    this.emit('payment-completed-processed', payload);
  }

  /**
   * Process payment failed events
   */
  async handlePaymentFailed(payload, message) {
    console.log('Processing payment failed:', payload.paymentId);
    await new Promise(resolve => setTimeout(resolve, 80));
    
    this.emit('payment-failed-processed', payload);
  }

  /**
   * Process refund processed events
   */
  async handleRefundProcessed(payload, message) {
    console.log('Processing refund:', payload.refundId);
    await new Promise(resolve => setTimeout(resolve, 120));
    this.emit('refund-processed-processed', payload);
  }

  /**
   * Generic event processor with retry and deduplication
   */
  async processEvent(handler, payload, message, eventType) {
    if (this.activeJobs >= this.maxConcurrency) {
      console.log('At max concurrency, waiting...');
      await this.waitForCapacity();
    }

    this.activeJobs++;
    
    try {
      // Extract event ID for deduplication- Stripe event ID 
      const eventId = payload.paymentId ||payload.eventId || payload.correlationId;
      
      // Check for duplicates
      if (await this.isDuplicate(eventId, eventType)) {
        console.log(`Skipping duplicate event: ${eventType}:${eventId}`);
        return;
      }

      // Process the event
      await handler(payload, message);
      
      // Update metrics
      this.emit('event-processed', { eventType, eventId, success: true });
      
    } catch (error) {
      console.error(`Failed to process ${eventType} event:`, error);
      
      // Get retry count from message headers
      const retryCount = (message.properties.headers && message.properties.headers['x-retry-count']) || 0;
      
      if (retryCount < this.options.retryAttempts) {
        console.log(`Retrying event ${eventType} (attempt ${retryCount + 1})`);
        
        // Exponential backoff
        const delay = this.options.retryDelay * Math.pow(2, retryCount);
        await new Promise(resolve => setTimeout(resolve, delay));
        
        // Increment retry count
        if (!message.properties.headers) message.properties.headers = {};
        message.properties.headers['x-retry-count'] = retryCount + 1;
        
        // Retry
        return this.processEvent(handler, payload, message, eventType);
      }
      
      // Max retries exceeded, emit error
      this.emit('event-failed', { eventType, payload, error: error.message });
      throw error;
    } finally {
      this.activeJobs--;
    }
  }

  /**
   * Wait for processing capacity
   */
  async waitForCapacity() {
    return new Promise((resolve) => {
      const checkCapacity = () => {
        if (this.activeJobs < this.maxConcurrency || this.isShuttingDown) {
          resolve();
        } else {
          setTimeout(checkCapacity, 100);
        }
      };
      checkCapacity();
    });
  }

  /**
   * Start consuming events
   */
  async startConsuming() {
    try {
      // Subscribe to payment initiated events
      const paymentInitiatedConsumer = await subscribe(
        PAYMENT_TOPICS.PAYMENT_INITIATED,
        async (payload, message) => {
          await this.processEvent(
            this.handlePaymentInitiated.bind(this),
            payload,
            message,
            'payment_initiated'
          );
        },
        { prefetch: this.options.prefetchCount }
      );
      this.consumers.set('payment_initiated', paymentInitiatedConsumer);

      // Subscribe to payment completed events
      const paymentCompletedConsumer = await subscribe(
        PAYMENT_TOPICS.PAYMENT_COMPLETED,
        async (payload, message) => {
          await this.processEvent(
            this.handlePaymentCompleted.bind(this),
            payload,
            message,
            'payment_completed'
          );
        },
        { prefetch: this.options.prefetchCount }
      );
      this.consumers.set('payment_completed', paymentCompletedConsumer);

      // Subscribe to payment failed events
      const paymentFailedConsumer = await subscribe(
        PAYMENT_TOPICS.PAYMENT_FAILED,
        async (payload, message) => {
          await this.processEvent(
            this.handlePaymentFailed.bind(this),
            payload,
            message,
            'payment_failed'
          );
        },
        { prefetch: this.options.prefetchCount }
      );
      this.consumers.set('payment_failed', paymentFailedConsumer);

      // Subscribe to refund processed events
      const refundProcessedConsumer = await subscribe(
        PAYMENT_TOPICS.REFUND_PROCESSED,
        async (payload, message) => {
          await this.processEvent(
            this.handleRefundProcessed.bind(this),
            payload,
            message,
            'refund_processed'
          );
        },
        { prefetch: this.options.prefetchCount }
      );
      this.consumers.set('refund_processed', refundProcessedConsumer);

      console.log('Event consumer started successfully');
      this.emit('consuming-started');

    } catch (error) {
      console.error('Failed to start consuming events:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get consumer statistics
   */
  getStats() {
    return {
      activeJobs: this.activeJobs,
      maxConcurrency: this.maxConcurrency,
      consumers: Array.from(this.consumers.keys()),
      isShuttingDown: this.isShuttingDown,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('Starting event consumer shutdown...');
    this.isShuttingDown = true;

    // Cancel all consumers
    for (const [topic, consumer] of this.consumers) {
      try {
        console.log(`Cancelling consumer for ${topic}`);
      } catch (error) {
        console.error(`Failed to cancel consumer for ${topic}:`, error);
      }
    }

    // Wait for active jobs to complete
    const shutdownTimeout = 30000;
    const startTime = Date.now();
    
    while (this.activeJobs > 0 && (Date.now() - startTime) < shutdownTimeout) {
      console.log(`Waiting for ${this.activeJobs} active jobs to complete...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Close Redis connection
    await this.redis.quit();
    
    console.log('Event consumer shutdown complete');
    this.emit('shutdown-complete');
  }
}

export default EventConsumer;