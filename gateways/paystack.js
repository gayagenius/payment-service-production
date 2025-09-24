/**
 * Paystack Payment Gateway Integration
 * Handles payment processing, refunds, and webhooks for Paystack
 */

import fetch from 'node-fetch';

// Paystack API configuration
const PAYSTACK_BASE_URL = process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co';
const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_WEBHOOK_SECRET = process.env.PAYSTACK_WEBHOOK_SECRET;

/**
 * Initialize Paystack payment
 */
export const initializePayment = async (paymentData) => {
    try {
        const { amount, currency, email, reference, metadata, callback_url } = paymentData;

        const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/initialize`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                amount: amount, // Paystack expects amount in kobo (smallest currency unit)
                currency: currency.toUpperCase(),
                email: email,
                reference: reference,
                metadata: metadata,
                callback_url: callback_url
            })
        });

        const result = await response.json();

        if (!response.ok) {
            return {
                success: false,
                error: {
                    code: result.status === false ? 'PAYSTACK_ERROR' : 'NETWORK_ERROR',
                    message: result.message || 'Payment initialization failed',
                    type: 'payment_error'
                }
            };
        }

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
        const response = await fetch(`${PAYSTACK_BASE_URL}/transaction/verify/${reference}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            }
        });

        const result = await response.json();

        if (!response.ok) {
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

        const response = await fetch(`${PAYSTACK_BASE_URL}/refund`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${PAYSTACK_SECRET_KEY}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                transaction: transactionId,
                amount: amount,
                reason: reason || 'Customer requested refund'
            })
        });

        const result = await response.json();

        if (!response.ok) {
            return {
                success: false,
                error: {
                    code: 'PAYSTACK_ERROR',
                    message: result.message || 'Refund failed',
                    type: 'refund_error'
                }
            };
        }

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
        const crypto = require('crypto');
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

        switch (eventType) {
            case 'charge.success':
                return {
                    success: true,
                    transactionId: data.reference,
                    status: 'SUCCEEDED',
                    gatewayResponse: data
                };

            case 'charge.failed':
                return {
                    success: true,
                    transactionId: data.reference,
                    status: 'FAILED',
                    gatewayResponse: data
                };

            case 'refund.processed':
                return {
                    success: true,
                    refundId: data.id,
                    status: 'SUCCEEDED',
                    gatewayResponse: data
                };

            default:
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
        // 'reversed': 'REVERSED',
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
