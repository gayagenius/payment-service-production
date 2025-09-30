/**
 * Authentication Middleware
 * Handles token validation for all protected endpoints
 */

import { verifyToken, extractUserId, extractUserDetails } from '../services/userService.js';

/**
 * Middleware to validate authorization token
 */
export const validateToken = async (req, res, next) => {
    try {
        // Validate authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'MISSING_AUTHORIZATION',
                    message: 'Authorization header is required',
                    details: 'Please provide an Authorization header with Bearer token'
                }
            });
        }

        // Validate authorization header format (Bearer token)
        if (!authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'INVALID_AUTHORIZATION_FORMAT',
                    message: 'Invalid authorization format',
                    details: 'Authorization header must start with "Bearer "'
                }
            });
        }

        // Extract token from header
        const authToken = authHeader.substring(7); // Remove "Bearer " prefix
        if (!authToken || authToken.trim().length === 0) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'INVALID_AUTH_TOKEN',
                    message: 'Invalid authorization token',
                    details: 'Authorization token must be a non-empty string'
                }
            });
        }

        // Verify token with user service
        console.log('Verifying token with user service...');
        let tokenVerification;
        try {
            tokenVerification = await verifyToken(authToken);
        } catch (tokenError) {
            console.error('Token verification error:', tokenError.message);
            return res.status(401).json({
                success: false,
                error: {
                    code: 'TOKEN_VERIFICATION_ERROR',
                    message: 'Token verification failed',
                    details: tokenError.message
                }
            });
        }
        
        if (!tokenVerification.success) {
            console.error('Token verification failed:', tokenVerification.error);
            return res.status(401).json({
                success: false,
                error: {
                    code: 'NOT_AUTHORIZED',
                    message: 'Not Authorized',
                    details: tokenVerification.error
                }
            });
        }

        // Extract user details and attach to request
        const userDetails = extractUserDetails(tokenVerification);
        const user_id = extractUserId(tokenVerification);
        
        if (!user_id) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'INVALID_USER_DATA',
                    message: 'Invalid user data from token verification',
                    details: 'Unable to extract user ID from token'
                }
            });
        }

        // Attach user info to request for use in route handlers
        req.user = {
            id: user_id,
            details: userDetails,
            token: authToken
        };

        next();
    } catch (error) {
        console.error('Authentication middleware error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'AUTH_MIDDLEWARE_ERROR',
                message: 'Authentication middleware error',
                details: error.message
            }
        });
    }
};

/**
 * Middleware to validate HTTP methods
 */
export const validateHttpMethod = (allowedMethods) => {
    return (req, res, next) => {
        if (!allowedMethods.includes(req.method)) {
            return res.status(405).json({
                success: false,
                error: {
                    code: 'METHOD_NOT_ALLOWED',
                    message: 'HTTP method not allowed',
                    details: `Method ${req.method} not allowed. Allowed methods: ${allowedMethods.join(', ')}`
                }
            });
        }
        next();
    };
};

/**
 * Middleware to validate idempotency key from header
 * For retry requests, provides more specific error messaging
 */
export const validateIdempotencyKey = (req, res, next) => {
    // Get idempotency key from header (standard practice)
    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];

    if (!idempotencyKey) {
        // Check if this is a retry request for better error messaging
        const isRetryRequest = req.body && req.body.retry === true;
        
        if (isRetryRequest) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'RETRY_VALIDATION_ERROR',
                    message: 'Idempotency key required for retry',
                    details: 'When retry=true, an idempotency key must be provided in the header (Idempotency-Key or X-Idempotency-Key) to prevent duplicate payments'
                }
            });
        } else {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'MISSING_IDEMPOTENCY_KEY',
                    message: 'Idempotency key is required',
                    details: 'Please provide an idempotency key in the header (Idempotency-Key or X-Idempotency-Key)'
                }
            });
        }
    }

    // Attach idempotency key to request
    req.idempotencyKey = idempotencyKey;
    next();
};
