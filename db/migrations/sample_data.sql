-- Migration 003: Sample Data for Testing
-- This migration adds sample data for development and testing purposes

-- Payment method sample data removed - payment methods are now handled by the gateway directly

-- =============================================
-- SAMPLE PAYMENTS
-- =============================================

INSERT INTO payments (id, user_id, order_id, amount, currency, status, gateway_response, idempotency_key, metadata) VALUES
(
    '550e8400-e29b-41d4-a716-446655440101',
    '550e8400-e29b-41d4-a716-446655440000',
    'ORD-2024-001',
    2500,
    'KES',
    'SUCCEEDED',
    '{"transactionId": "txn_1234567890", "processorResponse": "approved", "authCode": "AUTH123", "status": "success"}',
    'idem_payment_001',
    '{"user": {"id": "550e8400-e29b-41d4-a716-446655440000", "email": "john.doe@example.com", "name": "John Doe", "phone": "+254712345678"}, "order": {"id": "ORD-2024-001", "description": "Premium subscription", "items": ["Premium Plan"], "totalItems": 1}, "description": "Monthly premium subscription", "source": "web"}'
),
(
    '550e8400-e29b-41d4-a716-446655440102',
    '550e8400-e29b-41d4-a716-446655440000',
    'ORD-2024-002',
    1000,
    'KES',
    'SUCCEEDED',
    '{"transactionId": "txn_1234567891", "processorResponse": "approved", "authCode": "AUTH124", "status": "success"}',
    'idem_payment_002',
    '{"user": {"id": "550e8400-e29b-41d4-a716-446655440000", "email": "john.doe@example.com", "name": "John Doe", "phone": "+254712345678"}, "order": {"id": "ORD-2024-002", "description": "Basic plan", "items": ["Basic Plan"], "totalItems": 1}, "description": "Monthly basic subscription", "source": "mobile"}'
),
(
    '550e8400-e29b-41d4-a716-446655440103',
    '550e8400-e29b-41d4-a716-446655440000',
    'ORD-2024-003',
    5000,
    'KES',
    'FAILED',
    '{"transactionId": "txn_1234567892", "processorResponse": "declined", "authCode": null, "status": "failed", "declineReason": "Insufficient funds"}',
    'idem_payment_003',
    '{"user": {"id": "550e8400-e29b-41d4-a716-446655440000", "email": "john.doe@example.com", "name": "John Doe", "phone": "+254712345678"}, "order": {"id": "ORD-2024-003", "description": "Enterprise plan", "items": ["Enterprise Plan"], "totalItems": 1}, "description": "Monthly enterprise subscription", "source": "web"}'
),
(
    '550e8400-e29b-41d4-a716-446655440104',
    '550e8400-e29b-41d4-a716-446655440100',
    'ORD-2024-004',
    1500,
    'KES',
    'SUCCEEDED',
    '{"transactionId": "txn_1234567893", "processorResponse": "approved", "authCode": "AUTH125", "status": "success"}',
    'idem_payment_004',
    '{"user": {"id": "550e8400-e29b-41d4-a716-446655440100", "email": "jane.smith@example.com", "name": "Jane Smith", "phone": "+254723456789"}, "order": {"id": "ORD-2024-004", "description": "Pro plan", "items": ["Pro Plan"], "totalItems": 1}, "description": "Monthly pro subscription", "source": "web"}'
),
(
    '550e8400-e29b-41d4-a716-446655440105',
    '550e8400-e29b-41d4-a716-446655440000',
    'ORD-2024-005',
    750,
    'KES',
    'PENDING',
    '{}',
    'idem_payment_005',
    '{"user": {"id": "550e8400-e29b-41d4-a716-446655440000", "email": "john.doe@example.com", "name": "John Doe", "phone": "+254712345678"}, "order": {"id": "ORD-2024-005", "description": "Starter plan", "items": ["Starter Plan"], "totalItems": 1}, "description": "Monthly starter subscription", "source": "mobile"}'
);

-- =============================================
-- SAMPLE PAYMENT HISTORY
-- =============================================

INSERT INTO payment_history (payment_id, status, metadata) VALUES
('550e8400-e29b-41d4-a716-446655440101', 'PENDING', '{"source": "web", "description": "Payment initiated"}'),
('550e8400-e29b-41d4-a716-446655440101', 'SUCCEEDED', '{"source": "web", "description": "Payment completed successfully"}'),
('550e8400-e29b-41d4-a716-446655440102', 'PENDING', '{"source": "mobile", "description": "Payment initiated"}'),
('550e8400-e29b-41d4-a716-446655440102', 'SUCCEEDED', '{"source": "mobile", "description": "Payment completed successfully"}'),
('550e8400-e29b-41d4-a716-446655440103', 'PENDING', '{"source": "web", "description": "Payment initiated"}'),
('550e8400-e29b-41d4-a716-446655440103', 'FAILED', '{"source": "web", "description": "Payment failed - insufficient funds"}'),
('550e8400-e29b-41d4-a716-446655440104', 'PENDING', '{"source": "web", "description": "Payment initiated"}'),
('550e8400-e29b-41d4-a716-446655440104', 'SUCCEEDED', '{"source": "web", "description": "Payment completed successfully"}'),
('550e8400-e29b-41d4-a716-446655440105', 'PENDING', '{"source": "mobile", "description": "Payment initiated"}');

-- =============================================
-- SAMPLE REFUNDS
-- =============================================

INSERT INTO refunds (id, payment_id, amount, currency, status, reason, idempotency_key, gateway_response, metadata) VALUES
(
    '550e8400-e29b-41d4-a716-446655440201',
    '550e8400-e29b-41d4-a716-446655440101',
    1000,
    'KES',
    'SUCCEEDED',
    'Customer requested partial refund for defective item',
    'idem_refund_001',
    '{"refundId": "ref_1234567890", "status": "success", "processedAt": "2024-01-15T10:30:00Z"}',
    '{"reason": "defective_item", "source": "customer_service", "description": "Partial refund for defective item"}'
),
(
    '550e8400-e29b-41d4-a716-446655440202',
    '550e8400-e29b-41d4-a716-446655440102',
    1000,
    'KES',
    'SUCCEEDED',
    'Full refund - order cancelled',
    'idem_refund_002',
    '{"refundId": "ref_1234567891", "status": "success", "processedAt": "2024-01-16T14:20:00Z"}',
    '{"reason": "order_cancelled", "source": "customer_service", "description": "Full refund for cancelled order"}'
),
(
    '550e8400-e29b-41d4-a716-446655440203',
    '550e8400-e29b-41d4-a716-446655440104',
    500,
    'KES',
    'PENDING',
    'Processing refund request',
    'idem_refund_003',
    '{}',
    '{"reason": "customer_request", "source": "web", "description": "Refund request being processed"}'
);

-- =============================================
-- UPDATE PAYMENT STATUSES BASED ON REFUNDS
-- =============================================

-- Update payment status to PARTIALLY_REFUNDED for payment with partial refund
UPDATE payments 
SET status = 'PARTIALLY_REFUNDED' 
WHERE id = '550e8400-e29b-41d4-a716-446655440101';

-- Update payment status to REFUNDED for payment with full refund
UPDATE payments 
SET status = 'REFUNDED' 
WHERE id = '550e8400-e29b-41d4-a716-446655440102';

-- =============================================
-- SAMPLE DATA SUMMARY
-- =============================================

-- The sample data includes:
-- - 3 payment method types (CARD, WALLET, BANK_TRANSFER) in master catalog
-- - 3 user payment methods (2 cards, 1 wallet) for 2 users
-- - 5 orders with various statuses and currencies
-- - 5 payments with various statuses and currencies (all tied to orders)
-- - 3 refunds (2 succeeded, 1 pending)
-- - Proper relationships and constraints
-- - Realistic amounts and metadata
-- - Idempotency keys for testing
