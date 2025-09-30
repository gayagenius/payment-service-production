# Payment Service - Complete System Design (Paystack Integration)

## 🏗️ Architecture Overview

### High-Level Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Client Apps   │    │   Web Clients   │    │   Admin Panel   │
└─────────┬───────┘    └─────────┬───────┘    └─────────┬───────┘
          │                      │                      │
          └──────────────────────┼──────────────────────┘
                                 │
                    ┌─────────────▼─────────────┐
                    │    API Gateway/Load      │
                    │        Balancer          │
                    └─────────────┬─────────────┘
                                 │
                    ┌─────────────▼─────────────┐
                    │   Payment Service API    │
                    │     (Node.js/Express)    │
                    └─────────────┬─────────────┘
                                 │
          ┌──────────────────────┼──────────────────────┐
          │                      │                      │
┌─────────▼───────┐    ┌─────────▼───────┐    ┌─────────▼───────┐
│   PostgreSQL    │    │    RabbitMQ     │    │    Paystack     │
│   (Primary DB)  │    │   (Messaging)   │    │     Gateway     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
          │
┌─────────▼───────┐
│   PostgreSQL    │
│  (Read Replica) │
└─────────────────┘
```

## 1. Service Boundaries

### What Payment Service Handles

- **Payment Processing**: Cards (Visa, Mastercard, Verve), bank transfers, mobile money (via Paystack)
- **Payment Method Management**: Store, retrieve, and manage user payment methods
- **Refund Processing**: Full and partial refunds with audit trails
- **Transaction History**: Comprehensive payment records and reporting
- **Paystack Integration**: Single gateway integration for all payment methods
- **Webhook Handling**: Process Paystack webhook notifications
- **Payment Validation**: Amount validation, duplicate detection, currency validation
- **Security**: PCI DSS compliance through Paystack, encryption, tokenization
- **Multi-Currency Support**: Handle NGN, GHS, ZAR, KES, USD via Paystack

### What Payment Service Does NOT Handle

- **User Authentication & Management** → User Service responsibility
- **Order Creation & Lifecycle** → Order Service responsibility  
- **Inventory Management** → Inventory Service responsibility
- **Product Catalog** → Product Service responsibility
- **Shipping & Fulfillment** → Fulfillment Service responsibility
- **Tax Calculations** → Tax Service responsibility

### Service Integration Points

- **User Service**: Validate user existence and permissions
- **Order Service**: Validate orders and update payment status
- **Notification Service**: Send payment confirmations and receipts
- **Audit Service**: Log payment events for compliance

---

## 2. Core Components

### 1. API Layer

- **Express.js** with middleware stack
- **Rate limiting** and **authentication**
- **Request validation** and **error handling**
- **OpenAPI/Swagger** documentation
- **Health checks** and **metrics**

### 2. Business Logic Layer

- **Payment processing** orchestration
- **Paystack integration** (cards, bank transfers, mobile money, USSD)
- **Webhook handling** and **status updates**
- **Retry logic** and **idempotency**
- **Refund processing**
- **Currency validation** and conversion

### 3. Data Layer

- **PostgreSQL** with connection pooling
- **Read/write separation**
- **Database partitioning** for performance
- **Archival system** for old data
- **Backup and recovery**

### 4. Messaging Layer

- **RabbitMQ** for event-driven architecture
- **Payment events** (success, failure, refund)
- **Queue health monitoring**
- **Dead letter queues** for failed messages

### 5. External Integrations

- **Paystack API** for all payment processing
- **Webhook endpoints** for status updates

---

## 3. API Flows & Dependencies

### POST /payments (Process Payment)

**Purpose**: Initiate a new payment transaction via Paystack

- **Input**: `{userId, orderId, amount, currency, paymentChannel, email, metadata}`
- **Dependencies**:
  - User Service → validate user exists and is active
  - Order Service → validate order exists and amount matches
  - Paystack API → initialize transaction and get authorization URL
  - Database → store transaction record
  - Message Queue → publish payment events
- **Output**: `{paymentId, status, authorizationUrl, reference}`

### POST /payments/verify (Verify Payment)

**Purpose**: Verify payment status with Paystack

- **Input**: `{reference}`
- **Dependencies**:
  - Paystack API → verify transaction status
  - Database → update payment record
  - Message Queue → publish payment events
- **Output**: `{paymentId, status, amount, paidAt, channel}`

### POST /payments/{id}/refund (Process Refund)

**Purpose**: Refund a completed payment (full or partial)

- **Input**: `{amount, reason, metadata}`
- **Dependencies**:
  - Database → verify original payment exists and is refundable
  - Paystack API → process refund
  - Database → create refund record and update payment status
  - Message Queue → publish refund events
- **Output**: `{refundId, status, refundAmount, estimatedSettlement}`

### GET /payments/{id} (Get Payment Status)

**Purpose**: Retrieve detailed payment information

- **Input**: `paymentId`
- **Dependencies**:
  - Database → fetch payment record
  - Cache (Redis) → check for cached payment data
- **Output**: `{paymentId, userId, orderId, amount, currency, status, channel, timestamps}`

### GET /payments/user/{userId} (User Payment History)

**Purpose**: Retrieve paginated payment history for a user

- **Input**: `userId, limit, offset, dateRange, status, currency`
- **Dependencies**:
  - Database → query user payments with pagination
  - Cache (Redis) → cache frequent queries
- **Output**: `{payments[], totalCount, hasMore, pagination}`

### POST /payment-methods (Add Payment Method)

**Purpose**: Securely store a new payment method via Paystack

- **Input**: `{userId, authorizationCode, cardType, email}`
- **Dependencies**:
  - Paystack API → validate authorization code
  - Database → store payment method reference
- **Output**: `{paymentMethodId, type, last4, brand, expiryMonth, expiryYear}`

### GET /payment-methods/user/{userId} (Get User Payment Methods)

**Purpose**: Retrieve user's stored payment methods

- **Input**: `userId`
- **Dependencies**:
  - Database → fetch user's payment methods
- **Output**: `{paymentMethods[], defaultMethodId}`

### POST /webhooks/paystack (Paystack Webhook)

**Purpose**: Handle Paystack event notifications

- **Input**: Paystack webhook payload `{event, data}`
- **Dependencies**:
  - Database → update payment/refund status
  - Message Queue → publish relevant events
  - Order Service → trigger order processing
- **Output**: `200 OK`

---

## 4. Database Design

### Core Tables

```sql
-- Payments table with partitioning and multi-currency support
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    order_id VARCHAR(255) NOT NULL,
    amount INTEGER NOT NULL, -- Amount in kobo/cents
    currency CHAR(3) NOT NULL DEFAULT 'NGN',
    status payment_status NOT NULL DEFAULT 'PENDING',
    
    -- Paystack specific fields
    paystack_reference VARCHAR(100) UNIQUE NOT NULL,
    paystack_access_code VARCHAR(100),
    paystack_authorization_url TEXT,
    paystack_transaction_id BIGINT,
    paystack_response JSONB,
    channel VARCHAR(50), -- card, bank, ussd, mobile_money, bank_transfer
    
    -- Card details (if applicable)
    card_type VARCHAR(20),
    card_last4 VARCHAR(4),
    card_brand VARCHAR(20),
    card_exp_month INTEGER,
    card_exp_year INTEGER,
    
    idempotency_key VARCHAR(255) UNIQUE NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    paid_at TIMESTAMPTZ
) PARTITION BY RANGE (created_at);

-- Payment status enum
CREATE TYPE payment_status AS ENUM (
    'PENDING',
    'PROCESSING',
    'SUCCESS',
    'FAILED',
    'ABANDONED',
    'CANCELLED',
    'REFUNDED',
    'PARTIALLY_REFUNDED'
);

-- Payment history for audit trail
CREATE TABLE payment_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES payments(id),
    status payment_status NOT NULL,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Refunds table
CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    payment_id UUID NOT NULL REFERENCES payments(id),
    amount INTEGER NOT NULL,
    currency CHAR(3) NOT NULL,
    reason TEXT,
    status refund_status NOT NULL DEFAULT 'PENDING',
    paystack_refund_id BIGINT,
    paystack_response JSONB,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ
);

CREATE TYPE refund_status AS ENUM (
    'PENDING',
    'PROCESSING',
    'SUCCESS',
    'FAILED'
);

-- Payment methods table (storing Paystack authorization codes)
CREATE TABLE payment_methods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id VARCHAR(255) NOT NULL,
    type VARCHAR(20) NOT NULL, -- card, bank_account
    
    -- Paystack authorization details
    authorization_code VARCHAR(100) UNIQUE NOT NULL,
    card_type VARCHAR(20),
    card_last4 VARCHAR(4),
    card_brand VARCHAR(20),
    card_exp_month INTEGER,
    card_exp_year INTEGER,
    bank_name VARCHAR(100),
    account_name VARCHAR(100),
    
    is_reusable BOOLEAN DEFAULT true,
    is_default BOOLEAN DEFAULT false,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Supported currencies table
CREATE TABLE supported_currencies (
    code CHAR(3) PRIMARY KEY,
    name VARCHAR(50) NOT NULL,
    symbol VARCHAR(5) NOT NULL,
    subunit VARCHAR(20) NOT NULL, -- kobo, pesewas, cents
    decimal_places INTEGER NOT NULL DEFAULT 2,
    min_amount INTEGER NOT NULL,
    max_amount INTEGER NOT NULL,
    is_active BOOLEAN DEFAULT true
);

-- Insert Paystack supported currencies
INSERT INTO supported_currencies (code, name, symbol, subunit, decimal_places, min_amount, max_amount) VALUES
('NGN', 'Nigerian Naira', '₦', 'kobo', 2, 100, 99999999900),
('GHS', 'Ghanaian Cedi', '₵', 'pesewas', 2, 100, 99999999900),
('ZAR', 'South African Rand', 'R', 'cents', 2, 100, 99999999900),
('KES', 'Kenyan Shilling', 'KSh', 'cents', 2, 100, 99999999900),
('USD', 'US Dollar', '$', 'cents', 2, 100, 99999999900);

-- Indexes for performance
CREATE INDEX idx_payments_user_id ON payments(user_id);
CREATE INDEX idx_payments_order_id ON payments(order_id);
CREATE INDEX idx_payments_status ON payments(status);
CREATE INDEX idx_payments_reference ON payments(paystack_reference);
CREATE INDEX idx_payments_created_at ON payments(created_at);
CREATE INDEX idx_payment_methods_user_id ON payment_methods(user_id);
CREATE INDEX idx_payment_methods_authorization ON payment_methods(authorization_code);
CREATE INDEX idx_refunds_payment_id ON refunds(payment_id);
```

### Partitioning Strategy

```sql
-- Monthly partitions for payments
CREATE TABLE payments_2024_01 PARTITION OF payments
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE payments_2024_02 PARTITION OF payments
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

-- Automatic partition creation function
CREATE OR REPLACE FUNCTION create_monthly_partition(table_name text, start_date date)
RETURNS void AS $$
DECLARE
    partition_name text;
    end_date date;
BEGIN
    partition_name := table_name || '_' || to_char(start_date, 'YYYY_MM');
    end_date := start_date + interval '1 month';
    
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
                   partition_name, table_name, start_date, end_date);
END;
$$ LANGUAGE plpgsql;
```

### Archival Strategy

```sql
-- Archive old payments (older than 2 years)
CREATE TABLE payments_archive (
    LIKE payments INCLUDING ALL
);

-- Archive function
CREATE OR REPLACE FUNCTION archive_old_payments()
RETURNS void AS $$
BEGIN
    INSERT INTO payments_archive
    SELECT * FROM payments
    WHERE created_at < NOW() - interval '2 years';
    
    DELETE FROM payments
    WHERE created_at < NOW() - interval '2 years';
END;
$$ LANGUAGE plpgsql;
```

---

## 5. Paystack Integration Details

### Supported Payment Channels

Paystack provides multiple payment channels:

1. **Card Payments**: Visa, Mastercard, Verve
2. **Bank Transfers**: Direct bank account transfers
3. **USSD**: Dial codes for bank payments
4. **Mobile Money**: MTN, Vodafone, AirtelTigo (Ghana), Safaricom (Kenya)
5. **QR Code**: Scan to pay
6. **Bank**: Account debit

### Payment Flow Types

#### 1. Standard Checkout (Redirect)

```javascript
// Initialize transaction
const initializePayment = async (orderData) => {
    const response = await paystack.transaction.initialize({
        email: orderData.email,
        amount: orderData.amount, // in kobo/cents
        currency: orderData.currency,
        reference: generateUniqueReference(),
        callback_url: 'https://api.example.com/payments/callback',
        metadata: {
            userId: orderData.userId,
            orderId: orderData.orderId,
            custom_fields: [
                {
                    display_name: "Customer Name",
                    variable_name: "customer_name",
                    value: orderData.customerName
                }
            ]
        },
        channels: ['card', 'bank', 'ussd', 'mobile_money']
    });
    
    return {
        authorizationUrl: response.data.authorization_url,
        accessCode: response.data.access_code,
        reference: response.data.reference
    };
};
```

#### 2. Popup/Inline Checkout

Client-side integration for embedded payment experience.

#### 3. Charge Authorization (Recurring)

```javascript
// Charge saved card
const chargeAuthorization = async (paymentData) => {
    const response = await paystack.transaction.chargeAuthorization({
        email: paymentData.email,
        amount: paymentData.amount,
        authorization_code: paymentData.authorizationCode,
        reference: generateUniqueReference(),
        currency: paymentData.currency
    });
    
    return response.data;
};
```

### Webhook Events

Paystack sends webhooks for various events:

| Event | Description | Action |
|-------|-------------|--------|
| `charge.success` | Payment completed successfully | Update payment status to SUCCESS |
| `charge.failed` | Payment failed | Update payment status to FAILED |
| `transfer.success` | Refund transfer completed | Update refund status to SUCCESS |
| `transfer.failed` | Refund transfer failed | Update refund status to FAILED |

### Currency Support Matrix

| Currency | Countries | Min Amount | Max Amount | Subunit |
|----------|-----------|------------|------------|---------|
| NGN | Nigeria | ₦1 (100 kobo) | ₦999,999,999 | kobo |
| GHS | Ghana | ₵1 (100 pesewas) | ₵999,999,999 | pesewas |
| ZAR | South Africa | R1 (100 cents) | R999,999,999 | cents |
| KES | Kenya | KSh1 (100 cents) | KSh999,999,999 | cents |
| USD | International | $1 (100 cents) | $999,999,999 | cents |

---

## 6. Error Codes & Response Structure

### Standard Response Format

```json
{
  "success": true,
  "data": {},
  "error": null,
  "timestamp": "2025-09-30T12:00:00Z",
  "requestId": "req_123456"
}
```

### Error Response Format

```json
{
  "success": false,
  "data": null,
  "error": {
    "code": "PAYMENT_FAILED",
    "message": "Payment could not be processed",
    "details": "Insufficient funds",
    "field": "amount"
  },
  "timestamp": "2025-09-30T12:00:00Z",
  "requestId": "req_123456"
}
```

### HTTP Status Codes & Error Mapping

| HTTP Code | Error Code | Description | Example Response |
|-----------|------------|-------------|------------------|
| 200 | SUCCESS | Operation completed successfully | `{"success": true, "data": {...}}` |
| 201 | CREATED | Resource created successfully | `{"success": true, "data": {...}}` |
| 400 | INVALID_REQUEST | Malformed or invalid input | `{"error": {"code": "INVALID_AMOUNT"}}` |
| 401 | UNAUTHORIZED | Missing or invalid authentication | `{"error": {"code": "UNAUTHORIZED"}}` |
| 403 | FORBIDDEN | User lacks permission for resource | `{"error": {"code": "INSUFFICIENT_PERMISSIONS"}}` |
| 404 | NOT_FOUND | Resource does not exist | `{"error": {"code": "PAYMENT_NOT_FOUND"}}` |
| 408 | REQUEST_TIMEOUT | Request timeout | `{"error": {"code": "PAYSTACK_TIMEOUT"}}` |
| 409 | CONFLICT | Duplicate or conflicting request | `{"error": {"code": "DUPLICATE_PAYMENT"}}` |
| 422 | UNPROCESSABLE_ENTITY | Valid format but business logic error | `{"error": {"code": "PAYMENT_DECLINED"}}` |
| 429 | RATE_LIMITED | Too many requests | `{"error": {"code": "RATE_LIMIT_EXCEEDED"}}` |
| 500 | INTERNAL_ERROR | Unexpected server error | `{"error": {"code": "INTERNAL_ERROR"}}` |
| 502 | BAD_GATEWAY | Paystack service error | `{"error": {"code": "GATEWAY_ERROR"}}` |
| 503 | SERVICE_UNAVAILABLE | Service temporarily unavailable | `{"error": {"code": "MAINTENANCE_MODE"}}` |

### Payment-Specific Error Codes

**General Payment Errors:**

- `PAYMENT_DECLINED` - Card or payment method declined
- `INSUFFICIENT_FUNDS` - Not enough balance
- `INVALID_PAYMENT_METHOD` - Payment method invalid or expired
- `DUPLICATE_PAYMENT` - Idempotency violation
- `REFUND_NOT_ALLOWED` - Payment cannot be refunded
- `PARTIAL_REFUND_EXCEEDS` - Refund amount exceeds available amount
- `GATEWAY_TIMEOUT` - Paystack API timeout
- `CURRENCY_NOT_SUPPORTED` - Currency not supported by Paystack

**Paystack-Specific Error Codes:**

- `PAYSTACK_INVALID_REFERENCE` - Invalid transaction reference
- `PAYSTACK_TRANSACTION_NOT_FOUND` - Transaction not found
- `PAYSTACK_AUTHORIZATION_INVALID` - Invalid authorization code
- `PAYSTACK_API_ERROR` - Paystack API returned error
- `PAYSTACK_WEBHOOK_INVALID` - Invalid webhook signature

---

## 7. Sequence Diagrams

### POST /payments - Paystack Checkout Flow

```mermaid
sequenceDiagram
    participant Client
    participant PaymentService
    participant UserService
    participant OrderService
    participant Paystack
    participant Database
    participant MessageQueue

    Client->>PaymentService: POST /payments {orderId, amount, email}
    PaymentService->>Database: Check for duplicate (idempotency)
    PaymentService->>UserService: Validate user exists
    UserService-->>PaymentService: User validated
    PaymentService->>OrderService: Validate order and amount
    OrderService-->>PaymentService: Order validated
    PaymentService->>Paystack: Initialize transaction
    Paystack-->>PaymentService: {authorizationUrl, reference, accessCode}
    PaymentService->>Database: Store payment record (PENDING)
    PaymentService-->>Client: {paymentId, authorizationUrl, reference}
    
    Client->>Paystack: Redirect to authorization URL
    Paystack->>Client: Display payment page
    Client->>Paystack: Complete payment
    Paystack->>PaymentService: Webhook: charge.success
    PaymentService->>Database: Update payment status to SUCCESS
    PaymentService->>MessageQueue: Publish payment_completed event
    MessageQueue->>OrderService: Process order completion
```

### POST /payments/verify - Payment Verification Flow

```mermaid
sequenceDiagram
    participant Client
    participant PaymentService
    participant Paystack
    participant Database
    participant MessageQueue

    Client->>PaymentService: GET /payments/verify?reference=xxx
    PaymentService->>Paystack: Verify transaction
    Paystack-->>PaymentService: Transaction details
    PaymentService->>Database: Update payment status
    PaymentService->>MessageQueue: Publish payment event
    PaymentService-->>Client: {paymentId, status, amount, paidAt}
```

### POST /payments/{id}/refund - Refund Flow

```mermaid
sequenceDiagram
    participant Client
    participant PaymentService
    participant Paystack
    participant Database
    participant MessageQueue

    Client->>PaymentService: POST /payments/{id}/refund {amount, reason}
    PaymentService->>Database: Fetch original payment
    PaymentService->>Database: Validate refund eligibility
    PaymentService->>Paystack: Create refund
    Paystack-->>PaymentService: Refund initiated
    PaymentService->>Database: Create refund record (PROCESSING)
    PaymentService->>MessageQueue: Publish refund_initiated event
    PaymentService-->>Client: {refundId, status: "processing"}
    
    Paystack->>PaymentService: Webhook: transfer.success
    PaymentService->>Database: Update refund status to SUCCESS
    PaymentService->>MessageQueue: Publish refund_completed event
```

### Webhook Handling Flow

```mermaid
sequenceDiagram
    participant Paystack
    participant WebhookHandler
    participant Database
    participant MessageQueue
    participant OrderService

    Paystack->>WebhookHandler: POST /webhooks/paystack {event, data}
    WebhookHandler->>WebhookHandler: Verify webhook signature
    WebhookHandler->>Database: Update payment/refund status
    WebhookHandler->>MessageQueue: Publish event
    MessageQueue->>OrderService: Trigger downstream actions
    WebhookHandler-->>Paystack: 200 OK
```

---

## 8. Performance Optimizations

### 1. Database Optimizations

- **Connection pooling** (read/write separation)
- **Index optimization** for common queries (user_id, order_id, status, reference)
- **Query optimization** with EXPLAIN ANALYZE
- **Partitioning** for large datasets (monthly partitions)
- **Archival** for old data (2+ years)

### 2. Application Optimizations

- **Caching Strategy**:
  - Payment method cache: 5 minutes TTL
  - User payment history: 2 minutes TTL
  - Currency exchange rates: 1 hour TTL
  - Paystack transaction status: 30 seconds TTL
- **Async processing** for non-critical operations (notifications, analytics)
- **Batch operations** for bulk refunds/reports
- **Connection reuse** for Paystack API calls
- **Webhook queue** for high-throughput processing

### 3. Infrastructure Optimizations

- **Load balancing** for high availability
- **CDN** for static assets
- **Monitoring** and **alerting**
- **Auto-scaling** based on load
- **Circuit breakers** to prevent cascading failures

---

## 9. Security Design

### 1. Authentication & Authorization

- **JWT tokens** for API access
- **Role-based access control** (RBAC)
- **API key management** for service-to-service
- **Rate limiting** per user/IP
  - 100 requests/minute per user
  - 10 payment attempts/hour per user

### 2. Data Protection

- **Encryption at rest** (database encryption)
- **Encryption in transit** (HTTPS/TLS 1.3)
- **PCI DSS compliance** through Paystack (Paystack is PCI DSS Level 1 certified)
- **Data masking** for sensitive information
- **Tokenization** via Paystack authorization codes (never store raw card data)
- **GDPR compliance** for data deletion

### 3. Webhook Security

- **Signature verification** for all Paystack webhooks

```javascript
const crypto = require('crypto');

const verifyPaystackWebhook = (payload, signature) => {
    const hash = crypto
        .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
        .update(JSON.stringify(payload))
        .digest('hex');
    
    return hash === signature;
};
```

- **IP whitelisting** (optional additional layer)
- **Idempotency** to handle duplicate webhooks

### 4. Security Monitoring

- **Audit logging** for all operations
- **Intrusion detection**
- **Anomaly detection** (unusual payment patterns)
- **Security alerts** (multiple failed attempts)

---

## 10. Monitoring & Observability

### 1. Metrics

- **Prometheus** for metrics collection
- **Grafana** for visualization
- **Custom business metrics**:
  - Payment success rate
  - Average payment processing time
  - Refund rate
  - Currency-specific transaction volumes
  - Paystack API response time
  - Webhook processing time
- **Performance metrics**:
  - API response time (P50, P95, P99)
  - Database query latency
  - Paystack API latency

### 2. Logging

- **Structured logging** (JSON format)
- **Log aggregation** (ELK stack: Elasticsearch, Logstash, Kibana)
- **Log retention** policies (90 days for transactional logs)
- **Error tracking** (Sentry integration)
- **Correlation IDs** for request tracing

### 3. Tracing

- **OpenTelemetry** for distributed tracing
- **Request correlation IDs**
- **Performance profiling**
- **Dependency mapping** (service dependency graph)

### 4. Alerting

- **Payment success rate** < 95%
- **Paystack API unavailable** > 5 minutes
- **Database connection pool** exhaustion
- **High error rate** (>1% in 5 minutes)
- **Webhook processing delays** > 5 minutes

---

## 11. Scalability Design

### 1. Horizontal Scaling

- **Stateless application** design
- **Load balancer** configuration (NGINX/AWS ALB)
- **Auto-scaling** groups (CPU > 70%, scale up)
- **Database read replicas** (3 replicas for read-heavy queries)

### 2. Vertical Scaling

- **Resource optimization**
- **Memory management** (Node.js heap tuning)
- **CPU optimization** (worker threads for heavy operations)
- **Storage optimization** (SSD for database)

### 3. Data Scaling

- **Database sharding** strategy (shard by user_id for future growth)
- **Caching layers** (Redis for hot data)
- **CDN** for static content
- **Message queue** scaling (RabbitMQ cluster)

---

## 12. Reliability & Fault Tolerance

### 1. High Availability

- **Multi-region deployment** (active-passive)
- **Database replication** (streaming replication to standby)
- **Failover mechanisms** (automatic failover in < 5 minutes)
- **Health checks** (every 30 seconds)

### 2. Disaster Recovery

- **Backup strategies**:
  - Full backup: Daily at 2 AM UTC
  - Incremental backup: Every 4 hours
  - Transaction log backup: Every 15 minutes
- **Recovery procedures**:
  - RTO (Recovery Time Objective): < 1 hour
  - RPO (Recovery Point Objective): < 15 minutes
- **Testing procedures**: Quarterly disaster recovery drills

### 3. Error Handling & Resilience

- **Circuit breakers** (open after 5 consecutive failures)
- **Retry mechanisms** (exponential backoff: 1s, 2s, 4s, 8s)
- **Dead letter queues** for failed webhook processing
- **Graceful degradation** (read-only mode during database issues)
- **Bulkhead pattern** for resource isolation

---

## 13. Deployment Architecture

### 1. Environment Strategy

- **Development** environment (local + dev cluster)
- **Staging** environment (production-like)
- **Production** environment (multi-region)
- **Feature flags** for gradual rollouts

### 2. CI/CD Pipeline

- **Automated testing** (unit, integration, e2e)
- **Code quality checks** (ESLint, Prettier, SonarQube)
- **Security scanning** (Snyk, OWASP dependency check)
- **Deployment automation** (GitHub Actions/GitLab CI)
- **Automated rollback** on health check failure

### 3. Infrastructure as Code

- **Docker** containerization (Node.js Alpine base image)
- **Kubernetes** orchestration (EKS/GKE)
- **Terraform** for infrastructure provisioning
- **Helm** charts for application deployment

### 4. Container Configuration

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: payment-service
spec:
  replicas: 3
  template:
    spec:
      containers:
      - name: payment-service
        image: payment-service:v1.2.0
        resources:
          requests:
            memory: "512Mi"
            cpu: "500m"
          limits:
            memory: "1Gi"
            cpu: "1000m"
        env:
        - name: DATABASE_URL
          valueFrom:
            secretKeyRef:
              name: payment-secrets
              key: database-url
        - name: PAYSTACK_SECRET_KEY
          valueFrom:
            secretKeyRef:
              name: payment-secrets
              key: paystack-secret-key
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 5
          periodSeconds: 5
```

---

## 14. Operational Procedures

### 1. Monitoring

- **Health checks** every 30 seconds
- **Performance monitoring** in real-time (Datadog/New Relic)
- **Alert thresholds**:
  - Error rate > 1%
  - Response time P95 > 500ms
  - Success rate < 95%
  - Paystack API errors > 5 in 5 minutes
- **Dashboard** for system overview (Grafana)

### 2. Maintenance

- **Database maintenance** windows (Sundays 2-4 AM UTC)
- **Security updates** schedule (monthly patches)
- **Performance tuning** procedures (quarterly reviews)
- **Capacity planning** (monthly analysis)
- **Paystack API version updates** (monitor deprecations)

### 3. Incident Response

- **Runbook** procedures for common issues:
  - Paystack API downtime
  - Database connection issues
  - Webhook processing delays
  - High error rates
- **Escalation** matrix:
  - L1: On-call engineer (0-15 min)
  - L2: Senior engineer (15-30 min)
  - L3: Engineering manager (30-60 min)
- **Communication** protocols:
  - Status page updates
  - Customer notifications
  - Internal Slack alerts
- **Post-mortem** process (within 48 hours of major incidents)

### 4. Payment Operations

- **Daily Reconciliation**: Match internal records with Paystack dashboard (automated at 6 AM daily)
- **Settlement Monitoring**: Track Paystack fund settlement (T+2/T+7 business days depending on country)
- **Dispute Management**: Handle chargebacks and disputes through Paystack dashboard
- **Refund Processing**: Monitor refund queue and processing times

---

## 15. Performance Targets

### 1. Response Time Targets

- **API Response**: < 200ms (P95), < 500ms (P99)
- **Database Queries**: < 100ms (P95)
- **Paystack API Calls**: < 1s (P95)
- **Webhook Processing**: < 1s (P95)

### 2. Throughput Targets

- **Concurrent Users**: 10,000+
- **Requests per Second**: 1,000+
- **Payment Processing**: 500+ per minute
- **Database Connections**: 100+ concurrent
- **Webhook Processing**: 200+ per minute

### 3. Availability Targets

- **Uptime**: 99.9% (8.76 hours downtime/year)
- **Recovery Time**: < 5 minutes
- **Data Loss**: Zero tolerance
- **Backup Recovery**: < 1 hour

### 4. Business KPIs

- **Payment Success Rate**: > 95%
- **Transaction volume**: Track month-over-month growth
- **Refund Processing Time**: < 24 hours initiation, 5-7 days settlement
- **False Decline Rate**: < 1%
- **Customer Satisfaction**: > 4.5/5

---

## 16. Testing Strategy

### 1. Unit Testing

- **Code coverage**: > 90%
- **Business logic** testing (payment processing, refunds, validation)
- **Error handling** testing (all error paths covered)
- **Mock external** dependencies (Paystack SDK)
- **Test frameworks**: Jest, Mocha

### 2. Integration Testing

- **API endpoint** testing (Supertest)
- **Database integration** testing (test database)
- **Paystack integration** testing (test mode API keys)
- **End-to-end** scenarios:
  - Complete payment flow (all channels)
  - Refund flow
  - Webhook handling
  - Multi-currency transactions
  - Saved card charging

### 3. Load Testing

- **Tool**: Apache JMeter, k6, Artillery
- **Scenarios**:
  - **Concurrent users**: 1,000+ simultaneous users
  - **Request volume**: 10,000+ requests per hour
  - **Database load**: High volume queries with read replicas
  - **Memory usage**: Stay within container limits
  - **Webhook spike**: 100+ webhooks in 1 minute
- **Success criteria**:
  - Response time stays < 500ms at peak load
  - No memory leaks over 4-hour test
  - Error rate < 0.1%

### 4. Security Testing

- **Penetration testing** (quarterly external audit)
- **Vulnerability scanning** (automated with Snyk, daily scans)
- **Authentication** testing (JWT validation, expired tokens)
- **Authorization** testing (RBAC enforcement)
- **SQL injection** prevention
- **XSS prevention**
- **Webhook signature** verification testing
- **PCI DSS compliance** validation (through Paystack)

### 5. Paystack Integration Testing

- **Test Mode**: Use Paystack test API keys for all testing
- **Test Cards**: Use Paystack provided test card numbers
  - Success: 4084084084084081
  - Insufficient funds: 5061020283705678
  - Invalid PIN: 5060990580000217403
- **Webhook Testing**: Test all webhook events in test mode
- **Currency Testing**: Test all supported currencies
- **Channel Testing**: Test all payment channels (card, bank, USSD, mobile money)

---

## 17. Infrastructure Requirements

### Required Infrastructure Components

1. **Compute**:
   - Application servers: 3+ instances (t3.medium or equivalent)
   - Worker instances: 2+ for async jobs
   - Auto-scaling: Scale from 3 to 10 instances based on CPU/memory

2. **Database**:
   - PostgreSQL 14+: Primary instance (db.t3.large)
   - Read replicas: 2 instances for read-heavy queries
   - Connection pooling: PgBouncer (max 100 connections)

3. **Caching**:
   - Redis 6+: Single instance or cluster (cache.t3.medium)
   - Use for: Session storage, rate limiting, hot data caching

4. **Message Queue**:
   - RabbitMQ cluster: 3 nodes for high availability
   - Queues: payment_events, webhook_processing, notifications

5. **Load Balancer**:
   - Application Load Balancer (ALB) or NGINX
   - SSL termination
   - Health check configuration

6. **Network**:
   - **VPC**: Private subnets for database, public for application
   - **Security groups**: Strict ingress/egress rules
   - **Public endpoint**: For Paystack webhooks

7. **Storage**:
   - **Secrets Storage**: AWS Secrets Manager or HashiCorp Vault
   - **Backup Storage**: S3 or equivalent (encrypted at rest)
   - **Log Storage**: CloudWatch Logs or ELK stack

8. **Monitoring**:
   - Prometheus + Grafana
   - Application Performance Monitoring (Datadog/New Relic)
   - Log aggregation (ELK stack)

### Environment Configuration

```yaml
# Production environment variables
NODE_ENV: production
PORT: 3000

# Database
DATABASE_URL: postgresql://user:pass@primary-db:5432/payments
DATABASE_READ_REPLICA_URL: postgresql://user:pass@replica-db:5432/payments
DATABASE_POOL_MIN: 10
DATABASE_POOL_MAX: 100

# Redis
REDIS_URL: redis://redis-cluster:6379
REDIS_TTL_DEFAULT: 300

# RabbitMQ
RABBITMQ_URL: amqp://user:pass@rabbitmq-cluster:5672
RABBITMQ_EXCHANGE: payment_events
RABBITMQ_QUEUES: payments,refunds,webhooks

# Paystack
PAYSTACK_SECRET_KEY: ${PAYSTACK_SECRET_KEY}
PAYSTACK_PUBLIC_KEY: ${PAYSTACK_PUBLIC_KEY}
PAYSTACK_WEBHOOK_URL: https://api.example.com/webhooks/paystack
PAYSTACK_CALLBACK_URL: https://app.example.com/payments/callback
PAYSTACK_API_VERSION: 2023-10-16
PAYSTACK_BASE_URL: https://api.paystack.co

# Security
JWT_SECRET: ${JWT_SECRET}
API_KEY_SALT: ${API_KEY_SALT}
ENCRYPTION_KEY: ${ENCRYPTION_KEY}

# Rate Limiting
RATE_LIMIT_WINDOW_MS: 60000
RATE_LIMIT_MAX_REQUESTS: 100
RATE_LIMIT_PAYMENT_MAX: 10

# Monitoring
SENTRY_DSN: ${SENTRY_DSN}
PROMETHEUS_PORT: 9090
LOG_LEVEL: info

# Feature Flags
ENABLE_CARD_PAYMENTS: true
ENABLE_BANK_TRANSFER: true
ENABLE_MOBILE_MONEY: true
ENABLE_USSD: true
ENABLE_MULTI_CURRENCY: true
```

---

## 18. Success Metrics

### 1. Business Metrics

- **Payment success rate**: > 95% (target)
- **Transaction volume**: Track month-over-month growth
- **Revenue impact**: Positive growth trajectory
- **Customer satisfaction**: > 4.5/5 (from surveys)
- **Average transaction value**: Track by currency
- **Refund rate**: < 2% of total transactions
- **Channel distribution**: Track usage across card/bank/mobile money

### 2. Technical Metrics

- **System uptime**: > 99.9% (SLA target)
- **Response time**: < 200ms (P95), < 500ms (P99)
- **Error rate**: < 0.1% of all requests
- **Throughput**: > 1,000 req/s during peak hours
- **Database performance**: < 100ms query latency (P95)
- **Cache hit rate**: > 80%
- **Paystack API success rate**: > 99.5%

### 3. Operational Metrics

- **Deployment frequency**: Daily (or multiple times per day)
- **Lead time**: < 1 hour (from commit to production)
- **MTTR (Mean Time To Recovery)**: < 5 minutes
- **Change failure rate**: < 5%
- **Incident count**: < 2 critical incidents per quarter

### 4. Payment Channel Metrics

- **Card payment success rate**: > 97%
- **Bank transfer completion rate**: > 90%
- **Mobile money success rate**: > 95%
- **Webhook processing success**: > 99.9%

---

## 19. Security Checklist

### Pre-Production Security Requirements

- [ ] All API endpoints require authentication
- [ ] Rate limiting implemented on all public endpoints
- [ ] Input validation on all request parameters
- [ ] SQL injection prevention (parameterized queries)
- [ ] XSS prevention (input sanitization)
- [ ] CSRF protection for state-changing operations
- [ ] Secure password hashing (bcrypt, scrypt)
- [ ] JWT token expiration and refresh logic
- [ ] HTTPS/TLS 1.3 enforced
- [ ] Database credentials stored in secrets manager
- [ ] Paystack API keys stored securely (never in code)
- [ ] API keys rotated regularly (every 90 days)
- [ ] Audit logging for all sensitive operations
- [ ] PCI DSS compliance through Paystack
- [ ] Card data never stored (Paystack tokenization only)
- [ ] Webhook signature verification implemented
- [ ] CORS configured correctly
- [ ] Security headers (HSTS, CSP, X-Frame-Options)
- [ ] Dependency vulnerability scanning automated
- [ ] Penetration testing completed
- [ ] Disaster recovery plan documented and tested

---

## 20. API Documentation

### Complete API Reference

#### POST /payments

Create a new payment transaction via Paystack.

**Request:**

```json
{
  "userId": "user_123",
  "orderId": "order_456",
  "amount": 50000,
  "currency": "NGN",
  "email": "customer@example.com",
  "channels": ["card", "bank", "ussd"],
  "metadata": {
    "customerName": "John Doe",
    "orderDescription": "Product purchase"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "paymentId": "pay_789",
    "status": "pending",
    "reference": "ref_1234567890",
    "authorizationUrl": "https://checkout.paystack.com/abc123",
    "accessCode": "abc123xyz",
    "expiresAt": "2025-09-30T13:00:00Z"
  },
  "timestamp": "2025-09-30T12:00:00Z",
  "requestId": "req_123"
}
```

#### GET /payments/verify

Verify payment status with Paystack.

**Query Parameters:**

- `reference` (required): Paystack transaction reference

**Response:**

```json
{
  "success": true,
  "data": {
    "paymentId": "pay_789",
    "status": "success",
    "amount": 50000,
    "currency": "NGN",
    "channel": "card",
    "cardType": "visa",
    "cardLast4": "4081",
    "paidAt": "2025-09-30T12:05:30Z",
    "paystackTransactionId": 1234567890
  }
}
```

#### POST /payments/{id}/refund

Process a refund through Paystack.

**Request:**

```json
{
  "amount": 50000,
  "reason": "Customer requested refund",
  "metadata": {
    "requestedBy": "support_agent_456"
  }
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "refundId": "ref_321",
    "paymentId": "pay_789",
    "amount": 50000,
    "currency": "NGN",
    "status": "processing",
    "estimatedSettlement": "2025-10-07T12:00:00Z"
  }
}
```

#### GET /payments/{id}

Retrieve payment details.

**Response:**

```json
{
  "success": true,
  "data": {
    "paymentId": "pay_789",
    "userId": "user_123",
    "orderId": "order_456",
    "amount": 50000,
    "currency": "NGN",
    "status": "success",
    "reference": "ref_1234567890",
    "channel": "card",
    "cardBrand": "visa",
    "cardLast4": "4081",
    "createdAt": "2025-09-30T12:00:00Z",
    "paidAt": "2025-09-30T12:05:30Z"
  }
}
```

#### POST /payment-methods

Save a payment method using Paystack authorization code.

**Request:**

```json
{
  "userId": "user_123",
  "authorizationCode": "AUTH_abc123xyz",
  "email": "customer@example.com"
}
```

**Response:**

```json
{
  "success": true,
  "data": {
    "paymentMethodId": "pm_456",
    "type": "card",
    "cardBrand": "visa",
    "cardLast4": "4081",
    "expiryMonth": 12,
    "expiryYear": 2027,
    "isReusable": true,
    "isDefault": false
  }
}
```

#### POST /webhooks/paystack

Handle Paystack webhook events.

**Request Headers:**

- `x-paystack-signature`: Webhook signature for verification

**Request Body:**

```json
{
  "event": "charge.success",
  "data": {
    "id": 1234567890,
    "reference": "ref_1234567890",
    "amount": 50000,
    "currency": "NGN",
    "status": "success",
    "channel": "card",
    "paid_at": "2025-09-30T12:05:30Z",
    "authorization": {
      "authorization_code": "AUTH_abc123xyz",
      "card_type": "visa",
      "last4": "4081",
      "exp_month": "12",
      "exp_year": "2027"
    }
  }
}
```

**Response:**

```json
{
  "success": true
}
```

---

## 21. Troubleshooting Guide

### Common Issues and Solutions

#### Paystack API Timeout

**Symptom**: 502 errors when initializing payments

**Diagnosis**:

1. Check Paystack status page (<https://status.paystack.com>)
2. Review Paystack API logs
3. Check circuit breaker status

**Solution**:

- Implement retry with exponential backoff
- Cache initialization responses when possible
- Enable circuit breaker pattern
- Notify customers of temporary issues

#### Webhook Not Received

**Symptom**: Payment completed but status not updated

**Diagnosis**:

1. Check webhook endpoint accessibility
2. Verify webhook URL in Paystack dashboard
3. Check webhook processing queue
4. Review application logs

**Solution**:

- Use Paystack transaction verification API
- Update payment status manually if needed
- Investigate network connectivity
- Check webhook signature verification

#### High Database Connection Count

**Symptom**: Database connection pool exhausted

**Diagnosis**:

1. Check active connections: `SELECT count(*) FROM pg_stat_activity;`
2. Identify long-running queries
3. Check for connection leaks

**Solution**:

- Increase connection pool size (temporary)
- Optimize slow queries
- Add indexes on frequently queried columns
- Implement read replicas for read-heavy operations

#### Duplicate Webhook Processing

**Symptom**: Same webhook processed multiple times

**Diagnosis**:

1. Check idempotency key implementation
2. Review webhook processing logs
3. Check for race conditions

**Solution**:

- Implement proper idempotency handling
- Use database constraints for uniqueness
- Add webhook event deduplication logic

---

## 22. Future Enhancements

### Phase 2 Features (Next 6 months)

- Subscription billing support (Paystack Subscriptions API)
- Split payments (Paystack Subaccounts)
- Payment plans and installments
- Advanced analytics dashboard
- Dispute management automation
- Multi-tenant support
- Payment link generation (Paystack Payment Pages)

### Phase 3 Features (6-12 months)

- Loyalty points integration
- Buy Now Pay Later (BNPL) integration
- Embedded payment widgets
- White-label payment solution
- Advanced fraud detection
- International expansion (new currencies)
- Apple Pay / Google Pay integration (via Paystack)

---

## 23. Paystack-Specific Best Practices

### 1. Transaction Verification

Always verify transactions server-side, never trust client-side responses:

```javascript
const verifyTransaction = async (reference) => {
    const response = await paystack.transaction.verify(reference);
    
    if (response.data.status === 'success') {
        // Update your database
        // Process order
    }
    
    return response.data;
};
```

### 2. Idempotency

Use unique references for each transaction to prevent duplicates:

```javascript
const generateReference = (orderId) => {
    const timestamp = Date.now();
    return `${orderId}_${timestamp}_${crypto.randomBytes(4).toString('hex')}`;
};
```

### 3. Webhook Security

Always verify webhook signatures:

```javascript
const verifyWebhook = (req) => {
    const hash = crypto
        .createHmac('sha512', process.env.PAYSTACK_SECRET_KEY)
        .update(JSON.stringify(req.body))
        .digest('hex');
    
    return hash === req.headers['x-paystack-signature'];
};
```

### 4. Error Handling

Handle Paystack API errors gracefully:

```javascript
try {
    const response = await paystack.transaction.initialize(payload);
    return response.data;
} catch (error) {
    if (error.response) {
        // Paystack API error
        logger.error('Paystack API error', {
            status: error.response.status,
            message: error.response.data.message
        });
    } else {
        // Network or other error
        logger.error('Payment initialization failed', error);
    }
    throw new PaymentError('Failed to initialize payment');
}
```

### 5. Rate Limiting

Respect Paystack API rate limits:

- Test mode: Unlimited
- Live mode: Depends on account tier
- Implement exponential backoff for rate limit errors

---

## 24. Conclusion

This Payment Service system design provides a comprehensive, production-ready architecture for handling payments exclusively through Paystack. The design emphasizes:

- **Simplicity**: Single payment gateway reduces complexity
- **Reliability**: 99.9% uptime with robust error handling
- **Security**: PCI DSS compliance through Paystack, webhook verification
- **Scalability**: Horizontal scaling, database partitioning, caching
- **Performance**: Sub-200ms response times, high throughput
- **Observability**: Comprehensive monitoring, logging, and tracing
- **Multi-Currency**: Support for NGN, GHS, ZAR, KES, USD
- **Multi-Channel**: Cards, bank transfers, USSD, mobile money
- **Developer Experience**: Clean APIs, comprehensive documentation

Paystack's unified API simplifies integration while providing access to multiple payment channels across African markets and beyond, making it an ideal choice for businesses targeting African customers.
