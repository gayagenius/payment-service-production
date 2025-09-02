# Rate Limiting and Authentication

This document outlines the authentication, authorization, and rate limiting strategies for the Payment Service API.

## Authentication

### JWT Bearer Token Authentication

The Payment Service uses JWT (JSON Web Token) Bearer token authentication for all API endpoints.

#### Token Format
```
Authorization: Bearer <jwt_token>
```

#### JWT Structure
```json
{
  "sub": "user_id",
  "iss": "auth-service",
  "aud": "payment-service",
  "exp": 1640995200,
  "iat": 1640908800,
  "scopes": ["payments:read", "payments:write", "refunds:write"],
  "user_id": "550e8400-e29b-41d4-a716-446655440000",
  "email": "user@example.com"
}
```

#### Required Scopes

| Scope | Description | Endpoints |
|-------|-------------|-----------|
| `payments:read` | Read payment information | `GET /payments/{id}`, `GET /payments/user/{userId}` |
| `payments:write` | Create and update payments | `POST /payments` |
| `refunds:write` | Create refunds | `POST /payments/{id}/refund` |
| `methods:read` | Read payment methods | `GET /methods/{userId}` |
| `methods:write` | Manage payment methods | `POST /methods` |

#### Token Validation Process

1. **Extract Token**: Parse Bearer token from Authorization header
2. **Verify Signature**: Validate JWT signature using public key
3. **Check Expiration**: Ensure token is not expired
4. **Validate Audience**: Confirm token is intended for payment service
5. **Check Scopes**: Verify required scopes are present
6. **Extract User ID**: Get user_id from token claims

#### Example Implementation
```javascript
// Middleware for JWT validation
const jwt = require('jsonwebtoken');

function validateJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Missing or invalid authorization header'
    });
  }
  
  const token = authHeader.substring(7);
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_PUBLIC_KEY, {
      audience: 'payment-service',
      issuer: 'auth-service'
    });
    
    req.user = {
      id: decoded.user_id,
      scopes: decoded.scopes
    };
    
    next();
  } catch (error) {
    return res.status(401).json({
      code: 'UNAUTHORIZED',
      message: 'Invalid or expired token'
    });
  }
}

// Scope validation middleware
function requireScope(requiredScope) {
  return (req, res, next) => {
    if (!req.user.scopes.includes(requiredScope)) {
      return res.status(403).json({
        code: 'FORBIDDEN',
        message: `Insufficient permissions. Required scope: ${requiredScope}`
      });
    }
    next();
  };
}
```

## Authorization

### Resource-Based Access Control

The service implements resource-based access control to ensure users can only access their own data.

#### User Isolation
- Users can only access their own payments
- Users can only access their own payment methods
- Users can only create refunds for their own payments

#### Example Authorization Checks
```javascript
// Check if user can access payment
async function canAccessPayment(userId, paymentId) {
  const payment = await db.query(
    'SELECT user_id FROM payments WHERE id = $1',
    [paymentId]
  );
  
  return payment.rows[0]?.user_id === userId;
}

// Check if user can create refund
async function canCreateRefund(userId, paymentId) {
  const payment = await db.query(
    'SELECT user_id, status, amount_in_minor FROM payments WHERE id = $1',
    [paymentId]
  );
  
  if (!payment.rows[0]) return false;
  
  const paymentData = payment.rows[0];
  
  // Check ownership
  if (paymentData.user_id !== userId) return false;
  
  // Check payment status
  if (!['SUCCEEDED', 'PARTIALLY_REFUNDED'].includes(paymentData.status)) {
    return false;
  }
  
  return true;
}
```

## Rate Limiting

### Rate Limiting Strategy

The Payment Service implements a multi-tier rate limiting strategy to prevent abuse and ensure fair usage.

#### Rate Limiting Tiers

1. **Per-User Rate Limiting**
   - 100 requests per minute per user
   - Based on authenticated user ID
   - Applied to all endpoints

2. **Per-IP Rate Limiting**
   - 60 requests per minute per IP address
   - Applied to all endpoints
   - Protects against unauthenticated abuse

3. **Endpoint-Specific Rate Limiting**
   - Payment creation: 10 requests per minute per user
   - Refund creation: 5 requests per minute per user
   - Payment method creation: 20 requests per minute per user

#### Rate Limiting Headers

All rate-limited responses include the following headers:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1640995200
X-RateLimit-Retry-After: 60
```

#### Rate Limiting Implementation

```javascript
const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const Redis = require('ioredis');

const redis = new Redis(process.env.REDIS_URL);

// Per-user rate limiting
const userRateLimit = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 requests per minute
  keyGenerator: (req) => `user:${req.user?.id || 'anonymous'}`,
  message: {
    code: 'RATE_LIMITED',
    message: 'Rate limit exceeded for user',
    details: {
      limit: 100,
      window: '1 minute',
      retryAfter: 60
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Per-IP rate limiting
const ipRateLimit = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 requests per minute
  keyGenerator: (req) => `ip:${req.ip}`,
  message: {
    code: 'RATE_LIMITED',
    message: 'Rate limit exceeded for IP address',
    details: {
      limit: 60,
      window: '1 minute',
      retryAfter: 60
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Payment creation rate limiting
const paymentCreationLimit = rateLimit({
  store: new RedisStore({
    sendCommand: (...args) => redis.call(...args),
  }),
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 payments per minute
  keyGenerator: (req) => `payment:${req.user?.id}`,
  message: {
    code: 'RATE_LIMITED',
    message: 'Payment creation rate limit exceeded',
    details: {
      limit: 10,
      window: '1 minute',
      retryAfter: 60
    }
  },
  standardHeaders: true,
  legacyHeaders: false,
});
```

## Idempotency

### Idempotency Key Implementation

The Payment Service supports idempotency for state-changing operations to ensure safe retries and prevent duplicate operations.

#### Supported Endpoints
- `POST /payments` - Payment creation
- `POST /payments/{id}/refund` - Refund creation

#### Idempotency Key Format
```
Idempotency-Key: <unique_string>
```

#### Idempotency Key Requirements
- **Length**: 1-255 characters
- **Uniqueness**: Must be unique per user per operation type
- **Persistence**: Stored for 24 hours after operation completion
- **Case Sensitivity**: Keys are case-sensitive

#### Implementation Example
```javascript
const crypto = require('crypto');

// Generate idempotency key
function generateIdempotencyKey() {
  return crypto.randomBytes(16).toString('hex');
}

// Check idempotency
async function checkIdempotency(key, userId, operation) {
  const result = await db.query(
    'SELECT id, status FROM idempotency_keys WHERE key = $1 AND user_id = $2 AND operation = $3',
    [key, userId, operation]
  );
  
  return result.rows[0];
}

// Store idempotency key
async function storeIdempotencyKey(key, userId, operation, resourceId, status) {
  await db.query(
    'INSERT INTO idempotency_keys (key, user_id, operation, resource_id, status, expires_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [key, userId, operation, resourceId, status, new Date(Date.now() + 24 * 60 * 60 * 1000)]
  );
}

// Idempotency middleware
function idempotencyMiddleware(operation) {
  return async (req, res, next) => {
    const idempotencyKey = req.headers['idempotency-key'];
    
    if (!idempotencyKey) {
      return res.status(400).json({
        code: 'VALIDATION_ERROR',
        message: 'Idempotency-Key header is required'
      });
    }
    
    const existing = await checkIdempotency(idempotencyKey, req.user.id, operation);
    
    if (existing) {
      return res.status(409).json({
        code: 'CONFLICT',
        message: 'Idempotency key already used',
        details: {
          existingResourceId: existing.id,
          status: existing.status
        }
      });
    }
    
    req.idempotencyKey = idempotencyKey;
    next();
  };
}
```

## Security Considerations

### Token Security
- **HTTPS Only**: All API communication must use HTTPS
- **Token Expiration**: JWT tokens have short expiration times (15 minutes)
- **Refresh Tokens**: Use refresh tokens for long-term authentication
- **Token Rotation**: Implement token rotation for enhanced security

### Rate Limiting Security
- **Distributed Limiting**: Use Redis for distributed rate limiting
- **Burst Protection**: Implement burst protection for sudden traffic spikes
- **Whitelist Support**: Support for whitelisted IPs or users
- **Monitoring**: Monitor rate limiting metrics for abuse detection

### Data Protection
- **PCI Compliance**: Never store raw payment card data
- **Encryption**: Encrypt sensitive data at rest and in transit
- **Audit Logging**: Log all authentication and authorization events
- **Data Retention**: Implement proper data retention policies

## Monitoring and Alerting

### Authentication Metrics
- Failed authentication attempts
- Token validation failures
- Scope authorization failures
- User session duration

### Rate Limiting Metrics
- Rate limit violations per user/IP
- Endpoint-specific rate limiting hits
- Rate limiting effectiveness
- Traffic patterns and spikes

### Security Alerts
- Multiple failed authentication attempts
- Unusual rate limiting patterns
- Suspicious API usage patterns
- Token abuse or compromise indicators

## Best Practices

1. **Always Use HTTPS**: Never transmit tokens over unencrypted connections
2. **Implement Proper Scoping**: Use least-privilege principle for scopes
3. **Monitor Rate Limits**: Set up alerts for rate limiting violations
4. **Regular Token Rotation**: Implement token rotation for long-term sessions
5. **Audit Logging**: Log all authentication and authorization events
6. **Error Handling**: Provide clear error messages without exposing sensitive information
7. **Testing**: Include authentication and rate limiting in integration tests
