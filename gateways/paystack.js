/**
 * Paystack Payment Gateway Integration
 * Handles payment processing, refunds, and webhooks for Paystack
 */

import fetch from 'node-fetch';
import crypto from 'crypto';
import { paystackRateLimiter, retryWithBackoff } from '../utils/rateLimiter.js';
import { circuitBreakers, withCircuitBreaker } from '../utils/circuitBreaker.js';
import { errorHandler, ERROR_TYPES } from '../utils/errorHandler.js';
import { trackPaystackApiCall } from '../monitoring/performanceMonitor.js';
import { logger, LOG_CATEGORIES } from '../utils/logger.js';

// Paystack API configuration
const PAYSTACK_BASE_URL = process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET;

/**
 * Initialize Paystack payment
 */
export const initializePayment = async (paymentData) => {
    try {
        const { amount, currency, email, reference, metadata, callback_url, customer } = paymentData;
        
        logger.info(LOG_CATEGORIES.PAYMENT, 'Initializing payment', {
            amount,
            currency,
            email,
            reference
        });

        // Prepare customer data for Paystack
        const customerData = customer ? {
            first_name: customer.first_name || customer.name?.split(' ')[0] || 'Customer',
            last_name: customer.last_name || customer.name?.split(' ').slice(1).join(' ') || '',
            email: customer.email || email,
            phone: customer.phone || '',
            metadata: {
                user_id: customer.user_id || metadata?.user_id,
                ...customer.metadata
            }
        } : {
            first_name: 'Customer',
            last_name: '',
            email: email,
            phone: '',
            metadata: metadata
        };

        // Use circuit breaker, rate limiter, and performance tracking
        const response = await trackPaystackApiCall('transaction/initialize', async () => {
            return await circuitBreakers.paystack.execute(async () => {
                return await paystackRateLimiter.execute(async () => {
                    return await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            amount: amount * 100, // Paystack expects amount in kobo (smallest currency unit)
                            currency: currency.toUpperCase(),
                            email: email,
                            reference: reference,
                            customer: customerData,
                            metadata: metadata,
                            callback_url: callback_url
                        })
                    });
                });
            });
        });

        const result = await response.json();

        if (!response.ok) {
            // Handle duplicate reference error specifically
            if (result.message && result.message.toLowerCase().includes('duplicate')) {
                logger.warn(LOG_CATEGORIES.PAYMENT, 'Duplicate reference detected', {
                    reference,
                    message: result.message
                });
                
                return {
                    success: false,
                    error: {
                        code: 'DUPLICATE_REFERENCE',
                        message: 'Duplicate reference detected',
                        details: result.message,
                        type: 'duplicate_reference_error'
                    }
                };
            }
            
            logger.error(LOG_CATEGORIES.PAYMENT, 'Payment initialization failed', {
                reference,
                status: response.status,
                error: result.message
            });
            
            return {
                success: false,
                error: {
                    code: result.status === false ? 'PAYSTACK_ERROR' : 'NETWORK_ERROR',
                    message: result.message || 'Payment initialization failed',
                    type: 'payment_error'
                }
            };
        }

        logger.info(LOG_CATEGORIES.PAYMENT, 'Payment initialized successfully', {
            reference: result.data.reference,
            accessCode: result.data.access_code
        });

        return {
            success: true,
            transactionId: result.data.reference,
            status: 'PENDING',
            gatewayResponse: {
                reference: result.data.reference,
                access_code: result.data.access_code,
                authorization_url: result.data.authorization_url,
                status: 'pending'
            }
        };

    } catch (error) {
        logger.error(LOG_CATEGORIES.PAYMENT, 'Payment initialization error', {
            reference: paymentData.reference,
            error: error.message
        });
        
        return {
            success: false,
            error: {
                code: 'PAYSTACK_ERROR',
                message: error.message,
                type: 'network_error'
            }
        };
    }
};

/**
 * Verify Paystack payment
 */
export const verifyPayment = async (reference) => {
    try {
        logger.info(LOG_CATEGORIES.PAYMENT, 'Verifying payment', { reference });
        
        // Use circuit breaker, rate limiter, and performance tracking
        const response = await trackPaystackApiCall('transaction/verify', async () => {
            return await circuitBreakers.paystack.execute(async () => {
                return await paystackRateLimiter.execute(async () => {
                    return await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${reference}`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
                            'Content-Type': 'application/json'
                        }
                    });
                });
            });
        });

        const result = await response.json();

        if (!response.ok) {
            logger.error(LOG_CATEGORIES.PAYMENT, 'Payment verification failed', {
                reference,
                status: response.status,
                error: result.message
            });
            
            return {
                success: false,
                error: {
                    code: 'PAYSTACK_ERROR',
                    message: result.message || 'Payment verification failed',
                    type: 'verification_error'
                }
            };
        }

        const status = mapPaystackStatus(result.data.status);
        
        logger.info(LOG_CATEGORIES.PAYMENT, 'Payment verified successfully', {
            reference,
            status,
            paystackStatus: result.data.status
        });
        
        return {
            success: true,
            transactionId: result.data.reference,
            status: status,
            gatewayResponse: {
                reference: result.data.reference,
                status: result.data.status,
                amount: result.data.amount,
                currency: result.data.currency,
                customer: result.data.customer,
                authorization: result.data.authorization,
                channel: result.data.channel,
                paid_at: result.data.paid_at,
                created_at: result.data.created_at
            }
        };

    } catch (error) {
        logger.error(LOG_CATEGORIES.PAYMENT, 'Payment verification error', {
            reference,
            error: error.message
        });
        
        return {
            success: false,
            error: {
                code: 'PAYSTACK_ERROR',
                message: error.message,
                type: 'network_error'
            }
        };
    }
};

/**
 * Get latest payment status from Paystack
 * This function retrieves the most recent status for a payment
 */
export const getLatestPaymentStatus = async (reference) => {
    try {
        console.log(`Fetching latest status for payment reference: ${reference}`);
        
        // Use circuit breaker, rate limiter, and performance tracking
        const response = await trackPaystackApiCall('transaction/verify', async () => {
            return await circuitBreakers.paystack.execute(async () => {
                return await paystackRateLimiter.execute(async () => {
                    return await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${reference}`, {
                        method: 'GET',
                        headers: {
                            'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
                            'Content-Type': 'application/json'
                        }
                    });
                });
            });
        });

        const result = await response.json();

        if (!response.ok) {
            console.error(`Failed to fetch payment status: ${result.message}`);
            return {
                success: false,
                error: {
                    code: 'PAYSTACK_ERROR',
                    message: result.message || 'Failed to fetch payment status',
                    type: 'status_fetch_error'
                }
            };
        }

        const status = mapPaystackStatus(result.data.status);
        
        console.log(`Payment ${reference} status: ${status} (Paystack: ${result.data.status})`);
        
        return {
            success: true,
            transactionId: result.data.reference,
            status: status,
            gatewayResponse: {
                reference: result.data.reference,
                status: result.data.status,
                amount: result.data.amount,
                currency: result.data.currency,
                customer: result.data.customer,
                authorization: result.data.authorization,
                channel: result.data.channel,
                paid_at: result.data.paid_at,
                created_at: result.data.created_at,
                fees: result.data.fees,
                fees_split: result.data.fees_split,
                gateway_response: result.data.gateway_response,
                ip_address: result.data.ip_address,
                log: result.data.log,
                message: result.data.message,
                requested_amount: result.data.requested_amount,
                pos_transaction_data: result.data.pos_transaction_data,
                source: result.data.source,
                status_message: result.data.status_message,
                transaction_date: result.data.transaction_date,
                domain: result.data.domain
            }
        };

    } catch (error) {
        console.error(`Error fetching payment status for ${reference}:`, error);
        return {
            success: false,
            error: {
                code: 'PAYSTACK_ERROR',
                message: error.message,
                type: 'network_error'
            }
        };
    }
};

/**
 * Process refund
 */
export const processRefund = async (refundData) => {
    try {
        const { transactionId, amount, reason } = refundData;
        
        logger.info(LOG_CATEGORIES.PAYMENT, 'Processing refund', {
            transactionId,
            amount,
            reason
        });

        // Use circuit breaker, rate limiter, and performance tracking
        const response = await trackPaystackApiCall('refund', async () => {
            return await circuitBreakers.paystack.execute(async () => {
                return await paystackRateLimiter.execute(async () => {
                    return await fetch(`${PAYSTACK_BASE_URL}/refund`, {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({
                            transaction: transactionId,
                            amount: amount * 100,
                            reason: reason || 'Customer requested refund'
                        })
                    });
                });
            });
        });

        const result = await response.json();

        if (!response.ok) {
            logger.error(LOG_CATEGORIES.PAYMENT, 'Refund processing failed', {
                transactionId,
                status: response.status,
                error: result.message
            });
            
            return {
                success: false,
                error: {
                    code: 'PAYSTACK_ERROR',
                    message: result.message || 'Refund failed',
                    type: 'refund_error'
                }
            };
        }

        logger.info(LOG_CATEGORIES.PAYMENT, 'Refund processed successfully', {
            transactionId,
            refundId: result.data.id,
            status: result.data.status
        });

        return {
            success: true,
            refundId: result.data.id,
            status: mapPaystackStatus(result.data.status),
            gatewayResponse: {
                refund_id: result.data.id,
                transaction_id: result.data.transaction.id,
                amount: result.data.amount,
                currency: result.data.currency,
                status: result.data.status,
                created_at: result.data.created_at
            }
        };

    } catch (error) {
        logger.error(LOG_CATEGORIES.PAYMENT, 'Refund processing error', {
            transactionId: refundData.transactionId,
            error: error.message
        });
        
        return {
            success: false,
            error: {
                code: 'PAYSTACK_ERROR',
                message: error.message,
                type: 'network_error'
            }
        };
    }
};

/**
 * Verify webhook signature
 */
export const verifyWebhook = (payload, signature) => {
    try {
        const hash = crypto.createHmac('sha512', PAYSTACK_WEBHOOK_SECRET)
            .update(payload)
            .digest('hex');
        
        return hash === signature;
    } catch (error) {
        console.error('Webhook verification error:', error);
        return false;
    }
};

/**
 * Handle webhook events
 */
export const handleWebhook = async (event) => {
    try {
        const { event: eventType, data } = event;

        logger.info(LOG_CATEGORIES.WEBHOOK, 'Processing Paystack webhook', {
            eventType,
            reference: data.reference,
            dataId: data.id
        });

        switch (eventType) {
            case 'charge.success':
                logger.info(LOG_CATEGORIES.WEBHOOK, 'Payment succeeded via webhook', {
                    reference: data.reference,
                    amount: data.amount
                });
                
                return {
                    type: 'payment_update',
                    payment_id: data.reference, // This will be looked up by reference
                    status: 'SUCCEEDED',
                    gatewayResponse: data
                };

            case 'charge.failed':
                logger.warn(LOG_CATEGORIES.WEBHOOK, 'Payment failed via webhook', {
                    reference: data.reference,
                    reason: data.gateway_response?.message
                });
                
                return {
                    type: 'payment_update',
                    payment_id: data.reference, // This will be looked up by reference
                    status: 'FAILED',
                    gatewayResponse: data
                };

            case 'refund.processed':
                logger.info(LOG_CATEGORIES.WEBHOOK, 'Refund processed via webhook', {
                    refundId: data.id,
                    transactionId: data.transaction?.id
                });
                
                return {
                    type: 'refund_update',
                    refundId: data.id,
                    status: 'SUCCEEDED',
                    gatewayResponse: data
                };

            default:
                logger.warn(LOG_CATEGORIES.WEBHOOK, 'Unhandled webhook event', {
                    eventType,
                    reference: data.reference
                });
                
                return {
                    success: false,
                    error: {
                        code: 'UNKNOWN_EVENT',
                        message: `Unknown webhook event: ${eventType}`,
                        type: 'webhook_error'
                    }
                };
        }

    } catch (error) {
        logger.error(LOG_CATEGORIES.WEBHOOK, 'Webhook processing error', {
            eventType: event?.event,
            reference: event?.data?.reference,
            error: error.message
        });
        
        return {
            success: false,
            error: {
                code: 'WEBHOOK_ERROR',
                message: error.message,
                type: 'processing_error'
            }
        };
    }
};

/**
 * Map Paystack status to our internal status
 */
const mapPaystackStatus = (paystackStatus) => {
    const statusMap = {
        'pending': 'PENDING',
        'success': 'SUCCEEDED',
        'failed': 'FAILED',
        'reversed': 'REVERSED',
        'refunded': 'REFUNDED'
    };

    return statusMap[paystackStatus] || 'PENDING';
};

/**
 * Get supported payment methods
 */
export const getSupportedPaymentMethods = () => {
    return [
        {
            type: 'CARD',
            name: 'Credit/Debit Card',
            description: 'Visa, Mastercard, American Express',
            requiresBrand: true,
            requiresLast4: true
        },
        {
            type: 'BANK_TRANSFER',
            name: 'Bank Transfer',
            description: 'Direct bank transfers',
            requiresBrand: false,
            requiresLast4: false
        },
        {
            type: 'USSD',
            name: 'USSD',
            description: 'USSD payments',
            requiresBrand: false,
            requiresLast4: false
        },
        {
            type: 'QR',
            name: 'QR Code',
            description: 'QR code payments',
            requiresBrand: false,
            requiresLast4: false
        }
    ];
};

/**
 * Get supported currencies
 */
export const getSupportedCurrencies = () => {
    return [
        { code: 'NGN', name: 'Nigerian Naira' },
        { code: 'USD', name: 'US Dollar' },
        { code: 'GBP', name: 'British Pound' },
        { code: 'EUR', name: 'Euro' },
        { code: 'KES', name: 'Kenyan Shilling' },
        { code: 'GHS', name: 'Ghanaian Cedi' },
        { code: 'ZAR', name: 'South African Rand' }
    ];
};
