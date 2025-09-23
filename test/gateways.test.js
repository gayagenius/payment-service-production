import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createPaymentIntent, createPaymentMethod, processRefund, verifyWebhook, handleWebhook } from '../gateways/stripe.js';
import { initiateSTKPush, processRefund as mpesaRefund, validatePhoneNumber } from '../gateways/mpesa.js';

// Mock Stripe
vi.mock('stripe', () => {
    return {
        default: vi.fn(() => ({
            paymentIntents: {
                create: vi.fn()
            },
            paymentMethods: {
                create: vi.fn()
            },
            refunds: {
                create: vi.fn()
            },
            webhooks: {
                constructEvent: vi.fn()
            }
        }))
    };
});

// Mock axios for M-Pesa
vi.mock('axios', () => ({
    default: {
        get: vi.fn(),
        post: vi.fn()
    }
}));

describe('Stripe Gateway', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('createPaymentIntent', () => {
        it('should create payment intent successfully', async () => {
            const paymentData = {
                amount: 2500,
                currency: 'USD',
                paymentMethodId: 'pm_1234567890',
                metadata: { order_id: 'order_123' },
                idempotencyKey: 'test_key_123'
            };

            const mockPaymentIntent = {
                id: 'pi_1234567890',
                status: 'succeeded',
                client_secret: 'pi_1234567890_secret_abc123',
                charges: {
                    data: [{
                        id: 'ch_1234567890',
                        status: 'succeeded',
                        amount: 2500,
                        currency: 'usd'
                    }]
                }
            };

            const { default: Stripe } = await import('stripe');
            const mockStripe = new Stripe();
            mockStripe.paymentIntents.create.mockResolvedValue(mockPaymentIntent);

            const result = await createPaymentIntent(paymentData);

            expect(result.success).toBe(true);
            expect(result.transactionId).toBe('pi_1234567890');
            expect(result.status).toBe('SUCCEEDED');
            expect(result.gatewayResponse.payment_intent_id).toBe('pi_1234567890');
        });

        it('should handle payment intent creation failure', async () => {
            const paymentData = {
                amount: 2500,
                currency: 'USD',
                paymentMethodId: 'pm_invalid'
            };

            const { default: Stripe } = await import('stripe');
            const mockStripe = new Stripe();
            mockStripe.paymentIntents.create.mockRejectedValue({
                code: 'card_declined',
                message: 'Your card was declined.',
                type: 'card_error'
            });

            const result = await createPaymentIntent(paymentData);

            expect(result.success).toBe(false);
            expect(result.error.code).toBe('card_declined');
            expect(result.error.message).toBe('Your card was declined.');
        });
    });

    describe('createPaymentMethod', () => {
        it('should create card payment method successfully', async () => {
            const paymentMethodData = {
                type: 'CARD',
                token: 'tok_1234567890',
                brand: 'VISA',
                last4: '4242',
                metadata: { user_id: 'user_123' }
            };

            const mockPaymentMethod = {
                id: 'pm_1234567890',
                type: 'card',
                card: {
                    brand: 'VISA',
                    last4: '4242',
                    exp_month: 12,
                    exp_year: 2025
                }
            };

            const { default: Stripe } = await import('stripe');
            const mockStripe = new Stripe();
            mockStripe.paymentMethods.create.mockResolvedValue(mockPaymentMethod);

            const result = await createPaymentMethod(paymentMethodData);

            expect(result.success).toBe(true);
            expect(result.paymentMethodId).toBe('pm_1234567890');
            expect(result.gatewayResponse.type).toBe('card');
        });
    });

    describe('processRefund', () => {
        it('should process refund successfully', async () => {
            const refundData = {
                paymentIntentId: 'pi_1234567890',
                amount: 1000,
                reason: 'Customer requested refund',
                metadata: { refund_id: 'refund_123' },
                idempotencyKey: 'refund_key_123'
            };

            const mockRefund = {
                id: 're_1234567890',
                status: 'succeeded',
                amount: 1000,
                currency: 'usd',
                reason: 'requested_by_customer'
            };

            const { default: Stripe } = await import('stripe');
            const mockStripe = new Stripe();
            mockStripe.refunds.create.mockResolvedValue(mockRefund);

            const result = await processRefund(refundData);

            expect(result.success).toBe(true);
            expect(result.refundId).toBe('re_1234567890');
            expect(result.status).toBe('SUCCEEDED');
        });
    });
});

describe('M-Pesa Gateway', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('validatePhoneNumber', () => {
        it('should validate Kenyan phone numbers correctly', () => {
            // Test different formats
            expect(validatePhoneNumber('254712345678')).toEqual({
                valid: true,
                formatted: '254712345678'
            });

            expect(validatePhoneNumber('0712345678')).toEqual({
                valid: true,
                formatted: '254712345678'
            });

            expect(validatePhoneNumber('712345678')).toEqual({
                valid: true,
                formatted: '254712345678'
            });

            expect(validatePhoneNumber('123456789')).toEqual({
                valid: false,
                error: 'Invalid phone number format. Expected: 254XXXXXXXXX, 07XXXXXXXX, or 7XXXXXXXX'
            });
        });
    });

    describe('initiateSTKPush', () => {
        it('should initiate STK push successfully', async () => {
            const paymentData = {
                amount: 1000,
                phoneNumber: '254712345678',
                accountReference: 'order_123',
                transactionDesc: 'Test payment',
                metadata: { order_id: 'order_123' },
                idempotencyKey: 'test_key_123'
            };

            const mockResponse = {
                data: {
                    ResponseCode: '0',
                    CheckoutRequestID: 'ws_CO_1234567890',
                    MerchantRequestID: 'ws_MerchantRequestID_123',
                    ResponseDescription: 'Success. Request accepted for processing',
                    CustomerMessage: 'Success. Request accepted for processing'
                }
            };

            const axios = await import('axios');
            axios.default.post.mockResolvedValue(mockResponse);
            axios.default.get.mockResolvedValue({
                data: { access_token: 'test_token', expires_in: 3600 }
            });

            const result = await initiateSTKPush(paymentData);

            expect(result.success).toBe(true);
            expect(result.transactionId).toBe('ws_CO_1234567890');
            expect(result.status).toBe('PENDING');
        });

        it('should handle STK push failure', async () => {
            const paymentData = {
                amount: 1000,
                phoneNumber: '254712345678',
                accountReference: 'order_123',
                transactionDesc: 'Test payment'
            };

            const mockResponse = {
                data: {
                    ResponseCode: '1',
                    ResponseDescription: 'Unable to lock subscriber'
                }
            };

            const axios = await import('axios');
            axios.default.post.mockResolvedValue(mockResponse);
            axios.default.get.mockResolvedValue({
                data: { access_token: 'test_token', expires_in: 3600 }
            });

            const result = await initiateSTKPush(paymentData);

            expect(result.success).toBe(false);
            expect(result.error.code).toBe('MPESA_STK_PUSH_FAILED');
        });
    });

    describe('processRefund', () => {
        it('should process M-Pesa refund successfully', async () => {
            const refundData = {
                transactionId: 'ws_CO_1234567890',
                amount: 500,
                phoneNumber: '254712345678',
                remarks: 'Customer requested refund',
                metadata: { refund_id: 'refund_123' },
                idempotencyKey: 'refund_key_123'
            };

            const mockResponse = {
                data: {
                    ResponseCode: '0',
                    OriginatorConversationID: 'ref_1234567890',
                    ConversationID: 'conv_1234567890',
                    ResponseDescription: 'Accept the service request successfully.'
                }
            };

            const axios = await import('axios');
            axios.default.post.mockResolvedValue(mockResponse);
            axios.default.get.mockResolvedValue({
                data: { access_token: 'test_token', expires_in: 3600 }
            });

            const result = await mpesaRefund(refundData);

            expect(result.success).toBe(true);
            expect(result.refundId).toBe('ref_1234567890');
            expect(result.status).toBe('PENDING');
        });
    });
});
