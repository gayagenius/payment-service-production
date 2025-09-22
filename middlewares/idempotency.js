// src/middleware/idempotency.js
/**
 * Ensure Idempotency-Key header exists for POST /payments
 */
export default function idempotencyMiddleware(req, res, next) {
  const method = req.method.toUpperCase();
  if (method === 'POST') {
    const key = req.header('Idempotency-Key') || req.header('idempotency-key');
    if (!key) {
      return res.status(400).json({
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: 'Missing Idempotency-Key header',
      });
    }
    // Basic format validation (string, short length)
    if (typeof key !== 'string' || key.trim().length === 0 || key.length > 255) {
      return res.status(400).json({
        status: 'error',
        code: 'VALIDATION_ERROR',
        message: 'Invalid Idempotency-Key header',
      });
    }
    // attach to req for convenience
    req.idempotencyKey = key;
  }
  return next();
}
