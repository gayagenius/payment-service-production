import { describe, it, expect, beforeEach, vi } from 'vitest';
import { processPayment, createPaymentMethodForGateway, processRefundForGateway } from '../services/paymentProcessor.js';
import { initializePayment, processRefund } from '../gateways/paystack.js';

// Mock the gateway functions
vi.mock('../gateways/paystack.js', () => ({
    initializePayment: vi.fn(),
    verifyPayment: vi.fn(),
    processRefund: vi.fn(),
    getSupportedPaymentMethods: vi.fn(() => [
        { type: 'CARD', name: 'Credit/Debit Card' },
        { type: 'BANK_TRANSFER', name: 'Bank Transfer' }
    ]),
    getSupportedCurrencies: vi.fn(() => [
        { code: 'NGN', name: 'Nigerian Naira' },
        { code: 'USD', name: 'US Dollar' },
        { code: 'KES', name: 'Kenyan Shilling' }
    ])
}));

describe('Payment Processing', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('processPayment', () => {
        it('should process Paystack payment successfully', async () => {
            const paymentData = {
                userId: 'user_123',
                orderId: 'order_123',
                amount: 2500,
                currency: 'USD',
                metadata: { order_id: 'order_123' },
                idempotencyKey: 'test_key_123'
            };

            initializePayment.mockResolvedValue({
                success: true,
                transactionId: 'ref_1234567890',
                status: 'PENDING',
                gatewayResponse: {
                    reference: 'ref_1234567890',
                    access_code: 'access_code_123',
                    authorization_url: 'https://checkout.paystack.com/access_code_123'
                }
            });

            const result = await processPayment(paymentData);

            expect(result.success).toBe(true);
            expect(result.transactionId).toBe('ref_1234567890');
            expect(result.status).toBe('PENDING');
            expect(result.gateway).toBe('paystack');
            expect(initializePayment).toHaveBeenCalledWith({
                amount: 2500,
                currency: 'USD',
                email: 'user_123@example.com',
                reference: 'test_key_123',
                customer: {
                    first_name: 'Customer',
                    last_name: '',
                    email: 'user_123@example.com',
                    phone: '',
                    user_id: 'user_123',
                    metadata: {
                        user_id: 'user_123',
                        order_id: 'order_123'
                    }
                },
                metadata: {
                    user_id: 'user_123',
                    order_id: 'order_123',
                    payment_id: undefined
                },
                callback_url: '//payments/return'
            });
        });

        it('should process KES payment successfully', async () => {
            const paymentData = {
                userId: 'user_456',
                orderId: 'order_456',
                amount: 1000,
                currency: 'KES',
                metadata: { order_id: 'order_456' },
                idempotencyKey: 'test_key_456'
            };

            initializePayment.mockResolvedValue({
                success: true,
                transactionId: 'ref_4567890123',
                status: 'PENDING',
                gatewayResponse: {
                    reference: 'ref_4567890123',
                    access_code: 'access_code_456',
                    authorization_url: 'https://checkout.paystack.com/access_code_456'
                }
            });

            const result = await processPayment(paymentData);

            expect(result.success).toBe(true);
            expect(result.transactionId).toBe('ref_4567890123');
            expect(result.status).toBe('PENDING');
            expect(result.gateway).toBe('paystack');
            expect(initializePayment).toHaveBeenCalledWith({
                amount: 1000,
                currency: 'KES',
                email: 'user_456@example.com',
                reference: 'test_key_456',
                customer: {
                    first_name: 'Customer',
                    last_name: '',
                    email: 'user_456@example.com',
                    phone: '',
                    user_id: 'user_456',
                    metadata: {
                        user_id: 'user_456',
                        order_id: 'order_456'
                    }
                },
                metadata: {
                    user_id: 'user_456',
                    order_id: 'order_456',
                    payment_id: undefined
                },
                callback_url: '//payments/return'
            });
        });

        it('should reject payment with unsupported currency', async () => {
            const paymentData = {
                userId: 'user_123',
                orderId: 'order_123',
                amount: 1000,
                currency: 'INVALID_CURRENCY'
            };

            const result = await processPayment(paymentData);

            expect(result.success).toBe(false);
            expect(result.error.code).toBe('INVALID_CURRENCY');
            expect(result.error.message).toBe('Currency not supported');
        });

        it('should reject payment with amount below minimum', async () => {
            const paymentData = {
                userId: 'user_123',
                orderId: 'order_123',
                amount: 0.5,
                currency: 'USD'
            };

            const result = await processPayment(paymentData);

            expect(result.success).toBe(false);
            expect(result.error.code).toBe('INVALID_AMOUNT');
            expect(result.error.message).toBe('Amount must be at least 1');
        });

        it('should handle Paystack payment failure', async () => {
            const paymentData = {
                userId: 'user_123',
                orderId: 'order_123',
                amount: 2500,
                currency: 'USD'
            };

            initializePayment.mockResolvedValue({
                success: false,
                error: {
                    code: 'PAYSTACK_ERROR',
                    message: 'Payment initialization failed',
                    type: 'payment_error'
                }
            });

            const result = await processPayment(paymentData);

            expect(result.success).toBe(false);
            expect(result.error.code).toBe('PAYSTACK_ERROR');
            expect(result.error.message).toBe('Payment initialization failed');
        });
    });

    describe('createPaymentMethodForGateway', () => {
        it('should create payment method successfully', async () => {
            const paymentMethodData = {
                type: 'CARD',
                gateway: 'paystack'
            };

            const result = await createPaymentMethodForGateway(paymentMethodData);

            expect(result.success).toBe(true);
            expect(result.paymentMethodId).toMatch(/^pm_/);
            expect(result.gatewayResponse.type).toBe('CARD');
            expect(result.gatewayResponse.gateway).toBe('paystack');
        });

        it('should create payment method for any gateway', async () => {
            const paymentMethodData = {
                type: 'BANK_TRANSFER',
                gateway: 'paystack'
            };

            const result = await createPaymentMethodForGateway(paymentMethodData);

            expect(result.success).toBe(true);
            expect(result.paymentMethodId).toMatch(/^pm_/);
            expect(result.gatewayResponse.type).toBe('BANK_TRANSFER');
        });
    });

    describe('processRefundForGateway', () => {
        it('should process Paystack refund successfully', async () => {
            const refundData = {
                transactionId: 'ref_1234567890',
                amount: 1000,
                reason: 'Customer requested refund'
            };

            processRefund.mockResolvedValue({
                success: true,
                refundId: 'refund_1234567890',
                status: 'SUCCEEDED',
                gatewayResponse: {
                    refund_id: 'refund_1234567890',
                    transaction_id: 'ref_1234567890',
                    amount: 1000,
                    currency: 'USD',
                    status: 'success',
                    created_at: '2023-01-01T00:00:00Z'
                }
            });

            const result = await processRefundForGateway(refundData);

            expect(result.success).toBe(true);
            expect(result.refundId).toBe('refund_1234567890');
            expect(result.status).toBe('SUCCEEDED');
            expect(processRefund).toHaveBeenCalledWith({
                transactionId: 'ref_1234567890',
                amount: 1000,
                reason: 'Customer requested refund'
            });
        });

        it('should handle refund failure', async () => {
            const refundData = {
                transactionId: 'ref_invalid',
                amount: 1000,
                reason: 'Customer requested refund'
            };

            processRefund.mockResolvedValue({
                success: false,
                error: {
                    code: 'PAYSTACK_ERROR',
                    message: 'Refund failed',
                    type: 'refund_error'
                }
            });

            const result = await processRefundForGateway(refundData);

            expect(result.success).toBe(false);
            expect(result.error.code).toBe('PAYSTACK_ERROR');
            expect(result.error.message).toBe('Refund failed');
        });
    });
});
