/**
 * Payment Processor Service
 * Orchestrates payment processing with Paystack
 */

import { 
    initializePayment, 
    verifyPayment, 
    processRefund as paystackRefund, 
    verifyWebhook as paystackVerifyWebhook, 
    handleWebhook as paystackHandleWebhook,
    getSupportedPaymentMethods,
    getSupportedCurrencies
} from '../gateways/paystack.js';

/**
 * Process payment using Paystack
 */
export const processPayment = async (paymentData) => {
    try {
        const { 
            userId, 
            orderId, 
            amount, 
            currency, 
            metadata = {},
            idempotencyKey 
        } = paymentData;

        // Validate required fields
        if (!userId || !orderId || !amount || !currency) {
            return {
                success: false,
                error: {
                    code: 'VALIDATION_ERROR',
                    message: 'Missing required fields',
                    details: 'user_id, order_id, amount, and currency are required'
                }
            };
        }

        // Validate amount
        if (amount < 1) {
            return {
                success: false,
                error: {
                    code: 'INVALID_AMOUNT',
                    message: 'Amount must be at least 1',
                    details: `Amount ${amount} is below minimum`
                }
            };
        }

        // Validate currency
        const supportedCurrencies = getSupportedCurrencies();
        const currencySupported = supportedCurrencies.some(c => c.code === currency);
        if (!currencySupported) {
            return {
                success: false,
                error: {
                    code: 'INVALID_CURRENCY',
                    message: 'Currency not supported',
                    details: `Currency ${currency} is not supported`
                }
            };
        }

        // Generate reference for Paystack
        const reference = idempotencyKey || `ref_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Prepare payment data for Paystack
        const paystackPaymentData = {
            amount: amount,
            currency: currency,
            email: metadata.user?.email || `${userId}@example.com`,
            reference: reference,
            metadata: {
                user_id: userId,
                order_id: orderId,
                ...metadata
            },
            callback_url: `${process.env.BASE_URL || 'http://localhost:8888'}/payments/return`
        };

        // Initialize payment with Paystack
        const result = await initializePayment(paystackPaymentData);

        if (!result.success) {
            return result;
        }

        return {
            success: true,
            transactionId: result.transactionId,
            status: result.status,
            gateway: 'paystack',
            gatewayResponse: result.gatewayResponse
        };

    } catch (error) {
        console.error('Payment processing error:', error);
        return {
            success: false,
            error: {
                code: 'PROCESSING_ERROR',
                message: 'Payment processing failed',
                details: error.message
            }
        };
    }
};

/**
 * Verify payment status
 */
export const queryPaymentStatus = async (transactionId) => {
    try {
        const result = await verifyPayment(transactionId);
        return result;
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'VERIFICATION_ERROR',
                message: 'Payment verification failed',
                details: error.message
            }
        };
    }
};

/**
 * Process refund using Paystack
 */
export const processRefundForGateway = async (refundData) => {
    try {
        const { transactionId, amount, reason } = refundData;

        const result = await paystackRefund({
            transactionId,
            amount,
            reason
        });

        return result;
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'REFUND_ERROR',
                message: 'Refund processing failed',
                details: error.message
            }
        };
    }
};

/**
 * Verify webhook signature
 */
export const verifyWebhookSignature = (payload, signature, gateway) => {
    try {
        switch (gateway) {
            case 'paystack':
                return paystackVerifyWebhook(payload, signature);
            default:
                return false;
        }
    } catch (error) {
        console.error('Webhook verification error:', error);
        return false;
    }
};

/**
 * Handle webhook events
 */
export const handleWebhookEvent = async (event, gateway) => {
    try {
        switch (gateway) {
            case 'paystack':
                return await paystackHandleWebhook(event);
            default:
                return {
                    success: false,
                    error: {
                        code: 'UNKNOWN_GATEWAY',
                        message: `Unknown gateway: ${gateway}`,
                        type: 'webhook_error'
                    }
                };
        }
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'WEBHOOK_ERROR',
                message: 'Webhook processing failed',
                details: error.message
            }
        };
    }
};

/**
 * Create payment method for gateway
 */
export const createPaymentMethodForGateway = async (paymentMethodData) => {
    try {
        const { type, gateway, ...details } = paymentMethodData;

        // For Paystack, we don't need to create payment methods upfront
        // They are created during payment initialization
        return {
            success: true,
            paymentMethodId: `pm_${Date.now()}`,
            gatewayResponse: {
                type: type,
                gateway: gateway,
                created: true
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'PAYMENT_METHOD_ERROR',
                message: 'Payment method creation failed',
                details: error.message
            }
        };
    }
};

/**
 * Get supported payment methods
 */
export const getSupportedPaymentMethodsForGateway = () => {
    return getSupportedPaymentMethods();
};

/**
 * Get supported currencies
 */
export const getSupportedCurrenciesForGateway = () => {
    return getSupportedCurrencies();
};