import { createPaymentIntent, createPaymentMethod, processRefund as stripeRefund, verifyWebhook as stripeVerifyWebhook, handleWebhook as stripeHandleWebhook } from '../gateways/stripe.js';
import { initiateSTKPush, querySTKPushStatus, processRefund as mpesaRefund, verifyWebhook as mpesaVerifyWebhook, handleWebhook as mpesaHandleWebhook, validatePhoneNumber } from '../gateways/mpesa.js';
/**
 * Determine which gateway to use based on payment method type
 */
const getGatewayForPaymentMethod = (paymentMethodType) => {
    const gatewayMap = {
        'CARD': 'stripe',
        'WALLET': 'stripe',
        'BANK_TRANSFER': 'stripe',
        'MPESA': 'mpesa',
        'MOBILE_MONEY': 'mpesa'
    };
    return gatewayMap[paymentMethodType] || 'stripe';
};

/**
 * Process payment using the appropriate gateway
 */
export const processPayment = async (paymentData) => {
    try {
        const { paymentMethodType, amount, currency, metadata } = paymentData;
        const gateway = getGatewayForPaymentMethod(paymentMethodType);

        // Validate currency for M-Pesa (only KES supported)
        if (gateway === 'mpesa' && currency !== 'KES') {
            return {
                success: false,
                error: {
                    code: 'INVALID_CURRENCY',
                    message: 'M-Pesa only supports KES currency',
                    details: `Currency ${currency} not supported for M-Pesa payments`
                }
            };
        }

        // Validate amount for M-Pesa (minimum 1 KES)
        if (gateway === 'mpesa' && amount < 1) {
            return {
                success: false,
                error: {
                    code: 'INVALID_AMOUNT',
                    message: 'M-Pesa minimum amount is 1 KES',
                    details: `Amount ${amount} is below minimum for M-Pesa`
                }
            };
        }

        let result;

        if (gateway === 'stripe') {
            result = await processStripePayment(paymentData);
        } else if (gateway === 'mpesa') {
            result = await processMpesaPayment(paymentData);
        }

        return result;
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'PAYMENT_PROCESSING_ERROR',
                message: error.message
            }
        };
    }
};

/**
 * Process Stripe payment
 */
const processStripePayment = async (paymentData) => {
    const { paymentMethodId, amount, currency, metadata, idempotencyKey } = paymentData;

    // Create payment intent
    const paymentIntentResult = await createPaymentIntent({
        amount,
        currency,
        paymentMethodId,
        metadata,
        idempotencyKey
    });

    if (!paymentIntentResult.success) {
        return paymentIntentResult;
    }

    return {
        success: true,
        transactionId: paymentIntentResult.transactionId,
        status: paymentIntentResult.status,
        gateway: 'stripe',
        gatewayResponse: paymentIntentResult.gatewayResponse
    };
};

/**
 * Process M-Pesa payment
 */
const processMpesaPayment = async (paymentData) => {
    const { phoneNumber, amount, accountReference, transactionDesc, metadata, idempotencyKey } = paymentData;

    // Validate phone number
    const phoneValidation = validatePhoneNumber(phoneNumber);
    if (!phoneValidation.valid) {
        return {
            success: false,
            error: {
                code: 'INVALID_PHONE_NUMBER',
                message: phoneValidation.error
            }
        };
    }

    // Initiate STK Push
    const stkPushResult = await initiateSTKPush({
        amount,
        phoneNumber: phoneValidation.formatted,
        accountReference,
        transactionDesc,
        metadata,
        idempotencyKey
    });

    if (!stkPushResult.success) {
        return stkPushResult;
    }

    return {
        success: true,
        transactionId: stkPushResult.transactionId,
        status: stkPushResult.status,
        gateway: 'mpesa',
        gatewayResponse: stkPushResult.gatewayResponse
    };
};

/**
 * Create payment method using the appropriate gateway
 */
export const createPaymentMethodForGateway = async (paymentMethodData) => {
    try {
        const { type, gateway } = paymentMethodData;

        if (gateway === 'stripe') {
            return await createPaymentMethod(paymentMethodData);
        } else if (gateway === 'mpesa') {
            // M-Pesa doesn't support saved payment methods
            // Return a mock response for consistency
            return {
                success: true,
                paymentMethodId: `mpesa_${Date.now()}`,
                gatewayResponse: {
                    type: 'MPESA',
                    phone_number: paymentMethodData.phoneNumber
                }
            };
        }

        return {
            success: false,
            error: {
                code: 'UNSUPPORTED_GATEWAY',
                message: `Gateway ${gateway} not supported for payment method creation`
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'PAYMENT_METHOD_CREATION_ERROR',
                message: error.message
            }
        };
    }
};

/**
 * Process refund using the appropriate gateway
 */
export const processRefundForGateway = async (refundData) => {
    try {
        const { gateway, transactionId, amount, reason, metadata, idempotencyKey } = refundData;

        if (gateway === 'stripe') {
            return await stripeRefund({
                paymentIntentId: transactionId,
                amount,
                reason,
                metadata,
                idempotencyKey
            });
        } else if (gateway === 'mpesa') {
            return await mpesaRefund({
                transactionId,
                amount,
                phoneNumber: refundData.phoneNumber,
                remarks: reason,
                metadata,
                idempotencyKey
            });
        }

        return {
            success: false,
            error: {
                code: 'UNSUPPORTED_GATEWAY',
                message: `Gateway ${gateway} not supported for refunds`
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'REFUND_PROCESSING_ERROR',
                message: error.message
            }
        };
    }
};

/**
 * Verify webhook signature
 */
export const verifyWebhookSignature = async (gateway, payload, signature) => {
    try {
        if (gateway === 'stripe') {
            return stripeVerifyWebhook(payload, signature);
        } else if (gateway === 'mpesa') {
            return mpesaVerifyWebhook(payload, signature);
        }

        return {
            success: false,
            error: {
                code: 'UNSUPPORTED_GATEWAY',
                message: `Gateway ${gateway} not supported for webhook verification`
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'WEBHOOK_VERIFICATION_ERROR',
                message: error.message
            }
        };
    }
};

/**
 * Handle webhook event
 */
export const handleWebhookEvent = async (gateway, event) => {
    try {
        if (gateway === 'stripe') {
            return await stripeHandleWebhook(event);
        } else if (gateway === 'mpesa') {
            return await mpesaHandleWebhook(event);
        }

        return {
            success: false,
            error: {
                code: 'UNSUPPORTED_GATEWAY',
                message: `Gateway ${gateway} not supported for webhook handling`
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'WEBHOOK_HANDLING_ERROR',
                message: error.message
            }
        };
    }
};

/**
 * Query payment status (for M-Pesa)
 */
export const queryPaymentStatus = async (gateway, transactionId) => {
    try {
        if (gateway === 'mpesa') {
            return await querySTKPushStatus(transactionId);
        }

        // Stripe doesn't need status querying as it's real-time
        return {
            success: false,
            error: {
                code: 'UNSUPPORTED_OPERATION',
                message: `Status querying not supported for gateway ${gateway}`
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'STATUS_QUERY_ERROR',
                message: error.message
            }
        };
    }
};

/**
 * Get supported payment methods for a gateway
 */
export const getSupportedPaymentMethods = (gateway) => {
    const supportedMethods = {
        'stripe': ['CARD', 'WALLET', 'BANK_TRANSFER'],
        'mpesa': ['MPESA', 'MOBILE_MONEY']
    };
    
    return supportedMethods[gateway] || [];
};

/**
 * Get supported currencies for a gateway
 */
export const getSupportedCurrencies = (gateway) => {
    const supportedCurrencies = {
        'stripe': ['USD', 'EUR', 'GBP', 'KES', 'NGN', 'ZAR', 'EGP'],
        'mpesa': ['KES']
    };
    
    return supportedCurrencies[gateway] || [];
};
