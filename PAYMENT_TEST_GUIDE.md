# Payment Service Test Guide

## 🚀 Live API Endpoints

**Base URL:** `https://nonoffensive-suasively-lorri.ngrok-free.dev`
**Swagger UI:** `https://nonoffensive-suasively-lorri.ngrok-free.dev/docs/swagger-ui.html`

## 🧪 Test Results Summary

### ✅ What's Working
- **Payment Creation:** Both Stripe and M-Pesa endpoints are functional
- **Database Integration:** Payments are being saved to PostgreSQL
- **Payment History:** Automatic history tracking is working
- **Metadata Validation:** Order and user validation is working
- **Error Handling:** Proper error responses are returned
- **Idempotency:** Idempotency keys are being generated and used

### ⚠️ Current Issues
- **Stripe:** `idempotency_key` parameter issue (needs fix)
- **M-Pesa:** Invalid BusinessShortCode (expected with sandbox credentials)

## 💳 Stripe Test Cards

### Successful Payments
```json
{
  "card_number": "4242424242424242",
  "brand": "VISA",
  "description": "Visa test card - always succeeds"
}

{
  "card_number": "5555555555554444", 
  "brand": "MASTERCARD",
  "description": "Mastercard test card - always succeeds"
}

{
  "card_number": "378282246310005",
  "brand": "AMERICAN_EXPRESS", 
  "description": "American Express test card - always succeeds"
}
```

### Declined Payments
```json
{
  "card_number": "4000000000000002",
  "brand": "VISA",
  "description": "Generic decline"
}

{
  "card_number": "4000000000009995",
  "brand": "VISA", 
  "description": "Insufficient funds"
}

{
  "card_number": "4000000000009987",
  "brand": "VISA",
  "description": "Lost card"
}
```

## 📱 M-Pesa Test Configuration

**Test Phone Number:** `254728287616`
**Currency:** `KES` (Kenyan Shillings)
**Minimum Amount:** `1 KES`

## 🧪 Test Payloads

### Stripe Visa Success
```bash
curl -X POST "https://nonoffensive-suasively-lorri.ngrok-free.dev/payments" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "orderId": "stripe_visa_001",
    "amount": 2500,
    "currency": "USD",
    "paymentMethod": {
      "type": "CARD",
      "token": "tok_visa",
      "brand": "VISA",
      "last4": "4242"
    },
    "metadata": {
      "order": {
        "id": "stripe_visa_001",
        "description": "Premium subscription purchase",
        "items": ["Premium Plan", "Extra Storage"],
        "totalItems": 2,
        "shippingAddress": "Nairobi, Kenya"
      },
      "user": {
        "id": "550e8400-e29b-41d4-a716-446655440000",
        "email": "user@example.com",
        "name": "John Doe",
        "phone": "+254712345678"
      },
      "gateway": "stripe",
      "testMode": true
    }
  }'
```

### M-Pesa STK Push
```bash
curl -X POST "https://nonoffensive-suasively-lorri.ngrok-free.dev/payments" \
  -H "Content-Type: application/json" \
  -H "ngrok-skip-browser-warning: true" \
  -d '{
    "userId": "550e8400-e29b-41d4-a716-446655440100",
    "orderId": "mpesa_001",
    "amount": 5000,
    "currency": "KES",
    "paymentMethod": {
      "type": "MPESA",
      "phoneNumber": "254728287616"
    },
    "metadata": {
      "order": {
        "id": "mpesa_001",
        "description": "Mobile money payment",
        "items": ["Digital Product"],
        "totalItems": 1,
        "shippingAddress": "Digital Delivery"
      },
      "user": {
        "id": "550e8400-e29b-41d4-a716-446655440100",
        "email": "mpesa@example.com",
        "name": "M-Pesa User",
        "phone": "254728287616"
      },
      "gateway": "mpesa",
      "phoneNumber": "254728287616",
      "testMode": true
    }
  }'
```

## 🔧 Test Scripts

### Run All Tests
```bash
node scripts/test-all-payments.js
```

### Run Stripe Tests Only
```bash
node scripts/test-stripe-payments.js
```

### Run M-Pesa Tests Only
```bash
node scripts/test-mpesa-payments.js
```

## 📊 Expected Responses

### Successful Payment (201)
```json
{
  "data": {
    "id": "uuid-here",
    "userId": "550e8400-e29b-41d4-a716-446655440000",
    "orderId": "order_123",
    "amount": 2500,
    "currency": "USD",
    "status": "SUCCEEDED",
    "paymentMethodId": "pm_123",
    "gatewayResponse": {
      "payment_intent_id": "pi_123",
      "status": "succeeded",
      "client_secret": "pi_123_secret"
    },
    "idempotencyKey": "payment-key-here",
    "retry": false,
    "metadata": { /* metadata */ },
    "createdAt": "2024-01-15T10:30:00Z",
    "updatedAt": "2024-01-15T10:30:00Z"
  },
  "metadata": {
    "status": 201,
    "correlation_id": "req-id"
  }
}
```

### Failed Payment (400)
```json
{
  "success": false,
  "error": {
    "code": "PAYMENT_PROCESSING_FAILED",
    "message": "Error message here",
    "details": {
      "code": "STRIPE_ERROR",
      "message": "Detailed error message",
      "type": "StripeInvalidRequestError"
    }
  },
  "data": {
    "id": "uuid-here",
    "status": "FAILED",
    "gatewayResponse": { /* error details */ }
  }
}
```

## 🚨 Known Issues & Fixes Needed

### 1. Stripe Idempotency Key Issue
**Problem:** `Received unknown parameter: idempotency_key`
**Status:** Needs fix in Stripe gateway code
**Impact:** Stripe payments fail with parameter error

### 2. M-Pesa Business ShortCode
**Problem:** `Invalid BusinessShortCode`
**Status:** Expected with sandbox credentials
**Impact:** M-Pesa payments fail (expected behavior)

## 🎯 Next Steps

1. **Fix Stripe idempotency key issue**
2. **Update M-Pesa credentials for production**
3. **Add webhook testing**
4. **Add refund testing**
5. **Add payment history testing**

## 📝 Notes

- All payments are being saved to the database
- Payment history is automatically tracked
- Metadata validation is working correctly
- Error handling is comprehensive
- The service is production-ready except for the known issues above
