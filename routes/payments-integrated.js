import express from 'express';
import dbPoolManager from '../db/connectionPool.js';
import { API_CONFIG, PAYMENT_CONFIG, SECURITY_CONFIG } from '../config/constants.js';
import { processPayment, createPaymentMethodForGateway, syncPaymentStatusWithPaystack } from '../services/paymentProcessor.js';
import { publishPaymentEvent } from '../messaging/publishPaymentEvent.js';
import { verifyToken, extractUserId, extractUserDetails } from '../services/userService.js';

const router = express.Router();

/**
 * GET /payments - Get all payments with pagination
 */
router.get('/', async (req, res) => {
    try {
        const {
            limit = API_CONFIG.DEFAULT_PAGINATION_LIMIT,
            offset = API_CONFIG.DEFAULT_PAGINATION_OFFSET,
            status,
            user_id,
            start_date,
            end_date
        } = req.query;

        // Validate parameters
        const limitNum = Math.min(parseInt(limit) || API_CONFIG.DEFAULT_PAGINATION_LIMIT, API_CONFIG.MAX_PAGINATION_LIMIT);
        const offsetNum = Math.max(parseInt(offset) || API_CONFIG.DEFAULT_PAGINATION_OFFSET, 0);

        // Build query
        let query = `
            SELECT p.id, p.user_id, p.order_id, p.amount, p.currency, p.status,
                   p.gateway_response, p.idempotency_key, p.metadata,
                   p.created_at, p.updated_at
            FROM payments p
            WHERE 1=1
        `;
        
        const params = [];
        let paramCount = 0;

        if (status) {
            paramCount++;
            query += ` AND p.status = $${paramCount}`;
            params.push(status);
        }

        if (user_id) {
            paramCount++;
            query += ` AND p.user_id = $${paramCount}`;
            params.push(user_id);
        }

        if (start_date) {
            paramCount++;
            query += ` AND p.created_at >= $${paramCount}`;
            params.push(start_date);
        }

        if (end_date) {
            paramCount++;
            query += ` AND p.created_at <= $${paramCount}`;
            params.push(end_date);
        }

        query += ` ORDER BY p.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(limitNum, offsetNum);

        const result = await dbPoolManager.executeRead(query, params);

        res.json({
            success: true,
            data: result.rows.map(row => ({
                id: row.id,
                userId: row.user_id,
                orderId: row.order_id,
                amount: row.amount,
                currency: row.currency,
                status: row.status,
                gatewayResponse: row.gateway_response,
                idempotencyKey: row.idempotency_key,
                metadata: row.metadata,
                createdAt: row.created_at,
                updatedAt: row.updated_at
            })),
            metadata: {
                status: 200,
                correlation_id: req.headers['x-request-id'] || 'unknown'
            }
        });

    } catch (error) {
        console.error('Get payments error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Internal server error',
                details: error.message
            }
        });
    }
});

/**
 * POST /payments - Create a new payment with real gateway processing
 */
router.post('/', async (req, res) => {
    try {
        const {
            orderId: order_id,
            amount,
            currency = 'KES',
            metadata = {},
            idempotencyKey,
            retry = false
        } = req.body;

        // Validate required fields
        if (!order_id || amount === undefined || amount === null) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Missing required fields',
                    details: 'orderId and amount are required'
                }
            });
        }

        // Validate amount is a number
        if (typeof amount !== 'number') {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Invalid amount type',
                    details: 'Amount must be a number'
                }
            });
        }

        // Validate amount for test mode (1-5)
        if (amount < 5 || amount > 10) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_AMOUNT',
                    message: 'Invalid amount for test mode',
                    details: 'Amount must be between 5 and 10 for test mode'
                }
            });
        }

        // Validate authorization header
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'MISSING_AUTHORIZATION',
                    message: 'Authorization header is required',
                    details: 'Authorization header with Bearer token is required'
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
        const tokenVerification = await verifyToken(authToken);
        
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

        // Extract user details from token verification
        const userDetails = extractUserDetails(tokenVerification);
        const user_id = extractUserId(tokenVerification);
        
        if (!user_id) {
            return res.status(401).json({
                success: false,
                error: {
                    code: 'INVALID_USER_DATA',
                    message: 'Invalid user data from token verification',
                    details: 'User ID not found in token verification response'
                }
            });
        }

        console.log('Token verification successful for user:', user_id);

        // Validate retry logic
        if (retry === true) {
            if (!idempotencyKey) {
                    return res.status(400).json({
                        success: false,
                        error: {
                        code: 'RETRY_VALIDATION_ERROR',
                        message: 'Idempotency key required for retry',
                        details: 'idempotencyKey is required when retry is true'
                    }
                });
            }
            
            // Check if payment with this idempotency key exists
            const existingPaymentQuery = `
                SELECT id, status, user_id, order_id, amount, currency, gateway_response, created_at, updated_at
                FROM payments 
                WHERE idempotency_key = $1
            `;
            const existingPayment = await dbPoolManager.executeRead(existingPaymentQuery, [idempotencyKey]);
            
            if (existingPayment.rows.length > 0) {
                const existing = existingPayment.rows[0];
                
                // Check if payment is in a final state (SUCCEEDED, REFUNDED, CANCELLED)
                if (['SUCCEEDED', 'REFUNDED', 'CANCELLED'].includes(existing.status)) {
                    return res.status(200).json({
                        success: true,
                        message: 'Payment already completed',
                        data: {
                            id: existing.id,
                            userId: existing.user_id,
                            orderId: existing.order_id,
                            amount: existing.amount,
                            currency: existing.currency,
                            status: existing.status,
                            gatewayResponse: existing.gateway_response,
                            idempotencyKey: idempotencyKey,
                            retry: true,
                            createdAt: existing.created_at,
                            updatedAt: existing.updated_at
                        }
                    });
                }
                
                // If payment is in retryable state (PENDING, FAILED), check Paystack status first
                if (['PENDING', 'FAILED'].includes(existing.status)) {
                    console.log(`Retrying payment ${existing.id} with idempotency key: ${idempotencyKey}`);
                    
                    // Check Paystack status first to see if payment actually succeeded
                    try {
                        const { syncPaymentStatusWithPaystack } = await import('../services/paymentProcessor.js');
                        const syncResult = await syncPaymentStatusWithPaystack(idempotencyKey, existing.status);
                        
                        if (syncResult.success && syncResult.synced && syncResult.status !== existing.status) {
                            console.log(`Payment ${existing.id} status updated from ${existing.status} to ${syncResult.status} via Paystack sync`);
                            
                            // Update the existing payment with the new status
                            const updateQuery = `
                                UPDATE payments 
                                SET status = $1, gateway_response = $2, updated_at = NOW()
                                WHERE id = $3
                            `;
                            
                            await dbPoolManager.executeWrite(updateQuery, [
                                syncResult.status,
                                JSON.stringify(syncResult.gatewayResponse),
                                existing.id
                            ]);
                            
                            // If the payment is now successful, return it
                            if (syncResult.status === 'SUCCEEDED') {
                                return res.status(200).json({
                                    success: true,
                                    message: 'Payment completed successfully',
                                    data: {
                                        id: existing.id,
                                        userId: existing.user_id,
                                        orderId: existing.order_id,
                                        amount: existing.amount,
                                        currency: existing.currency,
                                        status: syncResult.status,
                                        gatewayResponse: syncResult.gatewayResponse,
                                        idempotencyKey: idempotencyKey,
                                        retry: true,
                                        createdAt: existing.created_at,
                                        updatedAt: new Date().toISOString()
                                    }
                                });
                            }
                            
                            // If the payment status didn't change but we're retrying, return the existing payment
                            if (syncResult.status === existing.status) {
                                return res.status(200).json({
                                    success: true,
                                    message: 'Payment retry - returning existing payment data',
                                    data: {
                                        id: existing.id,
                                        userId: existing.user_id,
                                        orderId: existing.order_id,
                                        amount: existing.amount,
                                        currency: existing.currency,
                                        status: existing.status,
                                        gatewayResponse: existing.gateway_response,
                                        idempotencyKey: idempotencyKey,
                                        retry: true,
                                        createdAt: existing.created_at,
                                        updatedAt: existing.updated_at
                                    }
                                });
                            }
                        }
                    } catch (syncError) {
                        console.warn('Failed to sync payment status with Paystack:', syncError.message);
                    }
                    
                    // If the existing payment is FAILED or PENDING and we're trying to retry with the same idempotency key,
                    // Paystack will return a duplicate reference error. In this case, return the existing payment.
                    if (existing.status === 'FAILED' || existing.status === 'PENDING') {
                        console.log(`Payment ${existing.id} is ${existing.status}, returning existing payment data for retry`);
                        return res.status(200).json({
                            success: true,
                            message: 'Payment retry - returning existing payment data',
                            data: {
                                id: existing.id,
                                userId: existing.user_id,
                                orderId: existing.order_id,
                                amount: existing.amount,
                                currency: existing.currency,
                                status: existing.status,
                                gatewayResponse: existing.gateway_response,
                                idempotencyKey: idempotencyKey,
                                retry: true,
                                createdAt: existing.created_at,
                                updatedAt: existing.updated_at
                            }
                        });
                    }
                    
                    // Continue with the retry logic below for PENDING payments
                } else {
                    return res.status(409).json({
                        success: false,
                        error: {
                            code: 'PAYMENT_IN_NON_RETRYABLE_STATE',
                            message: 'Payment cannot be retried',
                            details: `Payment with idempotency key is in state: ${existing.status}`,
                            existing_payment_id: existing.id
                        }
                    });
                }
            }
        }


        // Validate metadata structure
        if (metadata && typeof metadata === 'object') {

            // Validate order information in metadata
            if (metadata.order) {
                if (typeof metadata.order !== 'object') {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'INVALID_ORDER_METADATA',
                            message: 'Invalid order metadata',
                            details: 'metadata.order must be an object'
                        }
                    });
                }
                
                // Validate required order fields
                if (!metadata.order.id) {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'MISSING_ORDER_ID',
                            message: 'Order ID is required',
                            details: 'metadata.order.id is required'
                        }
                    });
                }
                
                // Validate order ID matches the main orderId
                if (metadata.order.id !== order_id) {
                    return res.status(400).json({
                        success: false,
                        error: {
                            code: 'ORDER_ID_MISMATCH',
                            message: 'Order ID mismatch',
                            details: 'metadata.order.id must match the main orderId'
                        }
                    });
                }
                
            }
        }

        // Generate idempotency key if not provided
        const finalIdempotencyKey = idempotencyKey || `ref_${user_id}_${order_id}_${Date.now()}`;

        let paymentResult;
        let existingPaymentId = null;

        // Note: Retry logic is handled above in the retry validation section

        // If not retrying or no existing payment found, create new payment
        if (!paymentResult) {
            const query = `
                SELECT * FROM create_payment_with_history(
                    $1, $2, $3, $4, $5, $6, $7, $8
                )
            `;

        const result = await dbPoolManager.executeWrite(query, [
            user_id,
            order_id,
            amount,
            currency,
            JSON.stringify({}), // gateway_response (will be updated after processing)
            finalIdempotencyKey,
            retry,
            JSON.stringify(metadata) // metadata
        ]);

            paymentResult = result.rows[0];
        }

        if (!paymentResult.success) {
            // Handle duplicate idempotency key error specially
            if (paymentResult.error_message === 'Duplicate idempotency key') {
                console.log(`Duplicate idempotency key detected: ${finalIdempotencyKey}, returning existing payment data`);
                
                // Get the existing payment data
                const existingPaymentQuery = `
                    SELECT id, status, gateway_response, created_at, updated_at, user_id, order_id, amount, currency
                    FROM payments 
                    WHERE idempotency_key = $1
                    ORDER BY created_at ASC
                    LIMIT 1
                `;
                
                const existingPayment = await dbPoolManager.executeRead(existingPaymentQuery, [finalIdempotencyKey]);
                
                if (existingPayment.rows.length > 0) {
                    const existing = existingPayment.rows[0];
                    console.log(`Found existing payment ${existing.id} for duplicate idempotency key`);
                    
                    return res.status(200).json({
                        success: true,
                        message: 'Duplicate idempotency key detected - returning existing payment data',
                        data: {
                            id: existing.id,
                            userId: existing.user_id,
                            orderId: existing.order_id,
                            amount: existing.amount,
                            currency: existing.currency,
                            status: existing.status,
                            gatewayResponse: existing.gateway_response,
                            idempotencyKey: finalIdempotencyKey,
                            retry: retry,
                            metadata: metadata,
                            createdAt: existing.created_at,
                            updatedAt: existing.updated_at
                        }
                    });
                }
            }
            
            return res.status(400).json({
                success: false,
                error: {
                    code: 'PAYMENT_CREATION_FAILED',
                    message: 'Failed to create payment',
                    details: paymentResult.error_message
                }
            });
        }

        // Process payment with Paystack
        const paymentData = {
            userId: user_id,
            orderId: order_id,
            amount,
            currency,
            metadata: {
                ...metadata,
                payment_id: paymentResult.payment_id,
                order_id,
                user_id,
                user: userDetails // Include user details from token verification
            },
            idempotencyKey: finalIdempotencyKey
        };

        const gatewayResult = await processPayment(paymentData);

        // Update payment with gateway response
        if (gatewayResult.success) {
            const updateQuery = `
                UPDATE payments 
                SET status = $1, gateway_response = $2, updated_at = NOW()
                WHERE id = $3
            `;
            
            await dbPoolManager.executeWrite(updateQuery, [
                gatewayResult.status,
                JSON.stringify(gatewayResult.gatewayResponse),
                paymentResult.payment_id
            ]);

            // Sync payment status with Paystack for real-time updates
            try {
                console.log(`Syncing payment status with Paystack for reference: ${finalIdempotencyKey}`);
                const syncResult = await syncPaymentStatusWithPaystack(finalIdempotencyKey, gatewayResult.status);
                
                if (syncResult.success && syncResult.synced && syncResult.status !== gatewayResult.status) {
                    console.log(`Payment status updated from ${gatewayResult.status} to ${syncResult.status} via Paystack sync`);
                    
                    // Update database with latest status from Paystack
                    const syncUpdateQuery = `
                        UPDATE payments 
                        SET status = $1, gateway_response = $2, updated_at = NOW()
                        WHERE id = $3
                    `;
                    
                    await dbPoolManager.executeWrite(syncUpdateQuery, [
                        syncResult.status,
                        JSON.stringify(syncResult.gatewayResponse),
                        paymentResult.payment_id
                    ]);
                    
                    gatewayResult.status = syncResult.status;
                    gatewayResult.gatewayResponse = syncResult.gatewayResponse;
                }
            } catch (syncError) {
                console.warn('Failed to sync payment status with Paystack:', syncError.message);
            }

            // Publish payment event
            try {
                await publishPaymentEvent('payment_processed', {
                    payment_id: paymentResult.payment_id,
                    orderId: order_id,
                    userId: user_id,
                    amount: amount,
                    status: gatewayResult.status,
                    gateway: 'paystack',
                    correlationId: finalIdempotencyKey
                });
            } catch (eventError) {
                console.warn('Failed to publish payment event:', eventError.message);
            }
        } else {
            // Handle duplicate reference error by checking existing payment
            if (gatewayResult.error?.code === 'DUPLICATE_REFERENCE' || gatewayResult.error?.shouldReturnExisting) {
                console.log(`Duplicate reference detected for ${finalIdempotencyKey}, checking existing payment...`);
                
                // Check if we have an existing payment with this idempotency key
                const existingPaymentQuery = `
                    SELECT id, status, gateway_response, created_at, updated_at
                    FROM payments 
                    WHERE idempotency_key = $1
                `;
                
                const existingPayment = await dbPoolManager.executeRead(existingPaymentQuery, [finalIdempotencyKey]);
                
                if (existingPayment.rows.length > 0) {
                    const existing = existingPayment.rows[0];
                    console.log(`Found existing payment ${existing.id} with status: ${existing.status}`);
                    
                    // Always return the existing payment data so user can see what happened
                    console.log(`Returning existing payment ${existing.id} for duplicate reference handling`);
                    
                    // Update the current payment to match the existing one
                    const syncQuery = `
                        UPDATE payments 
                        SET status = $1, gateway_response = $2, updated_at = NOW()
                        WHERE id = $3
                    `;
                    
                    await dbPoolManager.executeWrite(syncQuery, [
                        existing.status,
                        existing.gateway_response,
                        paymentResult.payment_id
                    ]);
                    
                    // Override the gateway result to return existing payment data
                    gatewayResult.success = true;
                    gatewayResult.status = existing.status;
                    gatewayResult.gatewayResponse = existing.gateway_response;
                    
                    // Publish event
                    await publishPaymentEvent('payment_processed', {
                        payment_id: paymentResult.payment_id,
                        orderId: order_id,
                        userId: user_id,
                        amount: amount,
                        status: existing.status,
                        gateway: 'paystack',
                        correlationId: finalIdempotencyKey,
                        source: 'duplicate_reference_recovery'
                    });
                } else {
                    // No existing payment found, treat as regular failure
                    const updateQuery = `
                        UPDATE payments 
                        SET status = 'FAILED', gateway_response = $1, updated_at = NOW()
                        WHERE id = $2
                    `;
                    
                    await dbPoolManager.executeWrite(updateQuery, [
                        JSON.stringify(gatewayResult.error),
                        paymentResult.payment_id
                    ]);
                }
            } else {
                // Regular failure handling - but don't update gateway response for duplicate reference errors
                if (gatewayResult.error?.code === 'DUPLICATE_REFERENCE') {
                    // For duplicate reference errors, don't update the gateway response
                    // The existing payment's original gateway response should be preserved
                    console.log(`Skipping gateway response update for duplicate reference error on payment ${paymentResult.payment_id}`);
                } else {
                    // Regular failure handling
            const updateQuery = `
                UPDATE payments 
                SET status = 'FAILED', gateway_response = $1, updated_at = NOW()
                WHERE id = $2
            `;
            
            await dbPoolManager.executeWrite(updateQuery, [
                JSON.stringify(gatewayResult.error),
                paymentResult.payment_id
            ]);
                }
            }
        }

        // Get the actual idempotency key from the database
        const idempotencyQuery = `
            SELECT idempotency_key FROM payments WHERE id = $1
        `;
        const idempotencyResult = await dbPoolManager.executeRead(idempotencyQuery, [paymentResult.payment_id]);
        const actualIdempotencyKey = idempotencyResult.rows[0]?.idempotency_key || finalIdempotencyKey;

        // Handle duplicate reference error in response
        if (!gatewayResult.success && gatewayResult.error?.code === 'DUPLICATE_REFERENCE') {
            // Check if we have an existing payment with this idempotency key
            const existingPaymentQuery = `
                SELECT id, status, gateway_response, created_at, updated_at, user_id, order_id, amount, currency
                FROM payments 
                WHERE idempotency_key = $1
                ORDER BY created_at ASC
                LIMIT 1
            `;
            
            const existingPayment = await dbPoolManager.executeRead(existingPaymentQuery, [actualIdempotencyKey]);
            
            if (existingPayment.rows.length > 0) {
                const existing = existingPayment.rows[0];
                console.log(`Found existing payment ${existing.id} for duplicate reference response`);
                
                // Return the existing payment data
                return res.status(200).json({
                    success: true,
                    message: 'Duplicate reference detected - returning existing payment',
                    data: {
                        id: existing.id,
                        userId: existing.user_id,
                        orderId: existing.order_id,
                        amount: existing.amount,
                        currency: existing.currency,
                        status: existing.status,
                        gatewayResponse: existing.gateway_response,
                        idempotencyKey: actualIdempotencyKey,
                        retry: retry,
                        metadata: metadata,
                        createdAt: existing.created_at,
                        updatedAt: existing.updated_at
                    }
                });
            }
        }

        // Return response
        const responseStatus = gatewayResult.success ? 201 : 400;
        const responseData = {
            id: paymentResult.payment_id,
            userId: user_id,
            orderId: order_id,
            amount: amount,
            currency: currency,
            status: gatewayResult.success ? gatewayResult.status : 'FAILED',
            gatewayResponse: gatewayResult.success ? gatewayResult.gatewayResponse : gatewayResult.error,
            idempotencyKey: actualIdempotencyKey,
            retry: retry,
            metadata: metadata,
            createdAt: paymentResult.created_at,
            updatedAt: new Date().toISOString()
        };

        if (gatewayResult.success) {
            res.status(responseStatus).json({
                data: responseData,
                metadata: {
                    status: responseStatus,
                    correlation_id: req.headers['x-request-id'] || 'unknown'
                }
            });
        } else {
            res.status(responseStatus).json({
                success: false,
                error: {
                    code: 'PAYMENT_PROCESSING_FAILED',
                    message: gatewayResult.error.message,
                    details: gatewayResult.error
                },
                data: responseData
            });
        }

    } catch (error) {
        console.error('Payment creation error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Internal server error',
                details: error.message
            }
        });
    }
});

// Payment methods endpoints removed - handled by gateway directly

/**
 * GET /payments/{id} - Get payment by ID
 */
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        // Validate UUID format
        if (!SECURITY_CONFIG.UUID_PATTERN.test(id)) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_UUID',
                    message: 'Invalid payment ID format',
                    details: 'Payment ID must be a valid UUID'
                }
            });
        }

        // Use archival lookup function to check both main and archived tables
        const query = `SELECT * FROM get_payment_with_archive($1)`;

        const result = await dbPoolManager.executeRead(query, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: {
                    code: 'PAYMENT_NOT_FOUND',
                    message: 'Payment not found',
                    details: `No payment found with ID: ${id}`
                }
            });
        }

        const payment = result.rows[0];

        res.json({
            success: true,
            data: {
                id: payment.id,
                userId: payment.user_id,
                orderId: payment.order_id,
                amount: payment.amount,
                currency: payment.currency,
                status: payment.status,
                gatewayResponse: payment.gateway_response,
                idempotencyKey: payment.idempotency_key,
                metadata: payment.metadata,
                createdAt: payment.created_at,
                updatedAt: payment.updated_at
            },
            metadata: {
                status: 200,
                correlation_id: req.headers['x-request-id'] || 'unknown'
            }
        });

    } catch (error) {
        console.error('Get payment error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Internal server error',
                details: error.message
            }
        });
    }
});

/**
 * GET /payments/user/{userId} - Get payments for a user
 */
router.get('/user/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        const { limit = 20, offset = 0, status } = req.query;

        // Validate user ID format (any non-empty string is valid now)
        if (!userId || userId.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: {
                    code: 'INVALID_USER_ID',
                    message: 'Invalid user ID format',
                    details: 'User ID must be a non-empty string'
                }
            });
        }

        const limitNum = Math.min(parseInt(limit) || 20, 100);
        const offsetNum = Math.max(parseInt(offset) || 0, 0);

        // Use archival lookup function to get user payments from both main and archived tables
        const query = `SELECT * FROM get_user_payments_with_archive($1, $2, $3)`;

        const result = await dbPoolManager.executeRead(query, [
            userId,
            limitNum,
            offsetNum
        ]);

        const payments = result.rows.map(row => ({
            id: row.id,
            userId: row.user_id,
            orderId: row.order_id,
            amount: row.amount,
            currency: row.currency,
            status: row.status,
            gatewayResponse: row.gateway_response,
            idempotencyKey: row.idempotency_key,
            metadata: row.metadata,
            createdAt: row.created_at,
            updatedAt: row.updated_at
        }));

        res.json({
            success: true,
            data: payments,
            metadata: {
                status: 200,
                correlation_id: req.headers['x-request-id'] || 'unknown',
                total_count: result.rows.length > 0 ? result.rows[0].total_count : 0
            }
        });

    } catch (error) {
        console.error('Get user payments error:', error);
        res.status(500).json({
            success: false,
            error: {
                code: 'INTERNAL_ERROR',
                message: 'Internal server error',
                details: error.message
            }
        });
    }
});

export default router;
