# Payment Service API Documentation

This directory contains the API documentation for the Payment Service.

## 📖 Documentation

- **[API Documentation](index.html)** - Interactive Swagger UI documentation
- **[OpenAPI Specification](openapi.yaml)** - Raw OpenAPI 3.0 specification

## 🚀 Quick Links

- **Base URL**: `https://your-api-domain.com`
- **Authentication**: Bearer Token
- **Rate Limiting**: 1000 requests/hour per API key

## 📋 Key Features

- ✅ Idempotency key support for safe retries
- ✅ Comprehensive payment history tracking
- ✅ Automatic status change logging
- ✅ Rich metadata support for orders and users
- ✅ Partitioned data storage for scalability
- ✅ 7-year compliance retention

## 🔧 Integration

### cURL Example
```bash
curl -X POST https://your-api-domain.com/payments \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: payment-123" \
  -d '{
    "amount": 2500,
    "currency": "USD",
    "metadata": {
      "order": {
        "id": "order_123",
        "description": "Premium subscription"
      },
      "user": {
        "id": "user_456",
        "email": "user@example.com"
      }
    }
  }'
```

### JavaScript Example
```javascript
const response = await fetch('https://your-api-domain.com/payments', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer YOUR_TOKEN',
    'Content-Type': 'application/json',
    'Idempotency-Key': 'payment-123'
  },
  body: JSON.stringify({
    amount: 2500,
    currency: 'USD',
    metadata: {
      order: { id: 'order_123', description: 'Premium subscription' },
      user: { id: 'user_456', email: 'user@example.com' }
    }
  })
});
```

## 📞 Support

For questions or issues, please contact the development team or create an issue in the repository.
