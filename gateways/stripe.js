import Stripe from 'stripe';
import { PAYMENT_CONFIG } from '../config/constants.js';

// Initialize Stripe instance
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
    apiVersion: '2023-10-16',
});

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Map Stripe status to our payment status
 */
const mapStripeStatus = (stripeStatus) => {
    const statusMap = {
        'requires_payment_method': 'PENDING',
        'requires_confirmation': 'PENDING',
        'requires_action': 'PENDING',
        'processing': 'PENDING',
        'succeeded': 'SUCCEEDED',
        'canceled': 'CANCELLED'
    };
    return statusMap[stripeStatus] || 'FAILED';
};

/**
 * Map Stripe refund status to our refund status
 */
const mapStripeRefundStatus = (stripeStatus) => {
    const statusMap = {
        'pending': 'PENDING',
        'succeeded': 'SUCCEEDED',
        'failed': 'FAILED',
        'canceled': 'FAILED'
    };
    return statusMap[stripeStatus] || 'FAILED';
};

/**
 * Create a payment intent for card payments
 */
export const createPaymentIntent = async (paymentData) => {
    try {
        const { amount, currency, paymentMethodId, metadata, idempotencyKey } = paymentData;

        const paymentIntent = await stripe.paymentIntents.create({
            amount: amount,
            currency: currency.toLowerCase(),
            payment_method: paymentMethodId,
            confirmation_method: 'manual',
            confirm: true,
            metadata: {
                ...metadata,
                idempotency_key: idempotencyKey,
                gateway: 'stripe'
            },
            idempotency_key: idempotencyKey
        }, {
            idempotencyKey: idempotencyKey
        });

        return {
            success: true,
            transactionId: paymentIntent.id,
            status: mapStripeStatus(paymentIntent.status),
            gatewayResponse: {
                payment_intent_id: paymentIntent.id,
                status: paymentIntent.status,
                client_secret: paymentIntent.client_secret,
                charges: paymentIntent.charges?.data?.[0] ? {
                    id: paymentIntent.charges.data[0].id,
                    status: paymentIntent.charges.data[0].status,
                    amount: paymentIntent.charges.data[0].amount,
                    currency: paymentIntent.charges.data[0].currency
                } : null
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                code: error.code || 'STRIPE_ERROR',
                message: error.message,
                type: error.type
            }
        };
    }
};

/**
 * Create a payment method for future use
 */
export const createPaymentMethod = async (paymentMethodData) => {
    try {
        const { type, token, brand, last4, metadata } = paymentMethodData;

        let paymentMethod;
        
        if (type === 'CARD') {
            // For card payments, create payment method from token
            paymentMethod = await stripe.paymentMethods.create({
                type: 'card',
                card: {
                    token: token
                },
                metadata: {
                    ...metadata,
                    brand: brand,
                    last4: last4
                }
            });
        } else if (type === 'WALLET') {
            // For wallet payments (Apple Pay, Google Pay)
            paymentMethod = await stripe.paymentMethods.create({
                type: 'card',
                card: {
                    token: token
                },
                metadata: {
                    ...metadata,
                    wallet_type: 'digital_wallet'
                }
            });
        }

        return {
            success: true,
            paymentMethodId: paymentMethod.id,
            gatewayResponse: {
                payment_method_id: paymentMethod.id,
                type: paymentMethod.type,
                card: paymentMethod.card ? {
                    brand: paymentMethod.card.brand,
                    last4: paymentMethod.card.last4,
                    exp_month: paymentMethod.card.exp_month,
                    exp_year: paymentMethod.card.exp_year
                } : null
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                code: error.code || 'STRIPE_ERROR',
                message: error.message,
                type: error.type
            }
        };
    }
};

/**
 * Process a refund
 */
export const processRefund = async (refundData) => {
    try {
        const { paymentIntentId, amount, reason, metadata, idempotencyKey } = refundData;

        const refund = await stripe.refunds.create({
            payment_intent: paymentIntentId,
            amount: amount,
            reason: reason || 'requested_by_customer',
            metadata: {
                ...metadata,
                idempotency_key: idempotencyKey
            }
        }, {
            idempotencyKey: idempotencyKey
        });

        return {
            success: true,
            refundId: refund.id,
            status: mapStripeRefundStatus(refund.status),
            gatewayResponse: {
                refund_id: refund.id,
                status: refund.status,
                amount: refund.amount,
                currency: refund.currency,
                reason: refund.reason
            }
        };
    } catch (error) {
        return {
            success: false,
            error: {
                code: error.code || 'STRIPE_ERROR',
                message: error.message,
                type: error.type
            }
        };
    }
};

/**
 * Verify webhook signature
 */
export const verifyWebhook = (payload, signature) => {
    try {
        const event = stripe.webhooks.constructEvent(
            payload,
            signature,
            webhookSecret
        );
        return { success: true, event };
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'WEBHOOK_VERIFICATION_FAILED',
                message: error.message
            }
        };
    }
};

/**
 * Handle payment succeeded webhook
 */
const handlePaymentSucceeded = async (paymentIntent) => {
    return {
        success: true,
        paymentId: paymentIntent.metadata.payment_id,
        status: 'SUCCEEDED',
        gatewayResponse: {
            payment_intent_id: paymentIntent.id,
            status: paymentIntent.status,
            amount: paymentIntent.amount,
            currency: paymentIntent.currency
        }
    };
};

/**
 * Handle payment failed webhook
 */
const handlePaymentFailed = async (paymentIntent) => {
    return {
        success: true,
        paymentId: paymentIntent.metadata.payment_id,
        status: 'FAILED',
        gatewayResponse: {
            payment_intent_id: paymentIntent.id,
            status: paymentIntent.status,
            last_payment_error: paymentIntent.last_payment_error
        }
    };
};

/**
 * Handle payment canceled webhook
 */
const handlePaymentCanceled = async (paymentIntent) => {
    return {
        success: true,
        paymentId: paymentIntent.metadata.payment_id,
        status: 'CANCELLED',
        gatewayResponse: {
            payment_intent_id: paymentIntent.id,
            status: paymentIntent.status,
            cancellation_reason: paymentIntent.cancellation_reason
        }
    };
};

/**
 * Handle dispute created webhook
 */
const handleDisputeCreated = async (dispute) => {
    return {
        success: true,
        paymentId: dispute.metadata.payment_id,
        status: 'DISPUTED',
        gatewayResponse: {
            dispute_id: dispute.id,
            amount: dispute.amount,
            currency: dispute.currency,
            reason: dispute.reason,
            status: dispute.status
        }
    };
};

/**
 * Handle webhook events
 */
export const handleWebhook = async (event) => {
    try {
        switch (event.type) {
            case 'payment_intent.succeeded':
                return await handlePaymentSucceeded(event.data.object);
            case 'payment_intent.payment_failed':
                return await handlePaymentFailed(event.data.object);
            case 'payment_intent.canceled':
                return await handlePaymentCanceled(event.data.object);
            case 'charge.dispute.created':
                return await handleDisputeCreated(event.data.object);
            default:
                return {
                    success: true,
                    message: `Unhandled event type: ${event.type}`
                };
        }
    } catch (error) {
        return {
            success: false,
            error: {
                code: 'WEBHOOK_HANDLING_FAILED',
                message: error.message
            }
        };
    }
};
