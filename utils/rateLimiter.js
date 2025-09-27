/**
 * Rate Limiter for External API Calls
 * Prevents hitting rate limits on external services like Paystack
 */

class RateLimiter {
    constructor(options = {}) {
        this.maxRequests = options.maxRequests || 10;
        this.windowMs = options.windowMs || 60000; // 1 minute
        this.requests = [];
        this.blockedUntil = null;
    }

    async checkLimit() {
        const now = Date.now();
        
        // If we're currently blocked, wait
        if (this.blockedUntil && now < this.blockedUntil) {
            const waitTime = this.blockedUntil - now;
            throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(waitTime / 1000)} seconds`);
        }

        // Clean old requests outside the window
        this.requests = this.requests.filter(time => now - time < this.windowMs);

        // Check if we can make another request
        if (this.requests.length >= this.maxRequests) {
            const oldestRequest = Math.min(...this.requests);
            this.blockedUntil = oldestRequest + this.windowMs;
            const waitTime = this.blockedUntil - now;
            throw new Error(`Rate limit exceeded. Try again in ${Math.ceil(waitTime / 1000)} seconds`);
        }

        // Record this request
        this.requests.push(now);
        return true;
    }

    async execute(fn) {
        await this.checkLimit();
        return await fn();
    }

    getStatus() {
        const now = Date.now();
        const recentRequests = this.requests.filter(time => now - time < this.windowMs);
        return {
            requestsInWindow: recentRequests.length,
            maxRequests: this.maxRequests,
            windowMs: this.windowMs,
            blockedUntil: this.blockedUntil,
            isBlocked: this.blockedUntil && now < this.blockedUntil
        };
    }
}

// Global rate limiter for Paystack API calls
export const paystackRateLimiter = new RateLimiter({
    maxRequests: 8, // Conservative limit for Paystack
    windowMs: 60000 // 1 minute window
});

// Utility function for retry with exponential backoff
export const retryWithBackoff = async (fn, maxRetries = 3, baseDelay = 1000) => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            if (attempt === maxRetries - 1) {
                throw error;
            }

            // Check if it's a rate limit error
            if (error.message.includes('rate limit') || error.message.includes('Rate limit')) {
                const delay = baseDelay * Math.pow(2, attempt);
                console.log(`Rate limit hit, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            // For other errors, retry with shorter delay
            const delay = baseDelay * (attempt + 1);
            console.log(`Request failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

export default RateLimiter;
