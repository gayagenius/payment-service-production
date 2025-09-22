import prometheus from 'prom-client';

// Registry Instance
const register = new prometheus.Registry();

// Rate limiting metrics
const rateLimitHitsTotal = new prometheus.Counter({
  name: 'rate_limit_hits_total',
  help: 'Total number of requests that hit rate limits',
  labelNames: ['endpoint', 'limit_type', 'user_tier'],
  registers: [register]
});

const rateLimitRequestsTotal = new prometheus.Counter({
  name: 'rate_limit_requests_total', 
  help: 'Total number of requests processed by rate limiter',
  labelNames: ['endpoint', 'limit_type', 'status'],
  registers: [register]
});

const rateLimitWindowUtilization = new prometheus.Histogram({
  name: 'rate_limit_window_utilization',
  help: 'Utilization of rate limit windows (0-1)',
  buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
  labelNames: ['endpoint', 'limit_type'],
  registers: [register]
});

const rateLimitCurrentConnections = new prometheus.Gauge({
  name: 'rate_limit_current_connections',
  help: 'Current number of connections being tracked',
  labelNames: ['endpoint', 'limit_type'],
  registers: [register]
});

const rateLimitResponseTime = new prometheus.Histogram({
  name: 'rate_limit_response_time_seconds',
  help: 'Time spent processing rate limit checks',
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0],
  labelNames: ['endpoint', 'limit_type'],
  registers: [register]
});

const rateLimitRedisErrors = new prometheus.Counter({
  name: 'rate_limit_redis_errors_total',
  help: 'Total Redis errors in rate limiting',
  labelNames: ['error_type'],
  registers: [register]
});

/**
 * Middleware to collect rate limiting metrics
 */
export const collectRateLimitMetrics = (endpoint, limitType = 'general') => {
  return (req, res, next) => {
    const startTime = Date.now();
    
    // Track request
    rateLimitRequestsTotal.inc({
      endpoint,
      limit_type: limitType,
      status: 'processing'
    });

    // Override the json result to capture final status
    const originalJson = res.json;
    res.json = function(body) {
      const responseTime = (Date.now() - startTime) / 1000;
      
      if (res.statusCode === 429) {
        // Rate limit 
        rateLimitHitsTotal.inc({
          endpoint,
          limit_type: limitType,
          user_tier: req.user?.tier || 'anonymous'
        });
        
        rateLimitRequestsTotal.inc({
          endpoint,
          limit_type: limitType,
          status: 'rate_limited'
        });
      } else {
        rateLimitRequestsTotal.inc({
          endpoint,
          limit_type: limitType,
          status: 'allowed'
        });
      }

      // Track response time
      rateLimitResponseTime.observe(
        { endpoint, limit_type: limitType },
        responseTime
      );

      return originalJson.call(this, body);
    };

    next();
  };
};

/**
 * Track rate limit utilization
 */
export const trackRateLimitUtilization = (endpoint, limitType, used, max) => {
  const utilization = max > 0 ? used / max : 0;
  rateLimitWindowUtilization.observe(
    { endpoint, limit_type: limitType },
    utilization
  );
};

/**
 * Track current connections
 */
export const updateCurrentConnections = (endpoint, limitType, count) => {
  rateLimitCurrentConnections.set(
    { endpoint, limit_type: limitType },
    count
  );
};

/**
 * Track Redis errors
 */
export const trackRedisError = (errorType) => {
  rateLimitRedisErrors.inc({ error_type: errorType });
};

export {
  register as rateLimitRegister,
  rateLimitHitsTotal,
  rateLimitRequestsTotal,
  rateLimitWindowUtilization,
  rateLimitCurrentConnections,
  rateLimitResponseTime,
  rateLimitRedisErrors
};