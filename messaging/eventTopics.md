# Payment Event Topics Documentation

## Overview
This document defines the standardized event topics used across the payment service for asynchronous communication and event-driven architecture.

## Payment Event Topics

### 1. payment_initiated
**Description**: Published when a payment request is initiated by a user.

**Routing Key**: `payment_initiated`

**Payload Schema**:
```json
{
  "eventType": "payment_initiated",
  "timestamp": "2024-01-15T10:30:00.000Z",
  "paymentId": "pay_1234567890",
  "orderId": "ord_9876543210", 
  "userId": "user_abcdef123456",
  "amount": 2999,
  "currency": "USD",
  "status": "pending",
  "correlationId": "corr_xyz789abc",
  "paymentMethod": {
    "type": "card",
    "last4": "4242"
  },
  "metadata": {
    "source": "web",
    "userAgent": "Mozilla/5.0...",
    "ipAddress": "192.168.1.100"
  }
}
```

**Consumers**:
- Order Service (to update order status)
- Analytics Service (for tracking)
- Notification Service (to send confirmations)

---

### 2. payment_completed
**Description**: Published when a payment is successfully processed and completed.

**Routing Key**: `payment_completed`

**Payload Schema**:
```json
{
  "eventType": "payment_completed",
  "timestamp": "2024-01-15T10:32:15.000Z",
  "paymentId": "pay_1234567890",
  "orderId": "ord_9876543210",
  "userId": "user_abcdef123456", 
  "amount": 2999,
  "currency": "USD",
  "status": "succeeded",
  "correlationId": "corr_xyz789abc",
  "gatewayResponse": {
    "transactionId": "txn_stripe_ch_3N4...",
    "processingTime": 1250,
    "authCode": "123456"
  },
  "fees": {
    "platformFee": 89,
    "gatewayFee": 30
  }
}
```

**Consumers**:
- Order Service (to fulfill order)
- Inventory Service (to update stock)
- Accounting Service (for revenue tracking)
- Email Service (to send receipts)

---

### 3. payment_failed
**Description**: Published when a payment fails due to various reasons (insufficient funds, card declined, etc.).

**Routing Key**: `payment_failed`

**Payload Schema**:
```json
{
  "eventType": "payment_failed",
  "timestamp": "2024-01-15T10:31:45.000Z", 
  "paymentId": "pay_1234567890",
  "orderId": "ord_9876543210",
  "userId": "user_abcdef123456",
  "amount": 2999,
  "currency": "USD", 
  "status": "failed",
  "correlationId": "corr_xyz789abc",
  "error": {
    "code": "card_declined",
    "message": "Your card was declined.",
    "declineCode": "generic_decline", 
    "gatewayCode": "declined"
  },
  "retryable": false,
  "attemptCount": 1
}
```

**Consumers**:
- Order Service (to cancel/retry order)
- Analytics Service (for failure tracking)
- Notification Service (to notify user of failure)
- Fraud Service (for pattern analysis)

---

### 4. refund_processed
**Description**: Published when a refund is successfully processed for a payment.

**Routing Key**: `refund_processed`

**Payload Schema**:
```json
{
  "eventType": "refund_processed",
  "timestamp": "2024-01-16T14:20:30.000Z",
  "refundId": "ref_1234567890",
  "paymentId": "pay_1234567890", 
  "orderId": "ord_9876543210",
  "userId": "user_abcdef123456",
  "amount": 1500,
  "currency": "USD",
  "status": "succeeded", 
  "correlationId": "corr_refund_abc123",
  "reason": "requested_by_customer",
  "refundType": "partial",
  "gatewayResponse": {
    "refundId": "re_stripe_3N4...",
    "processingTime": 800
  },
  "originalPayment": {
    "amount": 2999,
    "date": "2024-01-15T10:32:15.000Z"
  }
}
```

**Consumers**:
- Order Service (to update order refund status)
- Inventory Service (to restock items if applicable) 
- Accounting Service (for refund accounting)
- Customer Service (for ticket updates)

## Message Properties

### Standard Headers
All messages include these standard properties:
- `messageId`: Unique identifier for the message
- `correlationId`: For tracing related messages
- `timestamp`: When the event occurred (ISO 8601)
- `version`: Schema version (e.g., "v1.0")

### Delivery Guarantees
- **Durability**: All exchanges and queues are durable
- **Persistence**: All messages are marked as persistent
- **Acknowledgment**: Manual acknowledgment required
- **Dead Letter Queue**: Failed messages go to `payment_events_dlq`

## Queue Configuration

### Exchange Details
- **Name**: `payment_events`
- **Type**: `topic`
- **Durable**: `true`
- **Auto Delete**: `false`

### Queue Naming Convention
- Pattern: `{topic_name}_queue`
- Examples: 
  - `payment_initiated_queue`
  - `payment_completed_queue` 
  - `payment_failed_queue`
  - `refund_processed_queue`

### Dead Letter Queue
- **Exchange**: `payment_events_dlq`
- **Queue**: `payment_events_dead_letter`
- **TTL**: 24 hours

## Consumer Guidelines

### Best Practices
1. **Idempotency**: Always handle duplicate messages gracefully
2. **Error Handling**: Implement proper retry logic with exponential backoff
3. **Monitoring**: Log all message processing with correlation IDs
4. **Schema Validation**: Validate incoming message schemas
5. **Graceful Degradation**: Handle missing optional fields

### Error Handling
- Transient errors: Retry with exponential backoff (max 3 retries)
- Permanent errors: Send to dead letter queue immediately
- Unknown errors: Log and send to dead letter queue after max retries

### Performance Considerations
- **Prefetch Count**: Set to 10 for balanced throughput
- **Connection Pooling**: Reuse connections across consumers
- **Batch Processing**: Process multiple messages in batches where possible

## Schema Versioning

### Version Strategy
- Backward compatible changes: Increment patch version
- New optional fields: Increment minor version  
- Breaking changes: Increment major version

### Migration Process
1. Deploy new version alongside old version
2. Gradually migrate consumers to new version
3. Monitor for errors and rollback if needed
4. Remove old version after all consumers migrated

## Monitoring & Alerting

### Key Metrics
- Message publish rate per topic
- Message consumption rate per queue
- Dead letter queue message count
- Consumer lag per queue
- Processing time per message type

### Alerts
- Dead letter queue depth > 100 messages
- Consumer lag > 5 minutes
- Message processing errors > 1% rate
- Queue depth growing continuously

## Example Usage

### Publishing Events
```javascript
import { publish, PAYMENT_TOPICS } from './queueSetup.js';

await publish(PAYMENT_TOPICS.PAYMENT_INITIATED, {
  eventType: 'payment_initiated',
  paymentId: 'pay_123',
});
```

### Subscribing to Events  
```javascript
import { subscribe, PAYMENT_TOPICS } from './queueSetup.js';

// Subscribe to payment completed events
await subscribe(PAYMENT_TOPICS.PAYMENT_COMPLETED, async (payload, msg) => {
  console.log('Payment completed:', payload.paymentId);
});
```