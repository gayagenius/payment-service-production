/**
 * Circuit Breaker Pattern Implementation
 * Provides fault tolerance for external service calls
 */

class CircuitBreaker {
    constructor(options = {}) {
        this.failureThreshold = options.failureThreshold || 5;
        this.resetTimeout = options.resetTimeout || 60000; // 1 minute
        this.monitoringPeriod = options.monitoringPeriod || 10000; // 10 seconds
        this.timeout = options.timeout || 5000; // 5 seconds
        
        this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.nextAttempt = null;
        
        this.stats = {
            totalCalls: 0,
            successfulCalls: 0,
            failedCalls: 0,
            circuitOpens: 0,
            circuitCloses: 0
        };
    }

    async execute(fn, context = {}) {
        this.stats.totalCalls++;
        
        // Check if circuit is open
        if (this.state === 'OPEN') {
            if (Date.now() < this.nextAttempt) {
                throw new Error(`Circuit breaker is OPEN. Next attempt at ${new Date(this.nextAttempt).toISOString()}`);
            }
            this.state = 'HALF_OPEN';
        }
        
        try {
            // Execute function with timeout
            const result = await this.executeWithTimeout(fn, context);
            
            // Success - reset failure count
            this.onSuccess();
            return result;
            
        } catch (error) {
            this.onFailure(error);
            throw error;
        }
    }

    async executeWithTimeout(fn, context) {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error(`Circuit breaker timeout after ${this.timeout}ms`));
            }, this.timeout);

            fn(context)
                .then(result => {
                    clearTimeout(timeout);
                    resolve(result);
                })
                .catch(error => {
                    clearTimeout(timeout);
                    reject(error);
                });
        });
    }

    onSuccess() {
        this.failureCount = 0;
        this.stats.successfulCalls++;
        
        if (this.state === 'HALF_OPEN') {
            this.state = 'CLOSED';
            this.stats.circuitCloses++;
            console.log('Circuit breaker: CLOSED (recovered from failure)');
        }
    }

    onFailure(error) {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        this.stats.failedCalls++;
        
        if (this.state === 'HALF_OPEN') {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.resetTimeout;
            this.stats.circuitOpens++;
            console.log('Circuit breaker: OPEN (half-open attempt failed)');
        } else if (this.failureCount >= this.failureThreshold) {
            this.state = 'OPEN';
            this.nextAttempt = Date.now() + this.resetTimeout;
            this.stats.circuitOpens++;
            console.log(`Circuit breaker: OPEN (${this.failureCount} consecutive failures)`);
        }
    }

    getState() {
        return {
            state: this.state,
            failureCount: this.failureCount,
            lastFailureTime: this.lastFailureTime,
            nextAttempt: this.nextAttempt,
            stats: { ...this.stats }
        };
    }

    reset() {
        this.state = 'CLOSED';
        this.failureCount = 0;
        this.lastFailureTime = null;
        this.nextAttempt = null;
        console.log('Circuit breaker: RESET');
    }
}

// Global circuit breakers for different services
export const circuitBreakers = {
    paystack: new CircuitBreaker({
        failureThreshold: 3,
        resetTimeout: 30000, // 30 seconds
        timeout: 10000 // 10 seconds
    }),
    
    database: new CircuitBreaker({
        failureThreshold: 5,
        resetTimeout: 15000, // 15 seconds
        timeout: 5000 // 5 seconds
    }),
    
    rabbitmq: new CircuitBreaker({
        failureThreshold: 3,
        resetTimeout: 20000, // 20 seconds
        timeout: 3000 // 3 seconds
    })
};

// Utility function to wrap service calls with circuit breaker
export const withCircuitBreaker = (serviceName, fn) => {
    const breaker = circuitBreakers[serviceName];
    if (!breaker) {
        throw new Error(`Circuit breaker not found for service: ${serviceName}`);
    }
    
    return async (context) => {
        return await breaker.execute(fn, context);
    };
};

// Health check for circuit breakers
export const getCircuitBreakerHealth = () => {
    const health = {};
    
    Object.entries(circuitBreakers).forEach(([name, breaker]) => {
        const state = breaker.getState();
        health[name] = {
            state: state.state,
            healthy: state.state === 'CLOSED',
            failureCount: state.failureCount,
            stats: state.stats
        };
    });
    
    return health;
};

export default CircuitBreaker;