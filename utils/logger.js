/**
 * Comprehensive Logging and Tracing System
 * Provides structured logging with correlation IDs and performance tracking
 */

import { createWriteStream } from 'fs';
import { join } from 'path';
import { v4 as uuidv4 } from 'uuid';

// Log levels
export const LOG_LEVELS = {
    ERROR: 0,
    WARN: 1,
    INFO: 2,
    DEBUG: 3,
    TRACE: 4
};

// Log categories
export const LOG_CATEGORIES = {
    API: 'api',
    DATABASE: 'database',
    PAYMENT: 'payment',
    WEBHOOK: 'webhook',
    QUEUE: 'queue',
    CACHE: 'cache',
    SECURITY: 'security',
    PERFORMANCE: 'performance',
    SYSTEM: 'system'
};

class Logger {
    constructor() {
        this.level = process.env.LOG_LEVEL || 'info';
        this.levelValue = LOG_LEVELS[this.level.toUpperCase()] || LOG_LEVELS.INFO;
        this.enableFileLogging = process.env.ENABLE_FILE_LOGGING === 'true';
        this.enableConsoleLogging = process.env.ENABLE_CONSOLE_LOGGING !== 'false';
        
        // Create log streams
        this.streams = new Map();
        if (this.enableFileLogging) {
            this.setupFileStreams();
        }
        
        // Performance tracking
        this.performanceMetrics = new Map();
        this.requestCounts = new Map();
    }

    setupFileStreams() {
        const logDir = process.env.LOG_DIR || './logs';
        
        // Create different log files for different categories
        Object.values(LOG_CATEGORIES).forEach(category => {
            const stream = createWriteStream(join(logDir, `${category}.log`), { flags: 'a' });
            this.streams.set(category, stream);
        });
        
        // General log file
        const generalStream = createWriteStream(join(logDir, 'application.log'), { flags: 'a' });
        this.streams.set('general', generalStream);
    }

    shouldLog(level) {
        return LOG_LEVELS[level] <= this.levelValue;
    }

    formatLogEntry(level, category, message, data = {}, correlationId = null) {
        const timestamp = new Date().toISOString();
        const entry = {
            timestamp,
            level: level.toUpperCase(),
            category,
            message,
            correlationId: correlationId || this.getCurrentCorrelationId(),
            pid: process.pid,
            ...data
        };
        
        return JSON.stringify(entry);
    }

    getCurrentCorrelationId() {
        // In a real application, this would come from request context
        return process.env.CORRELATION_ID || 'system';
    }

    writeLog(level, category, message, data = {}, correlationId = null) {
        if (!this.shouldLog(level)) {
            return;
        }
        
        const logEntry = this.formatLogEntry(level, category, message, data, correlationId);
        
        // Console logging
        if (this.enableConsoleLogging) {
            const consoleMessage = this.formatConsoleMessage(level, category, message, data);
            console.log(consoleMessage);
        }
        
        // File logging
        if (this.enableFileLogging) {
            const stream = this.streams.get(category) || this.streams.get('general');
            if (stream) {
                stream.write(logEntry + '\n');
            }
        }
    }

    formatConsoleMessage(level, category, message, data) {
        const timestamp = new Date().toISOString();
        const levelColor = this.getLevelColor(level);
        const categoryColor = this.getCategoryColor(category);
        
        let formattedMessage = `${timestamp} [${levelColor}${level.toUpperCase()}\x1b[0m] [${categoryColor}${category}\x1b[0m] ${message}`;
        
        if (Object.keys(data).length > 0) {
            formattedMessage += ` ${JSON.stringify(data)}`;
        }
        
        return formattedMessage;
    }

    getLevelColor(level) {
        const colors = {
            ERROR: '\x1b[31m', // Red
            WARN: '\x1b[33m',  // Yellow
            INFO: '\x1b[36m',  // Cyan
            DEBUG: '\x1b[35m', // Magenta
            TRACE: '\x1b[37m'  // White
        };
        return colors[level.toUpperCase()] || '';
    }

    getCategoryColor(category) {
        const colors = {
            api: '\x1b[32m',      // Green
            database: '\x1b[34m', // Blue
            payment: '\x1b[36m', // Cyan
            webhook: '\x1b[33m', // Yellow
            queue: '\x1b[35m',   // Magenta
            cache: '\x1b[37m',   // White
            security: '\x1b[31m', // Red
            performance: '\x1b[93m', // Bright Yellow
            system: '\x1b[90m'   // Gray
        };
        return colors[category] || '';
    }

    // Public logging methods
    error(category, message, data = {}, correlationId = null) {
        this.writeLog('error', category, message, data, correlationId);
    }

    warn(category, message, data = {}, correlationId = null) {
        this.writeLog('warn', category, message, data, correlationId);
    }

    info(category, message, data = {}, correlationId = null) {
        this.writeLog('info', category, message, data, correlationId);
    }

    debug(category, message, data = {}, correlationId = null) {
        this.writeLog('debug', category, message, data, correlationId);
    }

    trace(category, message, data = {}, correlationId = null) {
        this.writeLog('trace', category, message, data, correlationId);
    }

    // Performance tracking
    startTimer(operation, correlationId = null) {
        const timerId = `${operation}_${correlationId || 'system'}_${Date.now()}`;
        this.performanceMetrics.set(timerId, {
            operation,
            correlationId,
            startTime: process.hrtime.bigint(),
            startTimestamp: Date.now()
        });
        return timerId;
    }

    endTimer(timerId, additionalData = {}) {
        const metric = this.performanceMetrics.get(timerId);
        if (!metric) {
            this.warn(LOG_CATEGORIES.PERFORMANCE, 'Timer not found', { timerId });
            return;
        }
        
        const endTime = process.hrtime.bigint();
        const duration = Number(endTime - metric.startTime) / 1000000000; // Convert to seconds
        
        this.info(LOG_CATEGORIES.PERFORMANCE, 'Operation completed', {
            operation: metric.operation,
            duration: `${duration.toFixed(3)}s`,
            correlationId: metric.correlationId,
            ...additionalData
        });
        
        this.performanceMetrics.delete(timerId);
        return duration;
    }

    // Request tracking
    trackRequest(method, path, statusCode, duration, correlationId = null) {
        const key = `${method}:${path}`;
        const count = this.requestCounts.get(key) || 0;
        this.requestCounts.set(key, count + 1);
        
        this.info(LOG_CATEGORIES.API, 'Request completed', {
            method,
            path,
            statusCode,
            duration: `${duration.toFixed(3)}s`,
            correlationId,
            requestCount: count + 1
        });
    }

    // Error tracking with stack traces
    trackError(error, context = {}, correlationId = null) {
        this.error(LOG_CATEGORIES.SYSTEM, 'Error occurred', {
            message: error.message,
            stack: error.stack,
            name: error.name,
            context,
            correlationId
        });
    }

    // Database operation tracking
    trackDatabaseOperation(operation, table, duration, success, correlationId = null) {
        const level = success ? 'info' : 'error';
        this.writeLog(level, LOG_CATEGORIES.DATABASE, 'Database operation', {
            operation,
            table,
            duration: `${duration.toFixed(3)}s`,
            success,
            correlationId
        });
    }

    // Payment operation tracking
    trackPaymentOperation(operation, paymentId, status, duration, correlationId = null) {
        this.info(LOG_CATEGORIES.PAYMENT, 'Payment operation', {
            operation,
            paymentId,
            status,
            duration: `${duration.toFixed(3)}s`,
            correlationId
        });
    }

    // Webhook tracking
    trackWebhook(source, event, status, duration, correlationId = null) {
        this.info(LOG_CATEGORIES.WEBHOOK, 'Webhook processed', {
            source,
            event,
            status,
            duration: `${duration.toFixed(3)}s`,
            correlationId
        });
    }

    // Queue operation tracking
    trackQueueOperation(operation, queue, messageCount, duration, correlationId = null) {
        this.info(LOG_CATEGORIES.QUEUE, 'Queue operation', {
            operation,
            queue,
            messageCount,
            duration: `${duration.toFixed(3)}s`,
            correlationId
        });
    }

    // Cache operation tracking
    trackCacheOperation(operation, key, hit, duration, correlationId = null) {
        this.debug(LOG_CATEGORIES.CACHE, 'Cache operation', {
            operation,
            key,
            hit,
            duration: `${duration.toFixed(3)}s`,
            correlationId
        });
    }

    // Security event tracking
    trackSecurityEvent(event, details, severity = 'medium', correlationId = null) {
        const level = severity === 'high' ? 'error' : severity === 'medium' ? 'warn' : 'info';
        this.writeLog(level, LOG_CATEGORIES.SECURITY, 'Security event', {
            event,
            details,
            severity,
            correlationId
        });
    }

    // Get performance statistics
    getPerformanceStats() {
        const stats = {
            activeTimers: this.performanceMetrics.size,
            requestCounts: Object.fromEntries(this.requestCounts),
            timestamp: new Date().toISOString()
        };
        
        return stats;
    }

    // Cleanup old performance metrics
    cleanupMetrics() {
        const now = Date.now();
        const maxAge = 300000; // 5 minutes
        
        for (const [timerId, metric] of this.performanceMetrics.entries()) {
            if (now - metric.startTimestamp > maxAge) {
                this.performanceMetrics.delete(timerId);
            }
        }
    }

    // Close all streams
    async close() {
        for (const stream of this.streams.values()) {
            stream.end();
        }
        this.streams.clear();
    }
}

// Global logger instance
export const logger = new Logger();

// Middleware for request logging
export const requestLoggingMiddleware = (req, res, next) => {
    const correlationId = req.headers['x-correlation-id'] || uuidv4();
    req.correlationId = correlationId;
    
    const startTime = Date.now();
    
    // Log request start
    logger.info(LOG_CATEGORIES.API, 'Request started', {
        method: req.method,
        path: req.path,
        userAgent: req.headers['user-agent'],
        ip: req.ip,
        correlationId
    });
    
    // Override res.end to log response
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
        const duration = Date.now() - startTime;
        logger.trackRequest(req.method, req.path, res.statusCode, duration, correlationId);
        originalEnd.call(this, chunk, encoding);
    };
    
    next();
};

// Utility functions for common logging patterns
export const logError = (error, context = {}, correlationId = null) => {
    logger.trackError(error, context, correlationId);
};

export const logPerformance = (operation, duration, data = {}, correlationId = null) => {
    logger.info(LOG_CATEGORIES.PERFORMANCE, 'Performance metric', {
        operation,
        duration: `${duration.toFixed(3)}s`,
        ...data,
        correlationId
    });
};

export const logSecurity = (event, details, severity = 'medium', correlationId = null) => {
    logger.trackSecurityEvent(event, details, severity, correlationId);
};

// Cleanup interval
setInterval(() => {
    logger.cleanupMetrics();
}, 60000); // Every minute

export default logger;
