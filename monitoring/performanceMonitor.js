/**
 * Performance Monitoring System
 * Tracks system performance metrics and provides real-time monitoring
 */

import { register, collectDefaultMetrics, Counter, Histogram, Gauge } from 'prom-client';

// Initialize default metrics collection
collectDefaultMetrics({ register });

// Custom metrics for payment service
const paymentMetrics = {
    // Payment creation metrics
    paymentsCreated: new Counter({
        name: 'payments_created_total',
        help: 'Total number of payments created',
        labelNames: ['status', 'currency']
    }),
    
    paymentsCreatedDuration: new Histogram({
        name: 'payments_created_duration_seconds',
        help: 'Duration of payment creation requests',
        buckets: [0.1, 0.5, 1, 2, 5, 10]
    }),
    
    // Payment status sync metrics
    statusSyncAttempts: new Counter({
        name: 'status_sync_attempts_total',
        help: 'Total number of status sync attempts',
        labelNames: ['status']
    }),
    
    statusSyncDuration: new Histogram({
        name: 'status_sync_duration_seconds',
        help: 'Duration of status sync operations',
        buckets: [0.1, 0.5, 1, 2, 5, 10]
    }),
    
    // Paystack API metrics
    paystackApiCalls: new Counter({
        name: 'paystack_api_calls_total',
        help: 'Total number of Paystack API calls',
        labelNames: ['endpoint', 'status']
    }),
    
    paystackApiDuration: new Histogram({
        name: 'paystack_api_duration_seconds',
        help: 'Duration of Paystack API calls',
        buckets: [0.1, 0.5, 1, 2, 5, 10]
    }),
    
    // Database metrics
    databaseQueries: new Counter({
        name: 'database_queries_total',
        help: 'Total number of database queries',
        labelNames: ['operation', 'table']
    }),
    
    databaseQueryDuration: new Histogram({
        name: 'database_query_duration_seconds',
        help: 'Duration of database queries',
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5]
    }),
    
    // Queue metrics
    queueSize: new Gauge({
        name: 'payment_sync_queue_size',
        help: 'Current size of payment sync queue'
    }),
    
    queueProcessingTime: new Histogram({
        name: 'queue_processing_duration_seconds',
        help: 'Duration of queue processing',
        buckets: [0.1, 0.5, 1, 2, 5, 10, 30]
    }),
    
    // Error metrics
    errors: new Counter({
        name: 'payment_service_errors_total',
        help: 'Total number of errors',
        labelNames: ['type', 'component']
    }),
    
    // Rate limiting metrics
    rateLimitHits: new Counter({
        name: 'rate_limit_hits_total',
        help: 'Total number of rate limit hits',
        labelNames: ['service']
    })
};

// Performance tracking utilities
class PerformanceTracker {
    constructor() {
        this.startTimes = new Map();
    }
    
    startTimer(key) {
        this.startTimes.set(key, process.hrtime.bigint());
    }
    
    endTimer(key) {
        const startTime = this.startTimes.get(key);
        if (!startTime) {
            console.warn(`Timer ${key} was not started`);
            return null;
        }
        
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - startTime) / 1000000000; // Convert to seconds
        this.startTimes.delete(key);
        return duration;
    }
}

const tracker = new PerformanceTracker();

// Middleware for tracking request performance
export const performanceMiddleware = (req, res, next) => {
    const startTime = Date.now();
    const timerKey = `request_${req.method}_${req.path}_${startTime}`;
    
    tracker.startTimer(timerKey);
    
    res.on('finish', () => {
        const duration = tracker.endTimer(timerKey);
        if (duration !== null) {
            const route = `${req.method} ${req.path}`;
            
            // Track different types of requests
            if (req.path.includes('/payments')) {
                paymentMetrics.paymentsCreatedDuration.observe(duration);
            }
            
            // Track response status
            const status = res.statusCode >= 400 ? 'error' : 'success';
            paymentMetrics.errors.inc({ type: 'http', component: route }, res.statusCode >= 400 ? 1 : 0);
        }
    });
    
    next();
};

// Track payment creation
export const trackPaymentCreation = (status, currency, duration) => {
    paymentMetrics.paymentsCreated.inc({ status, currency });
    paymentMetrics.paymentsCreatedDuration.observe(duration);
};

// Track status sync
export const trackStatusSync = (status, duration) => {
    paymentMetrics.statusSyncAttempts.inc({ status });
    paymentMetrics.statusSyncDuration.observe(duration);
};

// Track Paystack API calls
export const trackPaystackApiCall = async (endpoint, fn) => {
    const startTime = process.hrtime.bigint();
    
    try {
        const result = await fn();
        const duration = Number(process.hrtime.bigint() - startTime) / 1000000000;
        
        paymentMetrics.paystackApiCalls.inc({ endpoint, status: 'success' });
        paymentMetrics.paystackApiDuration.observe(duration);
        
        return result;
    } catch (error) {
        const duration = Number(process.hrtime.bigint() - startTime) / 1000000000;
        
        paymentMetrics.paystackApiCalls.inc({ endpoint, status: 'error' });
        paymentMetrics.paystackApiDuration.observe(duration);
        
        throw error;
    }
};

// Track database queries
export const trackDatabaseQuery = async (operation, table, fn) => {
    const startTime = process.hrtime.bigint();
    
    try {
        const result = await fn();
        const duration = Number(process.hrtime.bigint() - startTime) / 1000000000;
        
        paymentMetrics.databaseQueries.inc({ operation, table });
        paymentMetrics.databaseQueryDuration.observe(duration);
        
        return result;
    } catch (error) {
        const duration = Number(process.hrtime.bigint() - startTime) / 1000000000;
        
        paymentMetrics.databaseQueries.inc({ operation, table });
        paymentMetrics.databaseQueryDuration.observe(duration);
        
        throw error;
    }
};

// Track queue operations
export const trackQueueOperation = (operation, duration) => {
    if (operation === 'size') {
        paymentMetrics.queueSize.set(duration);
    } else {
        paymentMetrics.queueProcessingTime.observe(duration);
    }
};

// Track errors
export const trackError = (type, component) => {
    paymentMetrics.errors.inc({ type, component });
};

// Track rate limit hits
export const trackRateLimitHit = (service) => {
    paymentMetrics.rateLimitHits.inc({ service });
};

// Get current metrics
export const getMetrics = async () => {
    return await register.metrics();
};

// Get performance summary
export const getPerformanceSummary = async () => {
    const metrics = await register.getMetricsAsJSON();
    
    const summary = {
        timestamp: new Date().toISOString(),
        metrics: {}
    };
    
    // Extract key metrics
    metrics.forEach(metric => {
        if (metric.name.includes('payments_created_total')) {
            summary.metrics.paymentsCreated = metric.values.reduce((acc, val) => {
                acc[val.labels.status] = (acc[val.labels.status] || 0) + val.value;
                return acc;
            }, {});
        }
        
        if (metric.name.includes('payments_created_duration_seconds')) {
            summary.metrics.avgPaymentCreationTime = metric.values
                .filter(v => v.labels.le === '+Inf')
                .reduce((acc, val) => acc + val.value, 0) / metric.values.length;
        }
        
        if (metric.name.includes('paystack_api_calls_total')) {
            summary.metrics.paystackApiCalls = metric.values.reduce((acc, val) => {
                const key = `${val.labels.endpoint}_${val.labels.status}`;
                acc[key] = val.value;
                return acc;
            }, {});
        }
        
        if (metric.name.includes('payment_sync_queue_size')) {
            summary.metrics.queueSize = metric.values[0]?.value || 0;
        }
        
        if (metric.name.includes('payment_service_errors_total')) {
            summary.metrics.errors = metric.values.reduce((acc, val) => {
                const key = `${val.labels.type}_${val.labels.component}`;
                acc[key] = val.value;
                return acc;
            }, {});
        }
    });
    
    return summary;
};

// Health check based on metrics
export const getHealthStatus = async () => {
    const summary = await getPerformanceSummary();
    
    const health = {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        checks: {}
    };
    
    // Check queue size
    if (summary.metrics.queueSize > 100) {
        health.checks.queueSize = {
            status: 'warning',
            message: `Queue size is high: ${summary.metrics.queueSize}`
        };
    } else {
        health.checks.queueSize = {
            status: 'healthy',
            message: `Queue size: ${summary.metrics.queueSize}`
        };
    }
    
    // Check error rate
    const totalErrors = Object.values(summary.metrics.errors || {}).reduce((a, b) => a + b, 0);
    if (totalErrors > 10) {
        health.checks.errorRate = {
            status: 'warning',
            message: `High error count: ${totalErrors}`
        };
    } else {
        health.checks.errorRate = {
            status: 'healthy',
            message: `Error count: ${totalErrors}`
        };
    }
    
    // Check Paystack API calls
    const paystackErrors = Object.entries(summary.metrics.paystackApiCalls || {})
        .filter(([key]) => key.includes('error'))
        .reduce((acc, [key, value]) => acc + value, 0);
    
    if (paystackErrors > 5) {
        health.checks.paystackApi = {
            status: 'warning',
            message: `Paystack API errors: ${paystackErrors}`
        };
    } else {
        health.checks.paystackApi = {
            status: 'healthy',
            message: `Paystack API errors: ${paystackErrors}`
        };
    }
    
    // Overall health status
    const hasWarnings = Object.values(health.checks).some(check => check.status === 'warning');
    if (hasWarnings) {
        health.status = 'degraded';
    }
    
    return health;
};

export default {
    paymentMetrics,
    performanceMiddleware,
    trackPaymentCreation,
    trackStatusSync,
    trackPaystackApiCall,
    trackDatabaseQuery,
    trackQueueOperation,
    trackError,
    trackRateLimitHit,
    getMetrics,
    getPerformanceSummary,
    getHealthStatus
};
