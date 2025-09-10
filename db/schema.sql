-- Payment Service Database Schema
-- PostgreSQL 14+ compatible
-- 
-- This file contains the complete database schema for the payment service.
-- It includes all tables, constraints, indexes, and triggers.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create custom types
CREATE TYPE payment_status AS ENUM (
    'PENDING',
    'AUTHORIZED', 
    'SUCCEEDED',
    'FAILED',
    'REFUNDED',
    'PARTIALLY_REFUNDED',
    'CANCELLED'
);

CREATE TYPE refund_status AS ENUM (
    'PENDING',
    'SUCCEEDED', 
    'FAILED'
);

CREATE TYPE payment_method_type AS ENUM (
    'CARD',
    'WALLET',
    'BANK_TRANSFER'
);

-- =============================================
-- PAYMENT METHOD TYPES TABLE (Master Catalog)
-- =============================================
CREATE TABLE payment_method_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE, -- e.g., 'CARD', 'WALLET', 'BANK_TRANSFER'
    name VARCHAR(100) NOT NULL, -- e.g., 'Credit/Debit Card', 'Digital Wallet', 'Bank Transfer'
    description TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    requires_brand BOOLEAN NOT NULL DEFAULT false, -- e.g., CARD requires brand (VISA, MASTERCARD)
    requires_last4 BOOLEAN NOT NULL DEFAULT false, -- e.g., CARD requires last4 digits
    icon_url VARCHAR(255) NULL, -- URL to payment method icon
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================
-- USER PAYMENT METHODS TABLE (User's Saved Methods)
-- =============================================
CREATE TABLE user_payment_methods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    payment_method_type_id UUID NOT NULL REFERENCES payment_method_types(id),
    brand VARCHAR(50) NULL, -- e.g., VISA, MASTERCARD
    last4 VARCHAR(4) NULL, -- last 4 digits of card number
    details_encrypted TEXT NOT NULL, -- KMS-managed encrypted details
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Constraints
    CONSTRAINT chk_user_payment_methods_last4 CHECK (
        last4 IS NULL OR (last4 ~ '^[0-9]{4}$')
    ),
    CONSTRAINT chk_user_payment_methods_brand CHECK (
        brand IS NULL OR length(trim(brand)) > 0
    )
);

-- =============================================
-- PAYMENTS TABLE
-- =============================================
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    order_id VARCHAR(255) NOT NULL, -- required - each payment must be tied to an order
    amount INTEGER NOT NULL,
    currency CHAR(3) NOT NULL,
    status payment_status NOT NULL DEFAULT 'PENDING',
    payment_method_id UUID NULL REFERENCES user_payment_methods(id),
    gateway_response JSONB NOT NULL DEFAULT '{}',
    idempotency_key VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Constraints
    CONSTRAINT chk_payments_amount CHECK (amount > 0),
    CONSTRAINT chk_payments_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT chk_payments_idempotency_key CHECK (
        idempotency_key IS NULL OR length(idempotency_key) > 0
    )
);

-- =============================================
-- REFUNDS TABLE
-- =============================================
CREATE TABLE refunds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID NOT NULL REFERENCES payments(id),
    amount INTEGER NOT NULL,
    currency CHAR(3) NOT NULL,
    status refund_status NOT NULL DEFAULT 'PENDING',
    reason TEXT NULL,
    idempotency_key VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Constraints
    CONSTRAINT chk_refunds_amount CHECK (amount > 0),
    CONSTRAINT chk_refunds_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT chk_refunds_idempotency_key CHECK (
        idempotency_key IS NULL OR length(idempotency_key) > 0
    ),
    CONSTRAINT chk_refunds_reason CHECK (
        reason IS NULL OR length(trim(reason)) > 0
    )
);

-- =============================================
-- UNIQUE CONSTRAINTS
-- =============================================

-- Ensure idempotency keys are unique when present
CREATE UNIQUE INDEX idx_payments_idempotency_key 
ON payments(idempotency_key) 
WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX idx_refunds_idempotency_key 
ON refunds(idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- =============================================
-- INDEXES FOR PERFORMANCE
-- =============================================

-- Payment method type indexes
CREATE INDEX idx_payment_method_types_code ON payment_method_types(code);
CREATE INDEX idx_payment_method_types_active ON payment_method_types(is_active);

-- User payment method indexes
CREATE INDEX idx_user_payment_methods_user_id ON user_payment_methods(user_id);
CREATE INDEX idx_user_payment_methods_user_default ON user_payment_methods(user_id, is_default DESC, created_at DESC);
CREATE INDEX idx_user_payment_methods_type_id ON user_payment_methods(payment_method_type_id);
CREATE INDEX idx_user_payment_methods_active ON user_payment_methods(user_id, is_active, created_at DESC);

-- Payment indexes
CREATE INDEX idx_payments_user_id_created ON payments(user_id, created_at DESC);
CREATE INDEX idx_payments_status_created ON payments(status, created_at DESC);
CREATE INDEX idx_payments_payment_method_id ON payments(payment_method_id) WHERE payment_method_id IS NOT NULL;

-- Refund indexes
CREATE INDEX idx_refunds_payment_id_created ON refunds(payment_id, created_at DESC);
CREATE INDEX idx_refunds_status ON refunds(status);

-- =============================================
-- TRIGGERS FOR UPDATED_AT
-- =============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at

CREATE TRIGGER update_payment_method_types_updated_at 
    BEFORE UPDATE ON payment_method_types 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_payment_methods_updated_at 
    BEFORE UPDATE ON user_payment_methods 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_payments_updated_at 
    BEFORE UPDATE ON payments 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_refunds_updated_at 
    BEFORE UPDATE ON refunds 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- VIEWS FOR COMMON QUERIES
-- =============================================

-- View for payment summary with refund information
CREATE VIEW payment_summary AS
SELECT 
    p.id,
    p.user_id,
    p.order_id,
    p.amount,
    p.currency,
    p.status,
    p.payment_method_id,
    p.created_at,
    p.updated_at,
    COALESCE(SUM(r.amount), 0) as total_refunded,
    CASE 
        WHEN COALESCE(SUM(r.amount), 0) = 0 THEN 'NONE'
        WHEN COALESCE(SUM(r.amount), 0) = p.amount THEN 'FULL'
        ELSE 'PARTIAL'
    END as refund_status
FROM payments p
LEFT JOIN refunds r ON p.id = r.payment_id AND r.status = 'SUCCEEDED'
GROUP BY p.id, p.user_id, p.order_id, p.amount, p.currency, 
         p.status, p.payment_method_id, p.created_at, p.updated_at;

-- =============================================
-- FUNCTIONS FOR BUSINESS LOGIC
-- =============================================

-- Function to get total refunded amount for a payment
CREATE OR REPLACE FUNCTION get_total_refunded(payment_uuid UUID)
RETURNS INTEGER AS $$
DECLARE
    total_refunded INTEGER;
BEGIN
    SELECT COALESCE(SUM(amount), 0)
    INTO total_refunded
    FROM refunds 
    WHERE payment_id = payment_uuid 
    AND status = 'SUCCEEDED';
    
    RETURN total_refunded;
END;
$$ LANGUAGE plpgsql;

-- Function to check if payment can be refunded
CREATE OR REPLACE FUNCTION can_refund_payment(payment_uuid UUID, refund_amount INTEGER)
RETURNS BOOLEAN AS $$
DECLARE
    payment_amount INTEGER;
    total_refunded INTEGER;
BEGIN
    -- Get payment amount
    SELECT amount INTO payment_amount
    FROM payments 
    WHERE id = payment_uuid;
    
    -- Check if payment exists
    IF payment_amount IS NULL THEN
        RETURN FALSE;
    END IF;
    
    -- Get total refunded amount
    SELECT get_total_refunded(payment_uuid) INTO total_refunded;
    
    -- Check if refund amount is valid
    RETURN (total_refunded + refund_amount) <= payment_amount;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- COMMENTS
-- =============================================

COMMENT ON TABLE payment_method_types IS 'Master catalog of supported payment method types';
COMMENT ON TABLE user_payment_methods IS 'Stores encrypted payment method information for users';
COMMENT ON TABLE payments IS 'Main payments table storing all payment transactions';
COMMENT ON TABLE refunds IS 'Stores refund information for payments';

COMMENT ON COLUMN user_payment_methods.details_encrypted IS 'KMS-managed encrypted payment method details (never store raw PAN)';
COMMENT ON COLUMN payments.amount IS 'Amount in minor units (e.g., cents) to avoid floating point issues';
COMMENT ON COLUMN payments.gateway_response IS 'Gateway response data (masked, no sensitive information)';
COMMENT ON COLUMN payments.idempotency_key IS 'Unique key for idempotent payment requests';
COMMENT ON COLUMN refunds.idempotency_key IS 'Unique key for idempotent refund requests';
