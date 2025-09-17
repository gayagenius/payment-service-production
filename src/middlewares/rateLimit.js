import rateLimit from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';
import { ipKeyGenerator } from 'express-rate-limit';

// Redis connection for rate limiting
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD,
  db: 0,
  retryDelayOnFailover: 100,
  enableReadyCheck: false,
  lazyConnect: true
});

redis.on('error', (err) => {
  console.error('Redis rate limiting error:', err);
});

redis.on('connect', () => {
  console.log('Redis connected for rate limiting');
});

/**
 * Rate limiting configuration for different endpoints
 */
const rateLimitConfig = {
  // Payment endpoints - stricter limits
  payments: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, 
    message: {
      error: 'Too many payment requests',
      message: 'Maximum 10 payment attempts allowed per 15 minutes',
      retryAfter: 900 // 15 minutes in seconds
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Use user ID if authenticated, otherwise IP
      return req.user?.id || req.ip;
    }
  },

  // Refund endpoints
  refunds: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5, 
    message: {
      error: 'Too many refund requests',
      message: 'Maximum 5 refund requests allowed per hour',
      retryAfter: 3600
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      return req.user?.id || req.ip;
    }
  },

  // General API endpoints
  general: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, 
    message: {
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: 900
    },
    standardHeaders: true,
    legacyHeaders: false
  },

  // Health checks
  health: {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60,
    message: {
      error: 'Health check rate limit exceeded',
      message: 'Too many health check requests',
      retryAfter: 60
    }
  }
};

/**
 * rate limiter with Redis store
 */
const createRateLimiter = (config) => {
  return rateLimit({
    store: new RedisStore({
      sendCommand: (...args) => redis.call(...args),
    }),
    windowMs: config.windowMs,
    max: config.max,
    message: config.message,
    standardHeaders: config.standardHeaders,
    legacyHeaders: config.legacyHeaders,
    keyGenerator: config.keyGenerator || ((req) => {
  const ip = ipKeyGenerator(req);
  return ip;
}),

    // Skip successful requests 
    skipSuccessfulRequests: true,
    skipFailedRequests: false,

    // Custom handler for rate limit exceeded
   handler: (req, res) => {
  console.warn(`Rate limit reached for ${req.ip} on ${req.path}`, {
    ip: req.ip,
    path: req.path,
    userId: req.user?.id,
    userAgent: req.get('User-Agent')
  });

  const retryAfter = Math.round(config.windowMs / 1000);

  res.set({
    'X-RateLimit-Limit': config.max,
    'X-RateLimit-Remaining': 0,
    'X-RateLimit-Reset': Date.now() + config.windowMs,
    'Retry-After': retryAfter
  });

  res.status(429).json({
    success: false,
    error: {
      code: 'RATE_LIMIT_EXCEEDED',
      message: config.message.message,
      retryAfter,
      limit: config.max,
      windowMs: config.windowMs
    },
    timestamp: new Date().toISOString()
  });
}
  });

};

/**
 * Payment-specific rate limiter with user-based limiting
 */
export const paymentRateLimit = createRateLimiter(rateLimitConfig.payments);
export const refundRateLimit = createRateLimiter(rateLimitConfig.refunds);
export const generalRateLimit = createRateLimiter(rateLimitConfig.general);
export const healthRateLimit = createRateLimiter(rateLimitConfig.health);

/**
 * Sliding window rate limiter for high-throughput endpoints
 * Uses Redis sorted sets for more accurate rate limiting
 */
export const slidingWindowRateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100,
    keyPrefix = 'sliding_rl:',
    message = 'Rate limit exceeded'
  } = options;

  return async (req, res, next) => {
    const key = `${keyPrefix}${req.user?.id || req.ip}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    try {
      //Redis pipeline for atomic operations
      const pipeline = redis.pipeline();
      
      // Remove old entries
      pipeline.zremrangebyscore(key, 0, windowStart);
      
      // Count current requests in window
      pipeline.zcard(key);
      
      // Add current request
      pipeline.zadd(key, now, `${now}-${Math.random()}`);
      
      // Set expiry
      pipeline.expire(key, Math.ceil(windowMs / 1000));
      
      const results = await pipeline.exec();
      const currentCount = results[1][1];

      if (currentCount >= max) {
        // Remove the radded request since we're over the limit
        await redis.zrem(key, `${now}-${Math.random()}`);
        
        const retryAfter = Math.ceil(windowMs / 1000);
        
        res.set({
          'X-RateLimit-Limit': max,
          'X-RateLimit-Remaining': 0,
          'X-RateLimit-Reset': now + windowMs,
          'Retry-After': retryAfter
        });

        return res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: typeof message === 'string' ? message : message.message,
            retryAfter: retryAfter
          }
        });
      }

      // rate limit headers
      res.set({
        'X-RateLimit-Limit': max,
        'X-RateLimit-Remaining': Math.max(0, max - currentCount - 1),
        'X-RateLimit-Reset': now + windowMs
      });

      next();
      
    } catch (error) {
      console.error('Sliding window rate limit error:', error);
      // requests to proceed if redis fails
      next();
    }
  };
};

/**
 * Advanced rate limiter with burst handling
 */
export const burstRateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 100, 
    burstMax = 150, 
    burstWindowMs = 60 * 1000,
    keyPrefix = 'burst_rl:'
  } = options;

  return async (req, res, next) => {
    const key = `${keyPrefix}${req.user?.id || req.ip}`;
    const burstKey = `${key}:burst`;
    const now = Date.now();

    try {
      const pipeline = redis.pipeline();
      
      // Check burst window
      pipeline.get(burstKey);
      pipeline.get(key);
      
      const results = await pipeline.exec();
      const burstCount = parseInt(results[0][1]) || 0;
      const normalCount = parseInt(results[1][1]) || 0;

      // Check burst limit
      if (burstCount >= burstMax) {
        const burstTtl = await redis.ttl(burstKey);
        return res.status(429).json({
          error: 'Burst rate limit exceeded',
          retryAfter: burstTtl > 0 ? burstTtl : Math.ceil(burstWindowMs / 1000)
        });
      }

      // Check normal limit
      if (normalCount >= max) {
        const normalTtl = await redis.ttl(key);
        return res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter: normalTtl > 0 ? normalTtl : Math.ceil(windowMs / 1000)
        });
      }

      // Increment counters
      const incrementPipeline = redis.pipeline();
      incrementPipeline.incr(burstKey);
      incrementPipeline.expire(burstKey, Math.ceil(burstWindowMs / 1000));
      incrementPipeline.incr(key);
      incrementPipeline.expire(key, Math.ceil(windowMs / 1000));
      
      await incrementPipeline.exec();

      res.set({
        'X-RateLimit-Limit': max,
        'X-RateLimit-Remaining': Math.max(0, max - normalCount - 1),
        'X-RateLimit-Burst-Limit': burstMax,
        'X-RateLimit-Burst-Remaining': Math.max(0, burstMax - burstCount - 1)
      });

      next();
    } catch (error) {
      console.error('Burst rate limit error:', error);
      next();
    }
  };
};

/**
 * User-based rate limiter with different tiers
 */
export const tieredRateLimit = (req, res, next) => {
  const userTier = req.user?.tier || 'basic';
  
  const tierLimits = {
    basic: { windowMs: 15 * 60 * 1000, max: 50 },
    premium: { windowMs: 15 * 60 * 1000, max: 200 },
    enterprise: { windowMs: 15 * 60 * 1000, max: 1000 }
  };

  const config = tierLimits[userTier] || tierLimits.basic;
  return createRateLimiter(config)(req, res, next);
};

export { redis as rateLimitRedis };