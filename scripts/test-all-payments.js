import 'dotenv/config';
import fetch from 'node-fetch';

const BASE_URL = 'https://nonoffensive-suasively-lorri.ngrok-free.dev';

// Comprehensive test cases for both Stripe and M-Pesa
const testCases = [
    // Stripe Tests
    {
        name: 'Stripe Visa Success',
        gateway: 'stripe',
        payload: {
            userId: '550e8400-e29b-41d4-a716-446655440000',
            orderId: 'stripe_visa_001',
            amount: 2500, // $25.00
            currency: 'USD',
            paymentMethod: {
                type: 'CARD',
                token: 'tok_visa',
                brand: 'VISA',
                last4: '4242'
            },
            metadata: {
                order: {
                    id: 'stripe_visa_001',
                    description: 'Premium subscription purchase',
                    items: ['Premium Plan', 'Extra Storage'],
                    totalItems: 2,
                    shippingAddress: 'Nairobi, Kenya'
                },
                user: {
                    id: '550e8400-e29b-41d4-a716-446655440000',
                    email: 'user@example.com',
                    name: 'John Doe',
                    phone: '+254712345678'
                },
                gateway: 'stripe',
                testMode: true
            }
        },
        expectedStatus: 201
    },
    {
        name: 'Stripe Mastercard Success',
        gateway: 'stripe',
        payload: {
            userId: '550e8400-e29b-41d4-a716-446655440001',
            orderId: 'stripe_mastercard_001',
            amount: 5000, // $50.00
            currency: 'USD',
            paymentMethod: {
                type: 'CARD',
                token: 'tok_mastercard',
                brand: 'MASTERCARD',
                last4: '4444'
            },
            metadata: {
                order: {
                    id: 'stripe_mastercard_001',
                    description: 'Digital product purchase',
                    items: ['E-book', 'Video Course'],
                    totalItems: 2,
                    shippingAddress: 'Digital Delivery'
                },
                user: {
                    id: '550e8400-e29b-41d4-a716-446655440001',
                    email: 'mastercard@example.com',
                    name: 'Jane Smith',
                    phone: '+254712345679'
                },
                gateway: 'stripe',
                testMode: true
            }
        },
        expectedStatus: 201
    },
    {
        name: 'Stripe Declined Payment',
        gateway: 'stripe',
        payload: {
            userId: '550e8400-e29b-41d4-a716-446655440002',
            orderId: 'stripe_declined_001',
            amount: 1500, // $15.00
            currency: 'USD',
            paymentMethod: {
                type: 'CARD',
                token: 'tok_chargeDeclined',
                brand: 'VISA',
                last4: '0002'
            },
            metadata: {
                order: {
                    id: 'stripe_declined_001',
                    description: 'Test declined payment',
                    items: ['Test Product'],
                    totalItems: 1,
                    shippingAddress: 'Test Address'
                },
                user: {
                    id: '550e8400-e29b-41d4-a716-446655440002',
                    email: 'declined@example.com',
                    name: 'Test User',
                    phone: '+254712345680'
                },
                gateway: 'stripe',
                testMode: true
            }
        },
        expectedStatus: 400 // Expected to fail
    },
    // M-Pesa Tests
    {
        name: 'M-Pesa STK Push Success',
        gateway: 'mpesa',
        payload: {
            userId: '550e8400-e29b-41d4-a716-446655440100',
            orderId: 'mpesa_success_001',
            amount: 5000, // KES 50.00
            currency: 'KES',
            paymentMethod: {
                type: 'MPESA',
                phoneNumber: '254728287616'
            },
            metadata: {
                order: {
                    id: 'mpesa_success_001',
                    description: 'Mobile money payment',
                    items: ['Digital Product'],
                    totalItems: 1,
                    shippingAddress: 'Digital Delivery'
                },
                user: {
                    id: '550e8400-e29b-41d4-a716-446655440100',
                    email: 'mpesa@example.com',
                    name: 'M-Pesa User',
                    phone: '254728287616'
                },
                gateway: 'mpesa',
                phoneNumber: '254728287616',
                testMode: true
            }
        },
        expectedStatus: 201
    },
    {
        name: 'M-Pesa STK Push Higher Amount',
        gateway: 'mpesa',
        payload: {
            userId: '550e8400-e29b-41d4-a716-446655440101',
            orderId: 'mpesa_success_002',
            amount: 15000, // KES 150.00
            currency: 'KES',
            paymentMethod: {
                type: 'MPESA',
                phoneNumber: '254728287616'
            },
            metadata: {
                order: {
                    id: 'mpesa_success_002',
                    description: 'Premium mobile payment',
                    items: ['Premium Plan', 'Mobile Access'],
                    totalItems: 2,
                    shippingAddress: 'Mobile Delivery'
                },
                user: {
                    id: '550e8400-e29b-41d4-a716-446655440101',
                    email: 'premium@example.com',
                    name: 'Premium User',
                    phone: '254728287616'
                },
                gateway: 'mpesa',
                phoneNumber: '254728287616',
                testMode: true
            }
        },
        expectedStatus: 201
    }
];

async function testAllPayments() {
    console.log('🧪 Testing All Payment Gateways\n');
    console.log(`Base URL: ${BASE_URL}\n`);

    let successCount = 0;
    let failureCount = 0;

    for (const testCase of testCases) {
        console.log(`Testing: ${testCase.name} (${testCase.gateway.toUpperCase()})`);
        
        try {
            const response = await fetch(`${BASE_URL}/payments`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer test-token',
                    'X-Request-Id': `test-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
                },
                body: JSON.stringify(testCase.payload)
            });

            const responseData = await response.json();
            
            console.log(`Status: ${response.status} (Expected: ${testCase.expectedStatus})`);
            
            if (response.status === testCase.expectedStatus) {
                console.log(`✅ PASS`);
                successCount++;
                
                if (response.status === 201) {
                    console.log(`   Payment ID: ${responseData.data?.id}`);
                    console.log(`   Status: ${responseData.data?.status}`);
                    console.log(`   Gateway: ${responseData.data?.gatewayResponse?.gateway || testCase.gateway}`);
                    
                    if (testCase.gateway === 'mpesa') {
                        console.log(`   Phone: ${testCase.payload.metadata?.phoneNumber || testCase.payload.paymentMethod?.phoneNumber}`);
                    }
                } else if (response.status === 400) {
                    console.log(`   Error: ${responseData.error?.message || 'Payment failed'}`);
                    console.log(`   Error Code: ${responseData.error?.code}`);
                }
            } else {
                console.log(`❌ FAIL - Expected ${testCase.expectedStatus}, got ${response.status}`);
                failureCount++;
                console.log(`   Response: ${JSON.stringify(responseData, null, 2)}`);
            }
            
        } catch (error) {
            console.log(`❌ ERROR - ${error.message}`);
            failureCount++;
        }
        
        console.log(''); // Empty line for readability
        
        // Wait between requests (longer for M-Pesa)
        const waitTime = testCase.gateway === 'mpesa' ? 2000 : 1000;
        await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    console.log('📊 Test Summary:');
    console.log(`✅ Successful: ${successCount}`);
    console.log(`❌ Failed: ${failureCount}`);
    console.log(`📈 Success Rate: ${((successCount / testCases.length) * 100).toFixed(1)}%`);
}

// Run the tests
testAllPayments().catch(console.error);
