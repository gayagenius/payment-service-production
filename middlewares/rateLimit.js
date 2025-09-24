import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import RedisStore from 'rate-limit-redis';
import Redis from 'ioredis';

/**
 * Redis connection for rate limiting (shared)
 * - uses lazyConnect so it won't block process startup
 * - if Redis is unavailable the middleware will fall back to allowing requests
 */
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: Number(process.env.REDIS_DB || 0),
  retryStrategy(times) {
    const delay = Math.min(2000 * times, 30000);
    return delay;
  },
  lazyConnect: true,
  enableReadyCheck: true,
});

redis.on('connect', () => {
  console.log('Redis connected for rate limiting');
});

redis.on('error', (err) => {
  console.error('Redis rate limiting error:', err);
});

// attempt to connect in background 
(async () => {
  try {
    await redis.connect();
  } catch (err) {
    console.warn('Could not connect to Redis for rate limiting at startup:', err.message);
  }
})();

/**
 * Generic config object for different endpoint categories
 */
const rateLimitConfig = {
  payments: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: Number(process.env.RATE_LIMIT_PAYMENTS_MAX) || 10,
    message: {
      error: 'Too many payment requests',
      message: 'Maximum 10 payment attempts allowed per 15 minutes',
      retryAfter: 15 * 60 // 15 seconds
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || ipKeyGenerator(req)
  },

  refunds: {
    windowMs: 60 * 60 * 1000, // 1 hour
    max: Number(process.env.RATE_LIMIT_REFUNDS_MAX) || 5,
    message: {
      error: 'Too many refund requests',
      message: 'Maximum 5 refund requests allowed per hour',
      retryAfter: 3600
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || ipKeyGenerator(req)
  },

  general: {
    windowMs: 15 * 60 * 1000, // 15 min
    max: Number(process.env.RATE_LIMIT_GENERAL_MAX) || 100,
    message: {
      error: 'Too many requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: 15 * 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || ipKeyGenerator(req)
  },

  health: {
    windowMs: 1 * 60 * 1000, // 1 minute
    max: Number(process.env.RATE_LIMIT_HEALTH_MAX) || 60,
    message: {
      error: 'Health check rate limit exceeded',
      message: 'Too many health check requests',
      retryAfter: 60
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: ipKeyGenerator
  }
};

/**
 * express-rate-limit instance with Redis backing.
 */
const createRateLimiter = (config) => {
  const store = redis.status === 'ready'
    ? new RedisStore({
        client: redis,
        prefix: process.env.RATE_LIMIT_REDIS_PREFIX || 'rl:',
      })
    : null;

  const limiter = rateLimit({
    ...(store ? { store } : {}),
    windowMs: config.windowMs,
    max: config.max,
    standardHeaders: config.standardHeaders,
    legacyHeaders: config.legacyHeaders,
    keyGenerator: config.keyGenerator || ((req) => ipKeyGenerator(req)),
    skipSuccessfulRequests: true, 
    skipFailedRequests: false,
    handler: (req, res) => {
      console.warn(`Rate limit reached for key=${(config.keyGenerator ? config.keyGenerator(req) : ipKeyGenerator(req))} path=${req.path}`);
      const retryAfter = Math.ceil(config.windowMs / 1000);
      res.set({
        'X-RateLimit-Limit': config.max,
        'X-RateLimit-Remaining': 0,
        'X-RateLimit-Reset': Date.now() + config.windowMs,
        'Retry-After': retryAfter.toString()
      });

      return res.status(429).json({
        status: 'error',
        code: 'RATE_LIMIT_EXCEEDED',
        message: typeof config.message === 'string' ? config.message : config.message.message,
        retryAfter,
        limit: config.max,
        windowMs: config.windowMs
      });
    }
  });

  if (!store) {
    const originalMiddleware = limiter;
    return (req, res, next) => {
      console.warn('Redis not available for rate limiting - using in-memory limiter (not recommended for multi-instance deployments)');
      return originalMiddleware(req, res, next);
    };
  }

  return limiter;
};

/**
 * Exposed pre-configured limiters
 */
export const paymentRateLimit = createRateLimiter(rateLimitConfig.payments);
export const refundRateLimit = createRateLimiter(rateLimitConfig.refunds);
export const generalRateLimit = createRateLimiter(rateLimitConfig.general);
export const healthRateLimit = createRateLimiter(rateLimitConfig.health);

export const slidingWindowRateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    keyPrefix = 'sliding_rl:',
    message = 'Rate limit exceeded'
  } = options;

  return async (req, res, next) => {
    if (redis.status !== 'ready') {
      return next();
    }

    const key = `${keyPrefix}${req.user?.id || ipKeyGenerator(req)}`;
    const now = Date.now();
    const windowStart = now - windowMs;
    const member = `${now}-${Math.random().toString(36).slice(2)}`;

    try {
      const pipeline = redis.pipeline();
      pipeline.zremrangebyscore(key, 0, windowStart);
      pipeline.zcard(key);
      pipeline.zadd(key, now, member);
      pipeline.expire(key, Math.ceil(windowMs / 1000));
      const results = await pipeline.exec();

      const currentCount = (results && results[1] && results[1][1]) ? results[1][1] : 0;

      if (currentCount > max) {
        await redis.zrem(key, member);
        const retryAfter = Math.ceil(windowMs / 1000);
        res.set({
          'X-RateLimit-Limit': max,
          'X-RateLimit-Remaining': 0,
          'X-RateLimit-Reset': now + windowMs,
          'Retry-After': retryAfter.toString()
        });
        return res.status(429).json({
          status: 'error',
          code: 'RATE_LIMIT_EXCEEDED',
          message: typeof message === 'string' ? message : message.message,
          retryAfter
        });
      }

      res.set({
        'X-RateLimit-Limit': max,
        'X-RateLimit-Remaining': Math.max(0, max - currentCount - 1),
        'X-RateLimit-Reset': now + windowMs
      });

      return next();
    } catch (err) {
      console.error('Sliding window limiter error:', err);
      return next(); 
    }
  };
};


export const burstRateLimit = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000,
    max = 100,
    burstMax = 150,
    burstWindowMs = 60 * 1000,
    keyPrefix = 'burst_rl:'
  } = options;

  return async (req, res, next) => {
    if (redis.status !== 'ready') return next();

    const userKey = `${keyPrefix}${req.user?.id || ipKeyGenerator(req)}`;
    const burstKey = `${userKey}:burst`;
    try {
      const pipeline = redis.pipeline();
      pipeline.get(burstKey);
      pipeline.get(userKey);
      const results = await pipeline.exec();

      const burstCount = parseInt(results[0]?.[1] || '0', 10);
      const normalCount = parseInt(results[1]?.[1] || '0', 10);

      if (burstCount >= burstMax) {
        const ttl = await redis.ttl(burstKey);
        return res.status(429).json({
          status: 'error',
          code: 'BURST_RATE_LIMIT_EXCEEDED',
          message: 'Burst rate limit exceeded',
          retryAfter: ttl > 0 ? ttl : Math.ceil(burstWindowMs / 1000)
        });
      }

      if (normalCount >= max) {
        const ttl = await redis.ttl(userKey);
        return res.status(429).json({
          status: 'error',
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Rate limit exceeded',
          retryAfter: ttl > 0 ? ttl : Math.ceil(windowMs / 1000)
        });
      }

      const incPipeline = redis.pipeline();
      incPipeline.incr(burstKey);
      incPipeline.expire(burstKey, Math.ceil(burstWindowMs / 1000));
      incPipeline.incr(userKey);
      incPipeline.expire(userKey, Math.ceil(windowMs / 1000));
      await incPipeline.exec();

      res.set({
        'X-RateLimit-Limit': max,
        'X-RateLimit-Remaining': Math.max(0, max - normalCount - 1),
        'X-RateLimit-Burst-Limit': burstMax,
        'X-RateLimit-Burst-Remaining': Math.max(0, burstMax - burstCount - 1)
      });

      return next();
    } catch (err) {
      console.error('Burst limiter error:', err);
      return next();
    }
  };
};

export const tieredRateLimit = (opts = {}) => {
  const tierLimits = {
    basic: { windowMs: 15 * 60 * 1000, max: 50 },
    premium: { windowMs: 15 * 60 * 1000, max: 200 },
    enterprise: { windowMs: 15 * 60 * 1000, max: 1000 }
  };

  return (req, res, next) => {
    const userTier = req.user?.tier || 'basic';
    const config = tierLimits[userTier] || tierLimits.basic;
    return createRateLimiter({
      ...config,
      keyGenerator: (req2) => req2.user?.id || ipKeyGenerator(req2)
    })(req, res, next);
  };
};

export const rateLimitRedis = redis;

export default generalRateLimit;
