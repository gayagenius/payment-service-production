import { describe, it, expect, beforeEach, vi } from 'vitest';
import { initializePayment, verifyPayment, processRefund, verifyWebhook, handleWebhook } from '../gateways/paystack.js';

// Mock node-fetch for Paystack
vi.mock('node-fetch', () => ({
    default: vi.fn()
}));

describe('Paystack Gateway', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('initializePayment', () => {
        it('should initialize payment successfully', async () => {
            const paymentData = {
                amount: 2500,
                currency: 'USD',
                email: 'test@example.com',
                reference: 'ref_1234567890',
                metadata: { order_id: 'order_123' },
                callback_url: 'http://localhost:8888/payments/return'
            };

            const mockResponse = {
                ok: true,
                json: vi.fn().mockResolvedValue({
                    status: true,
                    message: 'Authorization URL created',
                    data: {
                        reference: 'ref_1234567890',
                        access_code: 'access_code_123',
                        authorization_url: 'https://checkout.paystack.com/access_code_123'
                    }
                })
            };

            const fetch = await import('node-fetch');
            fetch.default.mockResolvedValue(mockResponse);

            const result = await initializePayment(paymentData);

            expect(result.success).toBe(true);
            expect(result.transactionId).toBe('ref_1234567890');
            expect(result.status).toBe('PENDING');
            expect(result.gatewayResponse.reference).toBe('ref_1234567890');
        });

        it('should handle payment initialization failure', async () => {
            const paymentData = {
                amount: 2500,
                currency: 'USD',
                email: 'test@example.com',
                reference: 'ref_invalid'
            };

            const mockResponse = {
                ok: false,
                json: vi.fn().mockResolvedValue({
                    status: false,
                    message: 'Invalid reference'
                })
            };

            const fetch = await import('node-fetch');
            fetch.default.mockResolvedValue(mockResponse);

            const result = await initializePayment(paymentData);

            expect(result.success).toBe(false);
            expect(result.error.code).toBe('PAYSTACK_ERROR');
            expect(result.error.message).toBe('Invalid reference');
        });
    });

    describe('verifyPayment', () => {
        it('should verify payment successfully', async () => {
            const reference = 'ref_1234567890';

            const mockResponse = {
                ok: true,
                json: vi.fn().mockResolvedValue({
                    status: true,
                    data: {
                        reference: 'ref_1234567890',
                        status: 'success',
                        amount: 2500,
                        currency: 'USD',
                        customer: { email: 'test@example.com' },
                        authorization: { authorization_code: 'auth_123' },
                        channel: 'card',
                        paid_at: '2023-01-01T00:00:00Z',
                        created_at: '2023-01-01T00:00:00Z'
                    }
                })
            };

            const fetch = await import('node-fetch');
            fetch.default.mockResolvedValue(mockResponse);

            const result = await verifyPayment(reference);

            expect(result.success).toBe(true);
            expect(result.transactionId).toBe('ref_1234567890');
            expect(result.status).toBe('SUCCEEDED');
            expect(result.gatewayResponse.reference).toBe('ref_1234567890');
        });
    });

    describe('processRefund', () => {
        it('should process refund successfully', async () => {
            const refundData = {
                transactionId: 'ref_1234567890',
                amount: 1000,
                reason: 'Customer requested refund'
            };

            const mockResponse = {
                ok: true,
                json: vi.fn().mockResolvedValue({
                    status: true,
                    data: {
                        id: 'refund_1234567890',
                        status: 'success',
                        amount: 1000,
                        currency: 'USD',
                        transaction: { id: 'ref_1234567890' },
                        created_at: '2023-01-01T00:00:00Z'
                    }
                })
            };

            const fetch = await import('node-fetch');
            fetch.default.mockResolvedValue(mockResponse);

            const result = await processRefund(refundData);

            expect(result.success).toBe(true);
            expect(result.refundId).toBe('refund_1234567890');
            expect(result.status).toBe('SUCCEEDED');
        });
    });
});

describe('Webhook Handling', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('verifyWebhook', () => {
        it('should verify webhook signature correctly', () => {
            const payload = '{"event":"charge.success","data":{"reference":"ref_123"}}';
            const signature = 'test_signature';
            
            // Mock crypto module
            const crypto = require('crypto');
            vi.spyOn(crypto, 'createHmac').mockReturnValue({
                update: vi.fn().mockReturnThis(),
                digest: vi.fn().mockReturnValue('test_signature')
            });

            const result = verifyWebhook(payload, signature);
            expect(result).toBe(true);
        });
    });

    describe('handleWebhook', () => {
        it('should handle charge.success event', async () => {
            const event = {
                event: 'charge.success',
                data: {
                    reference: 'ref_1234567890',
                    amount: 2500,
                    currency: 'USD'
                }
            };

            const result = await handleWebhook(event);

            expect(result.success).toBe(true);
            expect(result.transactionId).toBe('ref_1234567890');
            expect(result.status).toBe('SUCCEEDED');
        });

        it('should handle charge.failed event', async () => {
            const event = {
                event: 'charge.failed',
                data: {
                    reference: 'ref_1234567890',
                    amount: 2500,
                    currency: 'USD'
                }
            };

            const result = await handleWebhook(event);

            expect(result.success).toBe(true);
            expect(result.transactionId).toBe('ref_1234567890');
            expect(result.status).toBe('FAILED');
        });

        it('should handle refund.processed event', async () => {
            const event = {
                event: 'refund.processed',
                data: {
                    id: 'refund_1234567890',
                    transaction: { reference: 'ref_1234567890' },
                    amount: 1000
                }
            };

            const result = await handleWebhook(event);

            expect(result.success).toBe(true);
            expect(result.refundId).toBe('refund_1234567890');
            expect(result.status).toBe('SUCCEEDED');
        });

        it('should handle unknown event', async () => {
            const event = {
                event: 'unknown.event',
                data: {}
            };

            const result = await handleWebhook(event);

            expect(result.success).toBe(false);
            expect(result.error.code).toBe('UNKNOWN_EVENT');
        });
    });
});
