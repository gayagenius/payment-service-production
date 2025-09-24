import CircuitBreaker from 'opossum';

export function createCircuitBreaker(fn, options = {}) {
    const defaultOpts = {
        timeout: 10000,
        errorThresholdPercentage: 50,
        resetTimeout: 30000,
        rollingCountTimeout: 60000,
        rollingCountBuckets: 10,
        name: fn.name || 'unnamed-operation'
    };

    const opts = { ...defaultOpts, ...options };
    const breaker = new CircuitBreaker(fn, opts);

    // Enhanced event logging
    breaker.on('open', () => {
        console.warn(`[CircuitBreaker][${opts.name}] Circuit OPEN - failing fast`);
    });

    breaker.on('halfOpen', () => {
        console.warn(`[CircuitBreaker][${opts.name}] Circuit HALF_OPEN - testing recovery`);
    });

    breaker.on('close', () => {
        console.warn(`[CircuitBreaker][${opts.name}] Circuit CLOSED - operating normally`);
    });

    breaker.on('failure', (error) => {
        console.error(`[CircuitBreaker][${opts.name}] Operation failed:`, error.message);
    });

    breaker.on('success', () => {
        console.log(`[CircuitBreaker][${opts.name}] Operation succeeded`);
    });

    breaker.on('timeout', (error) => {
        console.error(`[CircuitBreaker][${opts.name}] Operation timed out:`, error.message);
    });

    return breaker;
}

/**
 * Circuit breaker for Paystack API calls
 */
export function createPaystackCircuitBreaker(apiCall, options = {}) {
    return createCircuitBreaker(apiCall, {
        timeout: 15000,
        errorThresholdPercentage: 40,
        resetTimeout: 60000,
        name: 'paystack-api',
        ...options
    });
}

/**
 * Circuit breaker for database operations
 */
export function createDbCircuitBreaker(dbOperation, options = {}) {
    return createCircuitBreaker(dbOperation, {
        timeout: 10000,
        errorThresholdPercentage: 30,
        resetTimeout: 45000,
        name: 'database-operation',
        ...options
    });
}