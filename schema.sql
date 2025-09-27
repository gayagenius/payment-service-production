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

-- Payment method types removed - handled by payment gateway

-- Payment method types table removed - handled by payment gateway

-- User payment methods table removed - handled by payment gateway

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
-- PAYMENT HISTORY TABLE (Audit Trail)
-- =============================================
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

-- Payment method indexes removed - handled by payment gateway

-- Payment indexes
CREATE INDEX idx_payments_user_id_created ON payments(user_id, created_at DESC);
CREATE INDEX idx_payments_status_created ON payments(status, created_at DESC);
-- Payment method index removed - handled by payment gateway

-- Payment history indexes
CREATE INDEX idx_payment_history_payment_id_created ON payment_history(payment_id, created_at DESC);
CREATE INDEX idx_payment_history_status ON payment_history(status);
CREATE INDEX idx_payment_history_changed_by ON payment_history(changed_by) WHERE changed_by IS NOT NULL;

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

-- Payment method triggers removed - handled by payment gateway

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
                'updated_at', NEW.updated_at,
                'payment_details', jsonb_build_object(
                    'user_id', NEW.user_id,
                    'order_id', NEW.order_id,
                    'amount', NEW.amount,
                    'currency', NEW.currency,
                    'idempotency_key', NEW.idempotency_key
                ),
                'order_details', COALESCE(NEW.gateway_response->'metadata'->'order', '{}'::jsonb),
                'user_details', COALESCE(NEW.gateway_response->'metadata'->'user', '{}'::jsonb)
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
         p.status, p.created_at, p.updated_at;

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

-- Payment method table comments removed - handled by payment gateway
COMMENT ON TABLE payments IS 'Main payments table storing all payment transactions';
COMMENT ON TABLE refunds IS 'Stores refund information for payments';

-- Payment method column comments removed - handled by payment gateway
COMMENT ON COLUMN payments.amount IS 'Amount in minor units (e.g., cents) to avoid floating point issues';
COMMENT ON COLUMN payments.gateway_response IS 'Gateway response data (masked, no sensitive information)';
COMMENT ON COLUMN payments.idempotency_key IS 'Unique key for idempotent payment requests';
COMMENT ON COLUMN refunds.idempotency_key IS 'Unique key for idempotent refund requests';
