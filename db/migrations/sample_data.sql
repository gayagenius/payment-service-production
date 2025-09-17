-- Migration 003: Sample Data for Testing
-- This migration adds sample data for development and testing purposes

-- =============================================
-- SAMPLE PAYMENT METHOD TYPES
-- =============================================

INSERT INTO payment_method_types (id, code, name, description, is_active, requires_brand, requires_last4, icon_url) VALUES
(
    '550e8400-e29b-41d4-a716-446655440010',
    'CARD',
    'Credit/Debit Card',
    'Credit and debit cards including Visa, Mastercard, American Express',
    true,
    true,
    true,
    '/icons/card.svg'
),
(
    '550e8400-e29b-41d4-a716-446655440011',
    'WALLET',
    'Digital Wallet',
    'Digital wallets like Apple Pay, Google Pay, PayPal',
    true,
    false,
    false,
    '/icons/wallet.svg'
),
(
    '550e8400-e29b-41d4-a716-446655440012',
    'BANK_TRANSFER',
    'Bank Transfer',
    'Direct bank transfers and ACH payments',
    true,
    false,
    false,
    '/icons/bank.svg',
    3
);

-- =============================================
-- SAMPLE USER PAYMENT METHODS
-- =============================================

INSERT INTO user_payment_methods (id, user_id, payment_method_type_id, brand, last4, details_encrypted, is_default) VALUES
(
    '550e8400-e29b-41d4-a716-446655440001',
    '550e8400-e29b-41d4-a716-446655440000',
    '550e8400-e29b-41d4-a716-446655440010',
    'VISA',
    '4242',
    'encrypted_card_details_1',
    true
),
(
    '550e8400-e29b-41d4-a716-446655440002',
    '550e8400-e29b-41d4-a716-446655440000',
    '550e8400-e29b-41d4-a716-446655440010',
    'MASTERCARD',
    '5555',
    'encrypted_card_details_2',
    false
),
(
    '550e8400-e29b-41d4-a716-446655440003',
    '550e8400-e29b-41d4-a716-446655440100',
    '550e8400-e29b-41d4-a716-446655440011',
    NULL,
    NULL,
    'encrypted_wallet_details_1',
    true
);

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
    'FAILED'
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

INSERT INTO payments (id, user_id, order_id, amount, currency, status, payment_method_id, gateway_response, idempotency_key) VALUES
(
    '550e8400-e29b-41d4-a716-446655440101',
    '550e8400-e29b-41d4-a716-446655440000',
    '550e8400-e29b-41d4-a716-446655440200',
    2500,
    'KES',
    'SUCCEEDED',
    '550e8400-e29b-41d4-a716-446655440001',
    '{"transactionId": "txn_1234567890", "processorResponse": "approved", "authCode": "AUTH123"}',
    'idem_payment_001'
),
(
    '550e8400-e29b-41d4-a716-446655440102',
    '550e8400-e29b-41d4-a716-446655440000',
    '550e8400-e29b-41d4-a716-446655440201',
    1000,
    'KES',
    'SUCCEEDED',
    '550e8400-e29b-41d4-a716-446655440001',
    '{"transactionId": "txn_1234567891", "processorResponse": "approved", "authCode": "AUTH124"}',
    'idem_payment_002'
),
(
    '550e8400-e29b-41d4-a716-446655440103',
    '550e8400-e29b-41d4-a716-446655440000',
    '550e8400-e29b-41d4-a716-446655440202',
    5000,
    'EUR',
    'FAILED',
    '550e8400-e29b-41d4-a716-446655440002',
    '{"transactionId": "txn_1234567892", "processorResponse": "declined", "declineReason": "insufficient_funds"}',
    'idem_payment_003'
),
(
    '550e8400-e29b-41d4-a716-446655440104',
    '550e8400-e29b-41d4-a716-446655440100',
    '550e8400-e29b-41d4-a716-446655440203',
    1500,
    'KES',
    'SUCCEEDED',
    '550e8400-e29b-41d4-a716-446655440003',
    '{"transactionId": "txn_1234567893", "processorResponse": "approved", "authCode": "AUTH125"}',
    'idem_payment_004'
),
(
    '550e8400-e29b-41d4-a716-446655440105',
    '550e8400-e29b-41d4-a716-446655440000',
    '550e8400-e29b-41d4-a716-446655440204',
    750,
    'KES',
    'PENDING',
    '550e8400-e29b-41d4-a716-446655440001',
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
    'Full refund - order cancelled',
    'idem_refund_002'
),
(
    '550e8400-e29b-41d4-a716-446655440203',
    '550e8400-e29b-41d4-a716-446655440104',
    500,
    'KES',
    'PENDING',
    'Processing refund request',
    'idem_refund_003'
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
