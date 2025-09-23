import { describe, it, expect, beforeEach, vi } from 'vitest';
import { processPayment, createPaymentMethodForGateway, processRefundForGateway } from '../services/paymentProcessor.js';
import { createPaymentIntent, createPaymentMethod, processRefund } from '../gateways/stripe.js';
import { initiateSTKPush, processRefund as mpesaRefund } from '../gateways/mpesa.js';

// Mock the gateway functions
vi.mock('../gateways/stripe.js', () => ({
    createPaymentIntent: vi.fn(),
    createPaymentMethod: vi.fn(),
    processRefund: vi.fn()
}));

vi.mock('../gateways/mpesa.js', () => ({
    initiateSTKPush: vi.fn(),
    processRefund: vi.fn()
}));

describe('Payment Processing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('processPayment', () => {
        it('should process Stripe card payment successfully', async () => {
            const paymentData = {
                paymentMethodType: 'CARD',
                amount: 2500,
                currency: 'USD',
                paymentMethodId: 'pm_1234567890',
                metadata: { order_id: 'order_123' },
                idempotencyKey: 'test_key_123'
            };

            createPaymentIntent.mockResolvedValue({
                success: true,
                transactionId: 'pi_1234567890',
                status: 'SUCCEEDED',
                gatewayResponse: {
                    payment_intent_id: 'pi_1234567890',
                    status: 'succeeded'
                }
            });

            const result = await processPayment(paymentData);

            expect(result.success).toBe(true);
            expect(result.transactionId).toBe('pi_1234567890');
            expect(result.status).toBe('SUCCEEDED');
            expect(result.gateway).toBe('stripe');
            expect(createPaymentIntent).toHaveBeenCalledWith({
                amount: 2500,
                currency: 'USD',
                paymentMethodId: 'pm_1234567890',
                metadata: { order_id: 'order_123' },
                idempotencyKey: 'test_key_123'
            });
        });

        it('should process M-Pesa payment successfully', async () => {
            const paymentData = {
                paymentMethodType: 'MPESA',
                amount: 1000,
                currency: 'KES',
                phoneNumber: '254712345678',
                accountReference: 'order_456',
                transactionDesc: 'Test payment',
                metadata: { order_id: 'order_456' },
                idempotencyKey: 'test_key_456'
            };

            initiateSTKPush.mockResolvedValue({
                success: true,
                transactionId: 'ws_CO_1234567890',
                status: 'PENDING',
                gatewayResponse: {
                    checkout_request_id: 'ws_CO_1234567890',
                    response_code: '0'
                }
            });

            const result = await processPayment(paymentData);

            expect(result.success).toBe(true);
            expect(result.transactionId).toBe('ws_CO_1234567890');
            expect(result.status).toBe('PENDING');
            expect(result.gateway).toBe('mpesa');
            expect(initiateSTKPush).toHaveBeenCalledWith({
                amount: 1000,
                phoneNumber: '254712345678',
                accountReference: 'order_456',
                transactionDesc: 'Test payment',
                metadata: { order_id: 'order_456' },
                idempotencyKey: 'test_key_456'
            });
        });

        it('should reject M-Pesa payment with non-KES currency', async () => {
            const paymentData = {
                paymentMethodType: 'MPESA',
                amount: 1000,
                currency: 'USD',
                phoneNumber: '254712345678'
            };

            const result = await processPayment(paymentData);

            expect(result.success).toBe(false);
            expect(result.error.code).toBe('INVALID_CURRENCY');
            expect(result.error.message).toBe('M-Pesa only supports KES currency');
        });

        it('should reject M-Pesa payment with amount below minimum', async () => {
            const paymentData = {
                paymentMethodType: 'MPESA',
                amount: 0,
                currency: 'KES',
                phoneNumber: '254712345678'
            };

            const result = await processPayment(paymentData);

            expect(result.success).toBe(false);
            expect(result.error.code).toBe('INVALID_AMOUNT');
            expect(result.error.message).toBe('M-Pesa minimum amount is 1 KES');
        });

        it('should handle Stripe payment failure', async () => {
            const paymentData = {
                paymentMethodType: 'CARD',
                amount: 2500,
                currency: 'USD',
                paymentMethodId: 'pm_invalid'
            };

            createPaymentIntent.mockResolvedValue({
                success: false,
                error: {
                    code: 'card_declined',
                    message: 'Your card was declined.',
                    type: 'card_error'
                }
            });

            const result = await processPayment(paymentData);

            expect(result.success).toBe(false);
            expect(result.error.code).toBe('card_declined');
            expect(result.error.message).toBe('Your card was declined.');
        });
    });

    describe('createPaymentMethodForGateway', () => {
        it('should create Stripe payment method successfully', async () => {
            const paymentMethodData = {
                type: 'CARD',
                token: 'tok_1234567890',
                brand: 'VISA',
                last4: '4242',
                metadata: { user_id: 'user_123' },
                gateway: 'stripe'
            };

            createPaymentMethod.mockResolvedValue({
                success: true,
                paymentMethodId: 'pm_1234567890',
                gatewayResponse: {
                    payment_method_id: 'pm_1234567890',
                    type: 'card',
                    card: {
                        brand: 'VISA',
                        last4: '4242'
                    }
                }
            });

            const result = await createPaymentMethodForGateway(paymentMethodData);

            expect(result.success).toBe(true);
            expect(result.paymentMethodId).toBe('pm_1234567890');
            expect(createPaymentMethod).toHaveBeenCalledWith(paymentMethodData);
        });

        it('should create M-Pesa payment method (mock)', async () => {
            const paymentMethodData = {
                type: 'MPESA',
                phoneNumber: '254712345678',
                gateway: 'mpesa'
            };

            const result = await createPaymentMethodForGateway(paymentMethodData);

            expect(result.success).toBe(true);
            expect(result.paymentMethodId).toMatch(/^mpesa_/);
            expect(result.gatewayResponse.type).toBe('MPESA');
        });
    });

    describe('processRefundForGateway', () => {
        it('should process Stripe refund successfully', async () => {
            const refundData = {
                gateway: 'stripe',
                transactionId: 'pi_1234567890',
                amount: 1000,
                reason: 'Customer requested refund',
                metadata: { refund_id: 'refund_123' },
                idempotencyKey: 'refund_key_123'
            };

            processRefund.mockResolvedValue({
                success: true,
                refundId: 're_1234567890',
                status: 'SUCCEEDED',
                gatewayResponse: {
                    refund_id: 're_1234567890',
                    status: 'succeeded',
                    amount: 1000
                }
            });

            const result = await processRefundForGateway(refundData);

            expect(result.success).toBe(true);
            expect(result.refundId).toBe('re_1234567890');
            expect(result.status).toBe('SUCCEEDED');
            expect(processRefund).toHaveBeenCalledWith({
                paymentIntentId: 'pi_1234567890',
                amount: 1000,
                reason: 'Customer requested refund',
                metadata: { refund_id: 'refund_123' },
                idempotencyKey: 'refund_key_123'
            });
        });

        it('should process M-Pesa refund successfully', async () => {
            const refundData = {
                gateway: 'mpesa',
                transactionId: 'ws_CO_1234567890',
                amount: 500,
                phoneNumber: '254712345678',
                remarks: 'Customer requested refund',
                metadata: { refund_id: 'refund_456' },
                idempotencyKey: 'refund_key_456'
            };

            mpesaRefund.mockResolvedValue({
                success: true,
                refundId: 'ref_1234567890',
                status: 'PENDING',
                gatewayResponse: {
                    originator_conversation_id: 'ref_1234567890',
                    response_code: '0'
                }
            });

            const result = await processRefundForGateway(refundData);

            expect(result.success).toBe(true);
            expect(result.refundId).toBe('ref_1234567890');
            expect(result.status).toBe('PENDING');
            expect(mpesaRefund).toHaveBeenCalledWith({
                transactionId: 'ws_CO_1234567890',
                amount: 500,
                phoneNumber: '254712345678',
                remarks: 'Customer requested refund',
                metadata: { refund_id: 'refund_456' },
                idempotencyKey: 'refund_key_456'
            });
        });
    });
});
