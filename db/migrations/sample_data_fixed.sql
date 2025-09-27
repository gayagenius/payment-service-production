-- Migration 003: Sample Data for Testing (Fixed)
-- This migration adds sample data for development and testing purposes

-- Payment method sample data removed - payment methods are now handled by the gateway directly

-- =============================================
-- SAMPLE ORDERS
-- =============================================

INSERT INTO orders (id, user_id, order_number, total_amount, currency, status) VALUES
(
    '550e8400-e29b-41d4-a716-446655440200',
    '550e8400-e29b-41d4-a716-446655440000',
    'ORD-2024-001',
    2500,
    'KES',
    'COMPLETED'
),
(
    '550e8400-e29b-41d4-a716-446655440201',
    '550e8400-e29b-41d4-a716-446655440000',
    'ORD-2024-002',
    1000,
    'KES',
    'COMPLETED'
),
(
    '550e8400-e29b-41d4-a716-446655440202',
    '550e8400-e29b-41d4-a716-446655440000',
    'ORD-2024-003',
    5000,
    'EUR',
    'CANCELLED'
),
(
    '550e8400-e29b-41d4-a716-446655440203',
    '550e8400-e29b-41d4-a716-446655440100',
    'ORD-2024-004',
    1500,
    'KES',
    'COMPLETED'
),
(
    '550e8400-e29b-41d4-a716-446655440204',
    '550e8400-e29b-41d4-a716-446655440000',
    'ORD-2024-005',
    750,
    'KES',
    'PENDING'
);

-- =============================================
-- SAMPLE PAYMENTS
-- =============================================

INSERT INTO payments (id, user_id, order_id, amount, currency, status, gateway_response, idempotency_key) VALUES
(
    '550e8400-e29b-41d4-a716-446655440101',
    '550e8400-e29b-41d4-a716-446655440000',
    'ORD-2024-001',
    2500,
    'KES',
    'SUCCEEDED',
    '{"transactionId": "txn_1234567890", "processorResponse": "approved", "authCode": "AUTH123"}',
    'idem_payment_001'
),
(
    '550e8400-e29b-41d4-a716-446655440102',
    '550e8400-e29b-41d4-a716-446655440000',
    'ORD-2024-002',
    1000,
    'KES',
    'SUCCEEDED',
    '{"transactionId": "txn_1234567891", "processorResponse": "approved", "authCode": "AUTH124"}',
    'idem_payment_002'
),
(
    '550e8400-e29b-41d4-a716-446655440103',
    '550e8400-e29b-41d4-a716-446655440000',
    'ORD-2024-003',
    5000,
    'EUR',
    'FAILED',
    '{"transactionId": "txn_1234567892", "processorResponse": "declined", "declineReason": "insufficient_funds"}',
    'idem_payment_003'
),
(
    '550e8400-e29b-41d4-a716-446655440104',
    '550e8400-e29b-41d4-a716-446655440100',
    'ORD-2024-004',
    1500,
    'KES',
    'SUCCEEDED',
    '{"transactionId": "txn_1234567893", "processorResponse": "approved", "authCode": "AUTH125"}',
    'idem_payment_004'
),
(
    '550e8400-e29b-41d4-a716-446655440105',
    '550e8400-e29b-41d4-a716-446655440000',
    'ORD-2024-005',
    750,
    'KES',
    'PENDING',
    '{}',
    'idem_payment_005'
);

-- =============================================
-- SAMPLE REFUNDS
-- =============================================

INSERT INTO refunds (id, payment_id, amount, currency, status, reason, idempotency_key) VALUES
(
    '550e8400-e29b-41d4-a716-446655440201',
    '550e8400-e29b-41d4-a716-446655440101',
    1000,
    'KES',
    'SUCCEEDED',
    'Customer requested partial refund for defective item',
    'idem_refund_001'
),
(
    '550e8400-e29b-41d4-a716-446655440202',
    '550e8400-e29b-41d4-a716-446655440102',
    1000,
    'KES',
    'SUCCEEDED',
    'Customer requested full refund',
    'idem_refund_002'
);

-- =============================================
-- SAMPLE PAYMENT HISTORY
-- =============================================

INSERT INTO payment_history (id, payment_id, status, changed_by, created_at, updated_at, metadata) VALUES
(
    '550e8400-e29b-41d4-a716-446655440301',
    '550e8400-e29b-41d4-a716-446655440101',
    'PENDING',
    'system',
    '2024-01-15T10:00:00Z',
    '2024-01-15T10:00:00Z',
    '{"old_status": null, "new_status": "PENDING", "updated_at": "2024-01-15T10:00:00Z", "payment_details": {"user_id": "550e8400-e29b-41d4-a716-446655440000", "order_id": "ORD-2024-001", "amount": 2500, "currency": "KES", "idempotency_key": "idem_001"}, "order_details": {"id": "ORD-2024-001", "description": "Premium subscription", "items": ["Premium Plan"], "totalItems": 1, "shippingAddress": "Nairobi, Kenya"}, "user_details": {"id": "550e8400-e29b-41d4-a716-446655440000", "email": "user@example.com", "name": "John Doe", "phone": "+254712345678"}}'
),
(
    '550e8400-e29b-41d4-a716-446655440302',
    '550e8400-e29b-41d4-a716-446655440101',
    'SUCCEEDED',
    'system',
    '2024-01-15T10:30:00Z',
    '2024-01-15T10:30:00Z',
    '{"old_status": "PENDING", "new_status": "SUCCEEDED", "updated_at": "2024-01-15T10:30:00Z", "payment_details": {"user_id": "550e8400-e29b-41d4-a716-446655440000", "order_id": "ORD-2024-001", "amount": 2500, "currency": "KES", "idempotency_key": "idem_001"}, "order_details": {"id": "ORD-2024-001", "description": "Premium subscription", "items": ["Premium Plan"], "totalItems": 1, "shippingAddress": "Nairobi, Kenya"}, "user_details": {"id": "550e8400-e29b-41d4-a716-446655440000", "email": "user@example.com", "name": "John Doe", "phone": "+254712345678"}}'
),
(
    '550e8400-e29b-41d4-a716-446655440303',
    '550e8400-e29b-41d4-a716-446655440103',
    'PENDING',
    'system',
    '2024-01-15T10:45:00Z',
    '2024-01-15T10:45:00Z',
    '{"old_status": null, "new_status": "PENDING", "updated_at": "2024-01-15T10:45:00Z", "payment_details": {"user_id": "550e8400-e29b-41d4-a716-446655440000", "order_id": "ORD-2024-003", "amount": 3000, "currency": "EUR", "idempotency_key": "idem_003"}, "order_details": {"id": "ORD-2024-003", "description": "Failed payment test", "items": ["Test Item"], "totalItems": 1, "shippingAddress": "Test Address"}, "user_details": {"id": "550e8400-e29b-41d4-a716-446655440000", "email": "user@example.com", "name": "John Doe", "phone": "+254712345678"}}'
),
(
    '550e8400-e29b-41d4-a716-446655440304',
    '550e8400-e29b-41d4-a716-446655440103',
    'FAILED',
    'system',
    '2024-01-15T11:00:00Z',
    '2024-01-15T11:00:00Z',
    '{"old_status": "PENDING", "new_status": "FAILED", "updated_at": "2024-01-15T11:00:00Z", "payment_details": {"user_id": "550e8400-e29b-41d4-a716-446655440000", "order_id": "ORD-2024-003", "amount": 3000, "currency": "EUR", "idempotency_key": "idem_003"}, "order_details": {"id": "ORD-2024-003", "description": "Failed payment test", "items": ["Test Item"], "totalItems": 1, "shippingAddress": "Test Address"}, "user_details": {"id": "550e8400-e29b-41d4-a716-446655440000", "email": "user@example.com", "name": "John Doe", "phone": "+254712345678"}}'
);

-- =============================================
-- VERIFICATION QUERIES
-- =============================================

-- Check data counts
SELECT 'Orders' as table_name, COUNT(*) as count FROM orders
UNION ALL
SELECT 'Payments', COUNT(*) FROM payments
UNION ALL
SELECT 'Refunds', COUNT(*) FROM refunds
UNION ALL
SELECT 'Payment History', COUNT(*) FROM payment_history;