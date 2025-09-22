import prometheus from 'prom-client';

// Registry for consumer metrics
const consumerRegister = new prometheus.Registry();

// Event processing metrics
const eventsProcessedTotal = new prometheus.Counter({
  name: 'events_processed_total',
  help: 'Total number of events processed',
  labelNames: ['event_type', 'status', 'consumer'],
  registers: [consumerRegister]
});

const eventProcessingDuration = new prometheus.Histogram({
  name: 'event_processing_duration_seconds',
  help: 'Time spent processing events',
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0],
  labelNames: ['event_type', 'consumer'],
  registers: [consumerRegister]
});

const eventQueueDepth = new prometheus.Gauge({
  name: 'event_queue_depth',
  help: 'Current depth of event queues',
  labelNames: ['queue_name'],
  registers: [consumerRegister]
});

const consumerLag = new prometheus.Gauge({
  name: 'consumer_lag_seconds',
  help: 'Consumer lag in seconds',
  labelNames: ['queue_name', 'consumer'],
  registers: [consumerRegister]
});

const activeConsumers = new prometheus.Gauge({
  name: 'active_consumers',
  help: 'Number of active consumers',
  labelNames: ['queue_name'],
  registers: [consumerRegister]
});

const consumerThroughput = new prometheus.Gauge({
  name: 'consumer_throughput_events_per_second',
  help: 'Consumer throughput in events per second',
  labelNames: ['queue_name', 'consumer'],
  registers: [consumerRegister]
});

const duplicateEvents = new prometheus.Counter({
  name: 'duplicate_events_total',
  help: 'Total number of duplicate events detected',
  labelNames: ['event_type'],
  registers: [consumerRegister]
});

const retryEvents = new prometheus.Counter({
  name: 'retry_events_total',
  help: 'Total number of event retries',
  labelNames: ['event_type', 'retry_count'],
  registers: [consumerRegister]
});

const deadLetterEvents = new prometheus.Counter({
  name: 'dead_letter_events_total',
  help: 'Total number of events sent to dead letter queue',
  labelNames: ['event_type', 'reason'],
  registers: [consumerRegister]
});

const consumerConnectionStatus = new prometheus.Gauge({
  name: 'consumer_connection_status',
  help: 'Consumer connection status (1=connected, 0=disconnected)',
  labelNames: ['consumer_id'],
  registers: [consumerRegister]
});

const backPressureActive = new prometheus.Gauge({
  name: 'consumer_back_pressure_active',
  help: 'Whether back pressure is currently active (1=active, 0=inactive)',
  labelNames: ['consumer_id'],
  registers: [consumerRegister]
});

/**
 * Consumer metrics collector class
 */
export class ConsumerMetricsCollector {
  constructor(consumerId) {
    this.consumerId = consumerId;
    this.throughputWindow = new Map(); 
    this.throughputInterval = null;
  }

  /**
   * Record event processing
   */
  recordEventProcessed(eventType, status, duration) {
    eventsProcessedTotal.inc({
      event_type: eventType,
      status: status,
      consumer: this.consumerId
    });

    if (duration !== undefined) {
      eventProcessingDuration.observe(
        { event_type: eventType, consumer: this.consumerId },
        duration
      );
    }
  }

  /**
   * Record duplicate event
   */
  recordDuplicateEvent(eventType) {
    duplicateEvents.inc({ event_type: eventType });
  }

  /**
   * Record retry event
   */
  recordRetryEvent(eventType, retryCount) {
    retryEvents.inc({
      event_type: eventType,
      retry_count: retryCount.toString()
    });
  }

  /**
   * Record dead letter event
   */
  recordDeadLetterEvent(eventType, reason) {
    deadLetterEvents.inc({
      event_type: eventType,
      reason: reason
    });
  }

  /**
   * Update queue depth
   */
  updateQueueDepth(queueName, depth) {
    eventQueueDepth.set({ queue_name: queueName }, depth);
  }

  /**
   * Update consumer lag
   */
  updateConsumerLag(queueName, lagSeconds) {
    consumerLag.set(
      { queue_name: queueName, consumer: this.consumerId },
      lagSeconds
    );
  }

  /**
   * Update active consumers count
   */
  updateActiveConsumers(queueName, count) {
    activeConsumers.set({ queue_name: queueName }, count);
  }

  /**
   * Update connection status
   */
  updateConnectionStatus(connected) {
    consumerConnectionStatus.set(
      { consumer_id: this.consumerId },
      connected ? 1 : 0
    );
  }

  /**
   * Update back pressure status
   */
  updateBackPressureStatus(active) {
    backPressureActive.set(
      { consumer_id: this.consumerId },
      active ? 1 : 0
    );
  }

  /**
   * Start throughput monitoring
   */
  startThroughputMonitoring(intervalMs = 10000) {
    this.throughputInterval = setInterval(() => {
      this.calculateThroughput();
    }, intervalMs);
  }

  /**
   * Stop throughput monitoring
   */
  stopThroughputMonitoring() {
    if (this.throughputInterval) {
      clearInterval(this.throughputInterval);
      this.throughputInterval = null;
    }
  }

  /**
   * Calculate and update throughput metrics
   */
  calculateThroughput() {
    const now = Date.now();
    const windowSize = 60000; 

    // Clean old entries
    for (const [timestamp] of this.throughputWindow) {
      if (now - timestamp > windowSize) {
        this.throughputWindow.delete(timestamp);
      }
    }

    // Calculate events per second
    const eventsInWindow = this.throughputWindow.size;
    const throughputPerSecond = eventsInWindow / (windowSize / 1000);

    consumerThroughput.set(
      { queue_name: 'payment_events', consumer: this.consumerId },
      throughputPerSecond
    );
  }

  /**
   * Record throughput event - internally
   */
  recordThroughputEvent() {
    this.throughputWindow.set(Date.now(), true);
  }
}

/**
 * Middleware to automatically collect consumer metrics
 */
export const createConsumerMetricsMiddleware = (consumerId) => {
  const collector = new ConsumerMetricsCollector(consumerId);
  
  return {
    collector,
    
    // Wrap event handler to collect metrics
    wrapHandler: (eventType, handler) => {
      return async (payload, message) => {
        const startTime = Date.now();
        collector.recordThroughputEvent();

        try {
          await handler(payload, message);
          
          const duration = (Date.now() - startTime) / 1000;
          collector.recordEventProcessed(eventType, 'success', duration);
          
        } catch (error) {
          const duration = (Date.now() - startTime) / 1000;
          collector.recordEventProcessed(eventType, 'error', duration);
          
          throw error; 
        }
      };
    }
  };
};

/**
 * Get all consumer metrics
 */
export const getConsumerMetrics = async () => {
  return await consumerRegister.metrics();
};

/**
 * Reset all consumer metrics (for testing)
 */
export const resetConsumerMetrics = () => {
  consumerRegister.clear();
};

export {
  consumerRegister,
  eventsProcessedTotal,
  eventProcessingDuration,
  eventQueueDepth,
  consumerLag,
  activeConsumers,
  consumerThroughput,
  duplicateEvents,
  retryEvents,
  deadLetterEvents,
  consumerConnectionStatus,
  backPressureActive
};