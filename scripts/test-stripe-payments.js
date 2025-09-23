import 'dotenv/config';
import fetch from 'node-fetch';

const BASE_URL = 'https://nonoffensive-suasively-lorri.ngrok-free.dev';

// Stripe test payloads
const stripeTestCases = [
    {
        name: 'Stripe Visa Success',
        payload: {
            userId: '550e8400-e29b-41d4-a716-446655440000',
            orderId: 'stripe_visa_success_001',
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
                    id: 'stripe_visa_success_001',
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
        }
    },
    {
        name: 'Stripe Mastercard Success',
        payload: {
            userId: '550e8400-e29b-41d4-a716-446655440001',
            orderId: 'stripe_mastercard_success_001',
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
                    id: 'stripe_mastercard_success_001',
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
        }
    },
    {
        name: 'Stripe American Express Success',
        payload: {
            userId: '550e8400-e29b-41d4-a716-446655440002',
            orderId: 'stripe_amex_success_001',
            amount: 10000, // $100.00
            currency: 'USD',
            paymentMethod: {
                type: 'CARD',
                token: 'tok_amex',
                brand: 'AMERICAN_EXPRESS',
                last4: '0005'
            },
            metadata: {
                order: {
                    id: 'stripe_amex_success_001',
                    description: 'Enterprise plan purchase',
                    items: ['Enterprise Plan'],
                    totalItems: 1,
                    shippingAddress: 'Corporate Office'
                },
                user: {
                    id: '550e8400-e29b-41d4-a716-446655440002',
                    email: 'enterprise@example.com',
                    name: 'Corporate User',
                    phone: '+254712345680'
                },
                gateway: 'stripe',
                testMode: true
            }
        }
    },
    {
        name: 'Stripe Declined Payment',
        payload: {
            userId: '550e8400-e29b-41d4-a716-446655440003',
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
                    id: '550e8400-e29b-41d4-a716-446655440003',
                    email: 'declined@example.com',
                    name: 'Test User',
                    phone: '+254712345681'
                },
                gateway: 'stripe',
                testMode: true
            }
        }
    },
    {
        name: 'Stripe Insufficient Funds',
        payload: {
            userId: '550e8400-e29b-41d4-a716-446655440004',
            orderId: 'stripe_insufficient_001',
            amount: 2000, // $20.00
            currency: 'USD',
            paymentMethod: {
                type: 'CARD',
                token: 'tok_chargeDeclinedInsufficientFunds',
                brand: 'VISA',
                last4: '9995'
            },
            metadata: {
                order: {
                    id: 'stripe_insufficient_001',
                    description: 'Test insufficient funds',
                    items: ['Test Product'],
                    totalItems: 1,
                    shippingAddress: 'Test Address'
                },
                user: {
                    id: '550e8400-e29b-41d4-a716-446655440004',
                    email: 'insufficient@example.com',
                    name: 'Test User',
                    phone: '+254712345682'
                },
                gateway: 'stripe',
                testMode: true
            }
        }
    }
];

async function testStripePayments() {
    console.log('🧪 Testing Stripe Payments\n');

    for (const testCase of stripeTestCases) {
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
                console.log(`   Gateway: ${responseData.data?.gatewayResponse?.gateway || 'stripe'}`);
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
        
        // Wait 1 second between requests
        await new Promise(resolve => setTimeout(resolve, 1000));
    }
}

// Run the tests
testStripePayments().catch(console.error);
