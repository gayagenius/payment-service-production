import 'dotenv/config';
import fetch from 'node-fetch';

const BASE_URL = 'https://nonoffensive-suasively-lorri.ngrok-free.dev';

// M-Pesa test payloads
const mpesaTestCases = [
    {
        name: 'M-Pesa STK Push Success',
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
        }
    },
    {
        name: 'M-Pesa STK Push Higher Amount',
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
        }
    },
    {
        name: 'M-Pesa STK Push Small Amount',
        payload: {
            userId: '550e8400-e29b-41d4-a716-446655440102',
            orderId: 'mpesa_success_003',
            amount: 1000, // KES 10.00
            currency: 'KES',
            paymentMethod: {
                type: 'MPESA',
                phoneNumber: '254728287616'
            },
            metadata: {
                order: {
                    id: 'mpesa_success_003',
                    description: 'Small mobile payment',
                    items: ['Basic Plan'],
                    totalItems: 1,
                    shippingAddress: 'Mobile Delivery'
                },
                user: {
                    id: '550e8400-e29b-41d4-a716-446655440102',
                    email: 'basic@example.com',
                    name: 'Basic User',
                    phone: '254728287616'
                },
                gateway: 'mpesa',
                phoneNumber: '254728287616',
                testMode: true
            }
        }
    },
    {
        name: 'M-Pesa STK Push with Payment Method ID',
        payload: {
            userId: '550e8400-e29b-41d4-a716-446655440103',
            orderId: 'mpesa_success_004',
            amount: 7500, // KES 75.00
            currency: 'KES',
            paymentMethodId: '550e8400-e29b-41d4-a716-446655440000', // Existing payment method
            metadata: {
                order: {
                    id: 'mpesa_success_004',
                    description: 'Payment with existing method',
                    items: ['Standard Plan'],
                    totalItems: 1,
                    shippingAddress: 'Mobile Delivery'
                },
                user: {
                    id: '550e8400-e29b-41d4-a716-446655440103',
                    email: 'existing@example.com',
                    name: 'Existing User',
                    phone: '254728287616'
                },
                gateway: 'mpesa',
                phoneNumber: '254728287616',
                testMode: true
            }
        }
    }
];

async function testMpesaPayments() {
    console.log('🧪 Testing M-Pesa Payments\n');

    for (const testCase of mpesaTestCases) {
        console.log(`Testing: ${testCase.name}`);
        
        try {
            const response = await fetch(`${BASE_URL}/payments`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer test-token',
                    'X-Request-Id': `test-${Date.now()}`
                },
                body: JSON.stringify(testCase.payload)
            });

            const responseData = await response.json();
            
            console.log(`Status: ${response.status}`);
            
            if (response.status === 201) {
                console.log(`✅ SUCCESS - Payment ID: ${responseData.data?.id}`);
                console.log(`   Status: ${responseData.data?.status}`);
                console.log(`   Gateway: ${responseData.data?.gatewayResponse?.gateway || 'mpesa'}`);
                console.log(`   Phone: ${testCase.payload.metadata?.phoneNumber || testCase.payload.paymentMethod?.phoneNumber}`);
            } else if (response.status === 400) {
                console.log(`❌ EXPECTED FAILURE - ${responseData.error?.message || 'Payment failed'}`);
                console.log(`   Error Code: ${responseData.error?.code}`);
            } else {
                console.log(`❌ UNEXPECTED STATUS - ${response.status}`);
                console.log(`   Response: ${JSON.stringify(responseData, null, 2)}`);
            }
            
        } catch (error) {
            console.log(`❌ ERROR - ${error.message}`);
        }
        
        console.log(''); // Empty line for readability
        
        // Wait 2 seconds between M-Pesa requests (rate limiting)
        await new Promise(resolve => setTimeout(resolve, 2000));
    }
}

// Run the tests
testMpesaPayments().catch(console.error);
