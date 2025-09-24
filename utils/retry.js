import pRetry from 'p-retry';

/**
 * Enhanced retry function with exponential backoff and jitter
 */
export async function retry(fn, options = {}) {
    const defaultOptions = {
        retries: 5,
        factor: 2,
        minTimeout: 1000,
        maxTimeout: 30000,
        randomize: true,
        onFailedAttempt: (error) => {
            console.warn(`Attempt ${error.attemptNumber} failed. ${error.retriesLeft} retries left.`);
        }
    };

    const mergedOptions = { ...defaultOptions, ...options };

    return await pRetry(fn, mergedOptions);
}

/**
 * Retry with specific backoff strategy
 */
export function createRetryableOperation(operation, options = {}) {
    return async (...args) => {
        return await retry(() => operation(...args), options);
    };
}

/**
 * Circuit breaker wrapper with retry
 */
export function createResilientOperation(operation, circuitBreakerOptions = {}, retryOptions = {}) {
    const retryableOp = createRetryableOperation(operation, retryOptions);
    
    // Would integrate with circuit breaker here
    return retryableOp;
}