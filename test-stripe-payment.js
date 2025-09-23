#!/usr/bin/env node

import 'dotenv/config';
import axios from 'axios';

const BASE_URL = 'http://localhost:8888';
const API_KEY = 'test-api-key-for-development';

// Test data
const testUser = {
    id: '550e8400-e29b-41d4-a716-446655440000',
    email: 'test@example.com',
    name: 'Test User'
};

const testOrder = {
    id: 'stripe_test_order_' + Date.now(),
    description: 'Stripe Test Order',
    items: ['Test Item 1', 'Test Item 2'],
    totalItems: 2,
    shippingAddress: 'New York, NY'
};

// Helper function to make API requests
const apiRequest = async (method, endpoint, data = null) => {
    try {
        const config = {
            method,
            url: `${BASE_URL}${endpoint}`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${API_KEY}`,
                'X-Request-Id': `test_${Date.now()}`
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

// Test Stripe payment
const testStripePayment = async () => {
    console.log('🧪 Testing Stripe Payment Integration...\n');

    const paymentData = {
        user_id: testUser.id,
        order_id: testOrder.id,
        amount: 2500, // $25.00 in cents
        currency: 'USD',
        paymentMethod: {
            type: 'CARD',
            token: 'tok_visa', // Stripe test token
            brand: 'VISA',
            last4: '4242'
        },
        metadata: {
            order: testOrder,
            user: testUser
        }
    };

    console.log('📤 Sending payment request...');
    console.log('Payment Data:', JSON.stringify(paymentData, null, 2));

    const result = await apiRequest('POST', '/payments', paymentData);

    if (result.success) {
        console.log('✅ Payment request successful!');
        console.log('Response:', JSON.stringify(result.data, null, 2));
        
        if (result.data.data && result.data.data.id) {
            console.log(`\n🔍 Payment ID: ${result.data.data.id}`);
            console.log(`💰 Amount: $${(result.data.data.amount / 100).toFixed(2)} ${result.data.data.currency}`);
            console.log(`📊 Status: ${result.data.data.status}`);
            
            // Test getting the payment
            console.log('\n🔍 Testing payment retrieval...');
            const getResult = await apiRequest('GET', `/payments/${result.data.data.id}`);
            
            if (getResult.success) {
                console.log('✅ Payment retrieval successful!');
                console.log('Payment Details:', JSON.stringify(getResult.data.data, null, 2));
            } else {
                console.log('❌ Payment retrieval failed:', getResult.error);
            }
        }
    } else {
        console.log('❌ Payment request failed!');
        console.log('Error:', JSON.stringify(result.error, null, 2));
        console.log('Status:', result.status);
    }

    return result;
};

// Test payment method types
const testPaymentTypes = async () => {
    console.log('\n🧪 Testing Payment Method Types...\n');
    
    const result = await apiRequest('GET', '/payment/types');
    
    if (result.success) {
        console.log('✅ Payment types retrieved successfully!');
        console.log('Available Payment Types:', JSON.stringify(result.data.data, null, 2));
    } else {
        console.log('❌ Payment types retrieval failed:', result.error);
    }
    
    return result;
};

// Test user payments list
const testUserPayments = async () => {
    console.log('\n🧪 Testing User Payments List...\n');
    
    const result = await apiRequest('GET', `/payments/user/${testUser.id}`);
    
    if (result.success) {
        console.log('✅ User payments retrieved successfully!');
        console.log('User Payments:', JSON.stringify(result.data.data, null, 2));
    } else {
        console.log('❌ User payments retrieval failed:', result.error);
    }
    
    return result;
};

// Main test execution
const runStripeTests = async () => {
    console.log('🚀 Starting Stripe Payment Integration Tests');
    console.log(`📍 Testing against: ${BASE_URL}`);
    console.log('=' .repeat(60));

    let testResults = {
        passed: 0,
        failed: 0,
        tests: []
    };

    // Test payment method types
    const typesResult = await testPaymentTypes();
    if (typesResult.success) {
        testResults.passed++;
        testResults.tests.push({ name: 'Payment Types', status: 'PASSED' });
    } else {
        testResults.failed++;
        testResults.tests.push({ name: 'Payment Types', status: 'FAILED', error: typesResult.error });
    }

    // Test Stripe payment
    const paymentResult = await testStripePayment();
    if (paymentResult.success) {
        testResults.passed++;
        testResults.tests.push({ name: 'Stripe Payment', status: 'PASSED' });
    } else {
        testResults.failed++;
        testResults.tests.push({ name: 'Stripe Payment', status: 'FAILED', error: paymentResult.error });
    }

    // Test user payments
    const userPaymentsResult = await testUserPayments();
    if (userPaymentsResult.success) {
        testResults.passed++;
        testResults.tests.push({ name: 'User Payments', status: 'PASSED' });
    } else {
        testResults.failed++;
        testResults.tests.push({ name: 'User Payments', status: 'FAILED', error: userPaymentsResult.error });
    }

    // Print summary
    console.log('\n' + '=' .repeat(60));
    console.log('📊 Stripe Integration Test Summary');
    console.log('=' .repeat(60));
    console.log(`✅ Passed: ${testResults.passed}`);
    console.log(`❌ Failed: ${testResults.failed}`);
    console.log(`📈 Success Rate: ${((testResults.passed / (testResults.passed + testResults.failed)) * 100).toFixed(1)}%`);

    if (testResults.failed > 0) {
        console.log('\n❌ Failed Tests:');
        testResults.tests
            .filter(test => test.status === 'FAILED')
            .forEach(test => {
                console.log(`   - ${test.name}: ${JSON.stringify(test.error, null, 2)}`);
            });
    }

    console.log('\n🎯 Next Steps:');
    console.log('1. Check the payment in your Stripe Dashboard');
    console.log('2. Test webhook handling (set up webhook endpoint)');
    console.log('3. Test refund functionality');
    console.log('4. Test error scenarios');

    process.exit(testResults.failed > 0 ? 1 : 0);
};

// Run the tests
runStripeTests().catch(error => {
    console.error('💥 Stripe Test Error:', error);
    process.exit(1);
});
