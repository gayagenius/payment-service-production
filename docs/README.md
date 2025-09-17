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
- ✅ Load tested for 50k+ records

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
    "retry": false,
    "metadata": {
      "order": {
        "id": "order_123",
        "description": "Premium subscription",
        "items": ["Premium Plan"],
        "totalItems": 1,
        "shippingAddress": "Nairobi, Kenya"
      },
      "user": {
        "id": "user_456",
        "email": "user@example.com",
        "name": "John Doe",
        "phone": "+254712345678"
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
    retry: false,
    metadata: {
      order: { 
        id: 'order_123', 
        description: 'Premium subscription',
        items: ['Premium Plan'],
        totalItems: 1,
        shippingAddress: 'Nairobi, Kenya'
      },
      user: { 
        id: 'user_456', 
        email: 'user@example.com',
        name: 'John Doe',
        phone: '+254712345678'
      }
    }
  })
});
```

## 📞 Support

For questions or issues, please contact the development team or create an issue in the repository.

## 🔄 Updates

This documentation is automatically updated when changes are made to the API. The latest version is always available at the GitHub Pages URL.
