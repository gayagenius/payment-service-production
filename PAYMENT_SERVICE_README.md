# Payment Service - Stripe + M-Pesa Integration

A production-grade payment service that supports both Stripe and M-Pesa payment processing with comprehensive testing, monitoring, and compliance features.

## 🚀 Features

### Payment Processing
- **Stripe Integration**: Card payments, digital wallets, bank transfers
- **M-Pesa Integration**: Mobile money payments via STK Push
- **Real-time Processing**: End-to-end payment execution
- **Idempotency**: Safe retry mechanisms with idempotency keys
- **Webhook Handling**: Real-time status updates from payment gateways

### Database & Scalability
- **Partitioned Tables**: Range partitioning by `created_at` for performance
- **Read Replicas**: Separate read/write connection pools
- **Archival System**: Automatic archiving based on row count and compliance
- **Payment History**: Complete audit trail for all transactions
- **Connection Pooling**: Optimized database connections

### Compliance & Security
- **PCI Compliance**: No raw card data storage
- **Data Retention**: 7-year compliance retention for reports
- **Audit Logging**: Complete transaction history
- **Encryption**: Sensitive data encryption at rest
- **Rate Limiting**: API rate limiting and protection

### Testing & Monitoring
- **Unit Tests**: Comprehensive test coverage
- **Integration Tests**: Gateway integration testing
- **E2E Tests**: Complete end-to-end testing
- **Load Testing**: 50k+ record testing
- **Health Checks**: Service health monitoring

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client Apps   │    │   Web Services  │    │   Admin Panel   │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌─────────────▼─────────────┐
                    │     Payment Service       │
                    │   (Express.js + Node.js)  │
                    └─────────────┬─────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
┌─────────▼───────┐    ┌─────────▼───────┐    ┌─────────▼───────┐
│  Stripe Gateway │    │  M-Pesa Gateway │    │   Database      │
│                 │    │                 │    │  (PostgreSQL)   │
│ • Cards         │    │ • STK Push      │    │                 │
│ • Wallets       │    │ • Refunds       │    │ • Partitioned   │
│ • Refunds       │    │ • Status Query  │    │ • Archived      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 📋 API Endpoints

### Payments
- `POST /payments` - Create payment (Stripe/M-Pesa)
- `GET /payments` - List payments with pagination
- `GET /payments/{id}` - Get payment details
- `GET /payments/user/{userId}` - Get user payments

### Refunds
- `POST /refunds` - Create refund
- `GET /refunds` - List refunds
- `GET /refunds/{id}` - Get refund details

### Payment Methods
- `POST /payments/methods` - Add payment method
- `GET /payments/methods/{userId}` - List user payment methods
- `GET /payment/types` - Get available payment types

### Payment History
- `GET /payment-history/{paymentId}` - Get payment history
- `GET /payment-history/user/{userId}` - Get user payment history
- `POST /payment-history` - Create history entry

### Webhooks
- `POST /webhooks/stripe` - Stripe webhook handler
- `POST /webhooks/mpesa` - M-Pesa webhook handler
- `GET /webhooks/health` - Webhook health check

## 🔧 Setup & Installation

### Prerequisites
- Node.js 18+
- PostgreSQL 12+
- Redis (optional, for caching)
- RabbitMQ (optional, for messaging)

### Environment Variables

```bash
# Application
NODE_ENV=development
PORT=8888
DOCS_PORT=8889

# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=payment_service
DB_USER=your_db_user
DB_PASSWORD=your_db_password

# Stripe
STRIPE_SECRET_KEY=sk_test_your_stripe_secret_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# M-Pesa
MPESA_BASE_URL=https://sandbox.safaricom.co.ke
MPESA_CONSUMER_KEY=your_mpesa_consumer_key
MPESA_CONSUMER_SECRET=your_mpesa_consumer_secret
MPESA_PASSKEY=your_mpesa_passkey
MPESA_SHORTCODE=174379
MPESA_CALLBACK_URL=https://your-domain.com/webhooks/mpesa
```

### Installation

```bash
# Clone repository
git clone <repository-url>
cd payment-service-production

# Install dependencies
npm install

# Setup environment
cp env.example .env
# Edit .env with your configuration

# Setup database
npm run migrate

# Start development server
npm run dev

# Start documentation server (separate terminal)
npm run docs
```

## 🧪 Testing

### Run All Tests
```bash
npm test
```

### Run Specific Test Suites
```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# E2E tests
npm run test:e2e

# Load tests
npm run test:load

# Gateway tests
npm run test:gateways
```

### Manual E2E Testing
```bash
# Run comprehensive E2E tests
node scripts/test-payment-e2e.js

# Test against different environment
node scripts/test-payment-e2e.js --url http://localhost:3000

# Test with custom API key
API_KEY=your-api-key node scripts/test-payment-e2e.js
```

## 💳 Payment Examples

### Stripe Card Payment
```javascript
const payment = await fetch('/payments', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-token'
  },
  body: JSON.stringify({
    user_id: '550e8400-e29b-41d4-a716-446655440000',
    order_id: 'order_123',
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
        id: 'order_123',
        description: 'Premium subscription',
        items: ['Premium Plan']
      },
      user: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'user@example.com',
        name: 'John Doe'
      }
    }
  })
});
```

### M-Pesa Payment
```javascript
const payment = await fetch('/payments', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-token'
  },
  body: JSON.stringify({
    user_id: '550e8400-e29b-41d4-a716-446655440000',
    order_id: 'order_456',
    amount: 1000, // 10.00 KES
    currency: 'KES',
    paymentMethod: {
      type: 'MPESA',
      phoneNumber: '254712345678'
    },
    metadata: {
      order: {
        id: 'order_456',
        description: 'Mobile payment',
        items: ['Digital Product']
      },
      user: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        email: 'user@example.com',
        name: 'John Doe',
        phone: '+254712345678'
      },
      phoneNumber: '254712345678',
      description: 'M-Pesa payment for order_456'
    }
  })
});
```

### Create Refund
```javascript
const refund = await fetch('/refunds', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-token'
  },
  body: JSON.stringify({
    payment_id: 'payment-uuid',
    amount: 1000, // Partial refund
    reason: 'Customer requested cancellation',
    metadata: {
      refund_type: 'partial',
      admin_notes: 'Customer changed mind'
    }
  })
});
```

## 🔄 Webhook Configuration

### Stripe Webhooks
1. Go to Stripe Dashboard → Webhooks
2. Add endpoint: `https://your-domain.com/webhooks/stripe`
3. Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `charge.dispute.created`
4. Copy webhook secret to `STRIPE_WEBHOOK_SECRET`

### M-Pesa Webhooks
1. Configure callback URL in M-Pesa API settings
2. Set `MPESA_CALLBACK_URL=https://your-domain.com/webhooks/mpesa`
3. Ensure your server is accessible from M-Pesa servers

## 📊 Monitoring & Health Checks

### Health Endpoints
- `GET /` - Basic health check
- `GET /webhooks/health` - Webhook health
- `GET /queue/health` - Queue health (if using RabbitMQ)

### Database Health
```bash
# Check database connections
npm run health

# Check partitioning status
npm run test:partitioning

# Check archival status
npm run test:archiving
```

### Performance Monitoring
```bash
# Run load tests
npm run test:load

# Test with 50k records
npm run test:scalability:load

# Dry run tests
npm run test:scalability:dry-run
```

## 🗄️ Database Management

### Migrations
```bash
# Run migrations
npm run migrate

# Reset database
npm run migrate:reset

# Check migration status
npm run db:status
```

### Partitioning
```bash
# Setup partitioning
npm run db:partitioning

# Test partitioning
npm run test:partitioning
```

### Archival
```bash
# Run archival
npm run db:archive

# Test archival
npm run test:archiving
```

## 🚀 Deployment

### Docker Deployment
```bash
# Build image
docker build -t payment-service .

# Run container
docker run -p 8888:8888 --env-file .env payment-service
```

### Kubernetes Deployment
```bash
# Apply configurations
kubectl apply -f k8s/

# Check deployment
kubectl get pods -l app=payment-service
```

## 📈 Performance & Scalability

### Database Optimization
- **Partitioned Tables**: Automatic partitioning by date
- **Read Replicas**: Separate read/write pools
- **Connection Pooling**: Optimized connection management
- **Indexing**: Comprehensive index strategy

### Caching Strategy
- **Redis**: Optional caching layer
- **Query Optimization**: Optimized database queries
- **Connection Pooling**: Efficient connection management

### Load Testing
- **50k+ Records**: Tested with large datasets
- **Concurrent Users**: Multi-user testing
- **Gateway Limits**: Respects gateway rate limits

## 🔒 Security

### Data Protection
- **PCI Compliance**: No raw card data storage
- **Encryption**: Sensitive data encryption
- **Tokenization**: Payment method tokenization
- **Audit Logging**: Complete audit trail

### API Security
- **Authentication**: JWT token authentication
- **Rate Limiting**: API rate limiting
- **Input Validation**: Comprehensive validation
- **Error Handling**: Secure error responses

## 📚 Documentation

### API Documentation
- **Swagger UI**: Interactive API documentation
- **OpenAPI Spec**: Machine-readable API specification
- **Examples**: Comprehensive request/response examples

### Access Documentation
- **Local**: http://localhost:8889
- **GitHub Pages**: https://gayagenius.github.io/payment-service-production/

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Run the test suite
6. Submit a pull request

## 📄 License

This project is licensed under the ISC License.

## 🆘 Support

For support and questions:
- Create an issue in the repository
- Check the documentation
- Review the test examples
- Contact the development team

---

**Built with ❤️ for production-grade payment processing**
