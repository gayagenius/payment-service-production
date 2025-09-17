-- Migration: Payment Service Schema
-- This migration creates the complete database schema for the payment service
-- Includes: tables, indexes, constraints, triggers, and comments

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";


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

-- =============================================
-- TABLES
-- =============================================

-- Payment Method Types (Master Catalog)
CREATE TABLE payment_method_types (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code VARCHAR(50) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description TEXT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    requires_brand BOOLEAN NOT NULL DEFAULT false,
    requires_last4 BOOLEAN NOT NULL DEFAULT false,
    icon_url VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- User Payment Methods (User's Saved Methods)
CREATE TABLE user_payment_methods (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    payment_method_type_id UUID NOT NULL REFERENCES payment_method_types(id),
    brand VARCHAR(50) NULL,
    last4 VARCHAR(4) NULL,
    details_encrypted TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT chk_user_payment_methods_last4 CHECK (
        last4 IS NULL OR (last4 ~ '^[0-9]{4}$')
    ),
    CONSTRAINT chk_user_payment_methods_brand CHECK (
        brand IS NULL OR length(trim(brand)) > 0
    )
);


-- Payments
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL,
    order_id VARCHAR(255) NOT NULL,
    amount INTEGER NOT NULL,
    currency CHAR(3) NOT NULL,
    status payment_status NOT NULL DEFAULT 'PENDING',
    payment_method_id UUID NULL REFERENCES user_payment_methods(id),
    gateway_response JSONB NOT NULL DEFAULT '{}',
    idempotency_key VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT chk_payments_amount CHECK (amount > 0),
    CONSTRAINT chk_payments_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT chk_payments_idempotency_key CHECK (
        idempotency_key IS NULL OR length(idempotency_key) > 0
    )
);

-- Payment History (Audit Trail)
CREATE TABLE payment_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID NOT NULL REFERENCES payments(id),
    status payment_status NOT NULL,
    previous_status payment_status NULL,
    changed_by UUID NULL,
    change_reason TEXT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    CONSTRAINT chk_payment_history_reason CHECK (
        change_reason IS NULL OR length(trim(change_reason)) > 0
    )
);

-- Refunds
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
-- INDEXES
-- =============================================

-- Payment Method Types
CREATE INDEX idx_payment_method_types_code ON payment_method_types(code);
CREATE INDEX idx_payment_method_types_active ON payment_method_types(is_active);

-- User Payment Methods
CREATE INDEX idx_user_payment_methods_user_id ON user_payment_methods(user_id);
CREATE INDEX idx_user_payment_methods_user_default ON user_payment_methods(user_id, is_default DESC, created_at DESC);
CREATE INDEX idx_user_payment_methods_type_id ON user_payment_methods(payment_method_type_id);
CREATE INDEX idx_user_payment_methods_active ON user_payment_methods(user_id, is_active, created_at DESC);


-- Payments
CREATE INDEX idx_payments_user_id_created ON payments(user_id, created_at DESC);
CREATE INDEX idx_payments_order_id ON payments(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_payments_status_created ON payments(status, created_at DESC);
CREATE INDEX idx_payments_payment_method_id ON payments(payment_method_id) WHERE payment_method_id IS NOT NULL;

-- Payment History
CREATE INDEX idx_payment_history_payment_id_created ON payment_history(payment_id, created_at DESC);
CREATE INDEX idx_payment_history_status ON payment_history(status);
CREATE INDEX idx_payment_history_changed_by ON payment_history(changed_by) WHERE changed_by IS NOT NULL;

-- Refunds
CREATE INDEX idx_refunds_payment_id_created ON refunds(payment_id, created_at DESC);
CREATE INDEX idx_refunds_status ON refunds(status);

-- =============================================
-- UNIQUE CONSTRAINTS
-- =============================================

-- Idempotency keys (unique when present)
CREATE UNIQUE INDEX idx_payments_idempotency_key 
ON payments(idempotency_key) 
WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX idx_refunds_idempotency_key 
ON refunds(idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- =============================================
-- TRIGGERS
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

-- Function to create payment history entry
CREATE OR REPLACE FUNCTION create_payment_history_entry()
RETURNS TRIGGER AS $$
BEGIN
    -- Only create history entry if status changed
    IF OLD.status IS DISTINCT FROM NEW.status THEN
        INSERT INTO payment_history (
            payment_id, 
            status, 
            previous_status, 
            changed_by, 
            change_reason, 
            metadata
        ) VALUES (
            NEW.id,
            NEW.status,
            OLD.status,
            NULL, -- changed_by will be set by application
            'Status changed from ' || OLD.status || ' to ' || NEW.status,
            jsonb_build_object(
                'old_status', OLD.status,
                'new_status', NEW.status,
                'updated_at', NEW.updated_at
            )
        );
    END IF;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to create payment history entries
CREATE TRIGGER create_payment_history_trigger
    AFTER UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION create_payment_history_entry();

CREATE TRIGGER update_refunds_updated_at 
    BEFORE UPDATE ON refunds 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- COMMENTS
-- =============================================

COMMENT ON TABLE payment_method_types IS 'Master catalog of supported payment method types';
COMMENT ON TABLE user_payment_methods IS 'Stores encrypted payment method information for users';
COMMENT ON TABLE payments IS 'Main payments table storing all payment transactions';
COMMENT ON TABLE payment_history IS 'Audit trail for payment status changes and transaction history';
COMMENT ON TABLE refunds IS 'Stores refund information for payments';

COMMENT ON COLUMN user_payment_methods.details_encrypted IS 'KMS-managed encrypted payment method details (never store raw PAN)';
COMMENT ON COLUMN payments.amount IS 'Amount in minor units (e.g., cents for KES) to avoid floating point issues';
COMMENT ON COLUMN payments.gateway_response IS 'Gateway response data (masked, no sensitive information)';
COMMENT ON COLUMN payments.idempotency_key IS 'Unique key for idempotent payment requests';
COMMENT ON COLUMN refunds.idempotency_key IS 'Unique key for idempotent refund requests';
