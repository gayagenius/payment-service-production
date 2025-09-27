/**
 * Comprehensive Error Handling and Retry Mechanisms
 * Provides resilient error handling for all system components
 */

import { circuitBreakers } from './circuitBreaker.js';
import { trackError } from '../monitoring/performanceMonitor.js';

// Error types and their handling strategies
export const ERROR_TYPES = {
    NETWORK_ERROR: 'NETWORK_ERROR',
    DATABASE_ERROR: 'DATABASE_ERROR',
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    AUTHENTICATION_ERROR: 'AUTHENTICATION_ERROR',
    AUTHORIZATION_ERROR: 'AUTHORIZATION_ERROR',
    RATE_LIMIT_ERROR: 'RATE_LIMIT_ERROR',
    TIMEOUT_ERROR: 'TIMEOUT_ERROR',
    CIRCUIT_BREAKER_ERROR: 'CIRCUIT_BREAKER_ERROR',
    EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    CONFIGURATION_ERROR: 'CONFIGURATION_ERROR'
};

// Retry strategies for different error types
export const RETRY_STRATEGIES = {
    [ERROR_TYPES.NETWORK_ERROR]: {
        maxRetries: 3,
        baseDelay: 1000,
        maxDelay: 10000,
        exponentialBackoff: true,
        jitter: true
    },
    [ERROR_TYPES.DATABASE_ERROR]: {
        maxRetries: 2,
        baseDelay: 500,
        maxDelay: 5000,
        exponentialBackoff: true,
        jitter: true
    },
    [ERROR_TYPES.RATE_LIMIT_ERROR]: {
        maxRetries: 5,
        baseDelay: 2000,
        maxDelay: 30000,
        exponentialBackoff: true,
        jitter: true
    },
    [ERROR_TYPES.TIMEOUT_ERROR]: {
        maxRetries: 2,
        baseDelay: 1000,
        maxDelay: 5000,
        exponentialBackoff: false,
        jitter: false
    },
    [ERROR_TYPES.EXTERNAL_SERVICE_ERROR]: {
        maxRetries: 3,
        baseDelay: 1500,
        maxDelay: 15000,
        exponentialBackoff: true,
        jitter: true
    }
};

// Non-retryable error types
export const NON_RETRYABLE_ERRORS = [
    ERROR_TYPES.VALIDATION_ERROR,
    ERROR_TYPES.AUTHENTICATION_ERROR,
    ERROR_TYPES.AUTHORIZATION_ERROR,
    ERROR_TYPES.CONFIGURATION_ERROR
];

class ErrorHandler {
    constructor() {
        this.errorCounts = new Map();
        this.errorThresholds = new Map();
        this.alertThresholds = {
            [ERROR_TYPES.NETWORK_ERROR]: 10,
            [ERROR_TYPES.DATABASE_ERROR]: 5,
            [ERROR_TYPES.EXTERNAL_SERVICE_ERROR]: 8
        };
    }

    // Classify error type based on error object
    classifyError(error) {
        if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
            return ERROR_TYPES.NETWORK_ERROR;
        }
        
        if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
            return ERROR_TYPES.TIMEOUT_ERROR;
        }
        
        if (error.message.includes('rate limit') || error.message.includes('Rate limit')) {
            return ERROR_TYPES.RATE_LIMIT_ERROR;
        }
        
        if (error.code === '23505' || error.message.includes('duplicate')) {
            return ERROR_TYPES.VALIDATION_ERROR;
        }
        
        if (error.code === '23503' || error.message.includes('foreign key')) {
            return ERROR_TYPES.VALIDATION_ERROR;
        }
        
        if (error.message.includes('authentication') || error.message.includes('unauthorized')) {
            return ERROR_TYPES.AUTHENTICATION_ERROR;
        }
        
        if (error.message.includes('forbidden') || error.message.includes('permission')) {
            return ERROR_TYPES.AUTHORIZATION_ERROR;
        }
        
        if (error.message.includes('circuit breaker') || error.message.includes('Circuit breaker')) {
            return ERROR_TYPES.CIRCUIT_BREAKER_ERROR;
        }
        
        if (error.message.includes('Paystack') || error.message.includes('external')) {
            return ERROR_TYPES.EXTERNAL_SERVICE_ERROR;
        }
        
        if (error.code && error.code.startsWith('22')) {
            return ERROR_TYPES.DATABASE_ERROR;
        }
        
        return ERROR_TYPES.INTERNAL_ERROR;
    }

    // Calculate delay for retry with exponential backoff and jitter
    calculateDelay(attempt, strategy) {
        let delay = strategy.baseDelay;
        
        if (strategy.exponentialBackoff) {
            delay = strategy.baseDelay * Math.pow(2, attempt - 1);
        }
        
        delay = Math.min(delay, strategy.maxDelay);
        
        if (strategy.jitter) {
            // Add random jitter (±25%)
            const jitterRange = delay * 0.25;
            delay += (Math.random() - 0.5) * 2 * jitterRange;
        }
        
        return Math.max(0, delay);
    }

    // Execute function with retry logic
    async executeWithRetry(fn, context = {}, options = {}) {
        const errorType = options.errorType || ERROR_TYPES.INTERNAL_ERROR;
        const strategy = RETRY_STRATEGIES[errorType] || RETRY_STRATEGIES[ERROR_TYPES.INTERNAL_ERROR];
        const maxRetries = options.maxRetries || strategy.maxRetries;
        
        let lastError;
        
        for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
            try {
                const result = await fn(context);
                
                // Reset error count on success
                this.resetErrorCount(errorType);
                
                return result;
                
            } catch (error) {
                lastError = error;
                const classifiedErrorType = this.classifyError(error);
                
                // Track error
                trackError(classifiedErrorType, context.component || 'unknown');
                
                // Check if error is non-retryable
                if (NON_RETRYABLE_ERRORS.includes(classifiedErrorType)) {
                    console.log(`Non-retryable error: ${classifiedErrorType}`);
                    break;
                }
                
                // Check if we've reached max retries
                if (attempt > maxRetries) {
                    console.log(`Max retries (${maxRetries}) exceeded for ${classifiedErrorType}`);
                    break;
                }
                
                // Calculate delay and wait
                const delay = this.calculateDelay(attempt, strategy);
                console.log(`Retrying ${classifiedErrorType} in ${delay}ms (attempt ${attempt}/${maxRetries})`);
                
                await new Promise(resolve => setTimeout(resolve, delay));
                
                // Update error count
                this.incrementErrorCount(classifiedErrorType);
            }
        }
        
        // All retries failed
        throw this.enhanceError(lastError, errorType);
    }

    // Enhance error with additional context
    enhanceError(error, errorType) {
        const enhancedError = new Error(error.message);
        enhancedError.originalError = error;
        enhancedError.type = errorType;
        enhancedError.timestamp = new Date().toISOString();
        enhancedError.retryable = !NON_RETRYABLE_ERRORS.includes(errorType);
        
        // Add stack trace if available
        if (error.stack) {
            enhancedError.stack = error.stack;
        }
        
        return enhancedError;
    }

    // Increment error count for monitoring
    incrementErrorCount(errorType) {
        const count = this.errorCounts.get(errorType) || 0;
        this.errorCounts.set(errorType, count + 1);
        
        // Check if we need to alert
        const threshold = this.alertThresholds[errorType];
        if (threshold && count + 1 >= threshold) {
            this.sendAlert(errorType, count + 1);
        }
    }

    // Reset error count
    resetErrorCount(errorType) {
        this.errorCounts.set(errorType, 0);
    }

    // Send alert for high error rates
    sendAlert(errorType, count) {
        console.error(`ALERT: High error rate for ${errorType}: ${count} errors`);
        // Here you would integrate with your alerting system (PagerDuty, Slack, etc.)
    }

    // Get error statistics
    getErrorStats() {
        return {
            errorCounts: Object.fromEntries(this.errorCounts),
            thresholds: this.alertThresholds,
            timestamp: new Date().toISOString()
        };
    }

    // Handle specific error scenarios
    async handleDatabaseError(error, operation, context = {}) {
        const errorType = this.classifyError(error);
        
        if (errorType === ERROR_TYPES.DATABASE_ERROR) {
            // Check if it's a connection error
            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                console.error('Database connection error:', error.message);
                // Could trigger circuit breaker here
                circuitBreakers.database.onFailure(error);
            }
        }
        
        return this.executeWithRetry(operation, context, { errorType });
    }

    async handleExternalServiceError(error, operation, context = {}) {
        const errorType = this.classifyError(error);
        
        if (errorType === ERROR_TYPES.EXTERNAL_SERVICE_ERROR) {
            // Check if it's a Paystack error
            if (error.message.includes('Paystack')) {
                console.error('Paystack service error:', error.message);
                circuitBreakers.paystack.onFailure(error);
            }
        }
        
        return this.executeWithRetry(operation, context, { errorType });
    }

    async handleNetworkError(error, operation, context = {}) {
        const errorType = this.classifyError(error);
        return this.executeWithRetry(operation, context, { errorType });
    }
}

// Global error handler instance
export const errorHandler = new ErrorHandler();

// Utility functions for common error handling patterns
export const withErrorHandling = (fn, errorType = ERROR_TYPES.INTERNAL_ERROR) => {
    return async (context) => {
        return await errorHandler.executeWithRetry(fn, context, { errorType });
    };
};

export const handleDatabaseOperation = async (operation, context = {}) => {
    return await errorHandler.handleDatabaseError(null, operation, context);
};

export const handleExternalServiceOperation = async (operation, context = {}) => {
    return await errorHandler.handleExternalServiceError(null, operation, context);
};

export const handleNetworkOperation = async (operation, context = {}) => {
    return await errorHandler.handleNetworkError(null, operation, context);
};

// Error response formatter for API endpoints
export const formatErrorResponse = (error, requestId = null) => {
    const errorType = errorHandler.classifyError(error);
    const isRetryable = !NON_RETRYABLE_ERRORS.includes(errorType);
    
    const response = {
        success: false,
        error: {
            code: errorType,
            message: error.message,
            timestamp: new Date().toISOString(),
            retryable: isRetryable
        }
    };
    
    if (requestId) {
        response.error.requestId = requestId;
    }
    
    // Add additional context for specific error types
    switch (errorType) {
        case ERROR_TYPES.RATE_LIMIT_ERROR:
            response.error.retryAfter = 60; // seconds
            break;
        case ERROR_TYPES.CIRCUIT_BREAKER_ERROR:
            response.error.service = 'external';
            break;
        case ERROR_TYPES.VALIDATION_ERROR:
            response.error.details = error.details || 'Validation failed';
            break;
    }
    
    return response;
};

export default errorHandler;
