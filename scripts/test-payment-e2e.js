#!/usr/bin/env node

import 'dotenv/config';
import axios from 'axios';

const BASE_URL = process.env.API_BASE_URL || 'http://localhost:8888';
const API_KEY = process.env.API_KEY || 'test-api-key';

// Test data
const testUser = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    email: 'test@example.com',
    name: 'Test User',
    phone: '+254712345678'
};

const testOrder = {
    id: 'order_e2e_test_' + Date.now(),
    description: 'E2E Test Order',
    items: ['Test Item 1', 'Test Item 2'],
    totalItems: 2,
    shippingAddress: 'Nairobi, Kenya'
};

let testResults = {
    passed: 0,
    failed: 0,
    tests: []
};

// Helper function to make API requests
const apiRequest = async (method, endpoint, data = null, headers = {}) => {
    try {
        const config = {
            method,
            url: `${BASE_URL}${endpoint}`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
                'X-Request-Id': `test_${Date.now()}`,
                ...headers
            }
        };

        if (data) {
            config.data = data;
        }

        const response = await axios(config);
        return { success: true, data: response.data, status: response.status };
    } catch (error) {
        return {
            success: false,
            error: error.response?.data || error.message,
            status: error.response?.status || 500
        };
    }
};

// Test helper
const runTest = async (testName, testFunction) => {
    console.log(`\n🧪 Running: ${testName}`);
    try {
        const result = await testFunction();
        if (result.success) {
            console.log(`✅ PASSED: ${testName}`);
            testResults.passed++;
            testResults.tests.push({ name: testName, status: 'PASSED', result });
        } else {
            console.log(`❌ FAILED: ${testName}`);
            console.log(`   Error: ${JSON.stringify(result.error, null, 2)}`);
            testResults.failed++;
            testResults.tests.push({ name: testName, status: 'FAILED', error: result.error });
        }
    } catch (error) {
        console.log(`❌ FAILED: ${testName} - ${error.message}`);
        testResults.failed++;
        testResults.tests.push({ name: testName, status: 'FAILED', error: error.message });
    }
};

// Test cases
const testHealthCheck = async () => {
    const result = await apiRequest('GET', '/');
    return {
        success: result.success && result.data.status === 'ok',
        data: result.data
    };
};

const testStripePayment = async () => {
    const paymentData = {
        user_id: testUser.id,
        order_id: testOrder.id,
        amount: 2500, // $25.00
        currency: 'USD',
        paymentMethod: {
            type: 'CARD',
            token: 'tok_visa',
            brand: 'VISA',
            last4: '4242'
        },
        metadata: {
            order: testOrder,
            user: testUser
        }
    };

    const result = await apiRequest('POST', '/payments', paymentData);
    return {
        success: result.success && result.data.success,
        data: result.data,
        payment_id: result.data.data?.id
    };
};

const testMpesaPayment = async () => {
    const paymentData = {
        user_id: testUser.id,
        order_id: testOrder.id + '_mpesa',
        amount: 1000, // 10.00 KES
        currency: 'KES',
        paymentMethod: {
            type: 'MPESA',
            phoneNumber: '254712345678'
        },
        metadata: {
            order: { ...testOrder, id: testOrder.id + '_mpesa' },
            user: testUser,
            phoneNumber: '254712345678',
            description: 'M-Pesa Test Payment'
        }
    };

    const result = await apiRequest('POST', '/payments', paymentData);
    return {
        success: result.success && result.data.success,
        data: result.data,
        payment_id: result.data.data?.id
    };
};

const testGetPayment = async (payment_id) => {
    if (!payment_id) {
        return { success: false, error: 'No payment ID provided' };
    }

    const result = await apiRequest('GET', `/payments/${payment_id}`);
    return {
        success: result.success && result.data.success,
        data: result.data
    };
};

const testCreateRefund = async (payment_id) => {
    if (!payment_id) {
        return { success: false, error: 'No payment ID provided' };
    }

    const refundData = {
        payment_id: payment_id,
        amount: 1000, // Partial refund
        reason: 'E2E Test Refund',
        metadata: {
            test: true,
            refund_type: 'partial'
        }
    };

    const result = await apiRequest('POST', '/refunds', refundData);
    return {
        success: result.success && result.data.success,
        data: result.data,
        refundId: result.data.data?.id
    };
};

const testGetRefund = async (refundId) => {
    if (!refundId) {
        return { success: false, error: 'No refund ID provided' };
    }

    const result = await apiRequest('GET', `/refunds/${refundId}`);
    return {
        success: result.success && result.data.success,
        data: result.data
    };
};

const testPaymentHistory = async (payment_id) => {
    if (!payment_id) {
        return { success: false, error: 'No payment ID provided' };
    }

    const result = await apiRequest('GET', `/payment-history/${payment_id}`);
    return {
        success: result.success && result.data.success,
        data: result.data
    };
};

const testUserPayments = async () => {
    const result = await apiRequest('GET', `/payments/user/${testUser.id}`);
    return {
        success: result.success && result.data.success,
        data: result.data
    };
};

const testWebhookHealth = async () => {
    const result = await apiRequest('GET', '/webhooks/health');
    return {
        success: result.success && result.data.success,
        data: result.data
    };
};

// Main test execution
const runE2ETests = async () => {
    console.log('🚀 Starting Payment Service E2E Tests');
    console.log(`📍 Testing against: ${BASE_URL}`);
    console.log('=' .repeat(50));

    let stripePaymentId = null;
    let mpesaPaymentId = null;
    let refundId = null;

    // Basic health check
    await runTest('Health Check', testHealthCheck);

    // Webhook health check
    await runTest('Webhook Health Check', testWebhookHealth);

    // Test Stripe payment
    const stripeResult = await runTest('Stripe Payment Creation', testStripePayment);
    if (stripeResult && stripeResult.data && stripeResult.data.payment_id) {
        stripePaymentId = stripeResult.data.payment_id;
    }

    // Test M-Pesa payment
    const mpesaResult = await runTest('M-Pesa Payment Creation', testMpesaPayment);
    if (mpesaResult && mpesaResult.data && mpesaResult.data.payment_id) {
        mpesaPaymentId = mpesaResult.data.payment_id;
    }

    // Test getting payments
    if (stripePaymentId) {
        await runTest('Get Stripe Payment', () => testGetPayment(stripePaymentId));
    }

    if (mpesaPaymentId) {
        await runTest('Get M-Pesa Payment', () => testGetPayment(mpesaPaymentId));
    }

    // Test payment history
    if (stripePaymentId) {
        await runTest('Payment History', () => testPaymentHistory(stripePaymentId));
    }

    // Test user payments
    await runTest('User Payments List', testUserPayments);

    // Test refund creation
    if (stripePaymentId) {
        const refundResult = await runTest('Create Refund', () => testCreateRefund(stripePaymentId));
        if (refundResult && refundResult.data && refundResult.data.refundId) {
            refundId = refundResult.data.refundId;
        }
    }

    // Test getting refund
    if (refundId) {
        await runTest('Get Refund', () => testGetRefund(refundId));
    }

    // Test refunds list
    await runTest('Refunds List', async () => {
        const result = await apiRequest('GET', '/refunds');
        return {
            success: result.success && result.data.success,
            data: result.data
        };
    });

    // Test payments list
    await runTest('Payments List', async () => {
        const result = await apiRequest('GET', '/payments');
        return {
            success: result.success && result.data.success,
            data: result.data
        };
    });

    // Test payment method types
    await runTest('Payment Method Types', async () => {
        const result = await apiRequest('GET', '/payment/types');
        return {
            success: result.success && result.data.success,
            data: result.data
        };
    });

    // Test error handling
    await runTest('Invalid Payment ID', async () => {
        const result = await apiRequest('GET', '/payments/invalid-uuid');
        return {
            success: result.status === 400, // Should return 400 for invalid UUID
            data: result.data
        };
    });

    await runTest('Non-existent Payment', async () => {
        const result = await apiRequest('GET', '/payments/550e8400-e29b-41d4-a716-446655440999');
        return {
            success: result.status === 404, // Should return 404 for non-existent payment
            data: result.data
        };
    });

    // Print summary
    console.log('\n' + '=' .repeat(50));
    console.log('📊 E2E Test Summary');
    console.log('=' .repeat(50));
    console.log(`✅ Passed: ${testResults.passed}`);
    console.log(`❌ Failed: ${testResults.failed}`);
    console.log(`📈 Success Rate: ${((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(1)}%`);

    if (testResults.failed > 0) {
        console.log('\n❌ Failed Tests:');
        testResults.tests
            .filter(test => test.status === 'FAILED')
            .forEach(test => {
                console.log(`   - ${test.name}: ${test.error}`);
            });
    }

    console.log('\n🎯 Test IDs for manual verification:');
    if (stripePaymentId) console.log(`   Stripe Payment: ${stripePaymentId}`);
    if (mpesaPaymentId) console.log(`   M-Pesa Payment: ${mpesaPaymentId}`);
    if (refundId) console.log(`   Refund: ${refundId}`);

    // Exit with appropriate code
    process.exit(testResults.failed > 0 ? 1 : 0);
};

// Handle command line arguments
const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Payment Service E2E Test Runner

Usage: node scripts/test-payment-e2e.js [options]

Options:
  --help, -h     Show this help message
  --url <url>    Override API base URL (default: http://localhost:8888)
  --key <key>    Override API key (default: test-api-key)

Environment Variables:
  API_BASE_URL   API base URL
  API_KEY        API authentication key

Examples:
  node scripts/test-payment-e2e.js
  node scripts/test-payment-e2e.js --url http://localhost:3000
  API_BASE_URL=https://api.example.com node scripts/test-payment-e2e.js
`);
    process.exit(0);
}

// Override URL if provided
if (args.includes('--url')) {
    const urlIndex = args.indexOf('--url');
    if (urlIndex + 1 < args.length) {
        process.env.API_BASE_URL = args[urlIndex + 1];
    }
}

// Override API key if provided
if (args.includes('--key')) {
    const keyIndex = args.indexOf('--key');
    if (keyIndex + 1 < args.length) {
        process.env.API_KEY = args[keyIndex + 1];
    }
}

// Run the tests
runE2ETests().catch(error => {
    console.error('💥 E2E Test Runner Error:', error);
    process.exit(1);
});
