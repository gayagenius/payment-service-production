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
-- Payment method tables removed - payment methods are now handled by the gateway directly


-- Payments
CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(255) NOT NULL,
    order_id VARCHAR(255) NOT NULL,
    amount INTEGER NOT NULL,
    currency CHAR(3) NOT NULL,
    status payment_status NOT NULL DEFAULT 'PENDING',
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

-- Payment method indexes removed - payment methods are now handled by the gateway directly


-- Payments
CREATE INDEX idx_payments_user_id_created ON payments(user_id, created_at DESC);
CREATE INDEX idx_payments_order_id ON payments(order_id) WHERE order_id IS NOT NULL;
CREATE INDEX idx_payments_status_created ON payments(status, created_at DESC);
-- Payment method index removed

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
-- Payment method triggers removed - payment methods are now handled by the gateway directly


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

-- Payment method table comments removed
COMMENT ON TABLE payments IS 'Main payments table storing all payment transactions';
COMMENT ON TABLE payment_history IS 'Audit trail for payment status changes and transaction history';
COMMENT ON TABLE refunds IS 'Stores refund information for payments';

-- Payment method column comments removed
COMMENT ON COLUMN payments.amount IS 'Amount in minor units (e.g., cents for KES) to avoid floating point issues';
COMMENT ON COLUMN payments.gateway_response IS 'Gateway response data (masked, no sensitive information)';
COMMENT ON COLUMN payments.idempotency_key IS 'Unique key for idempotent payment requests';
COMMENT ON COLUMN refunds.idempotency_key IS 'Unique key for idempotent refund requests';

-- =============================================
-- PAYMENT CREATION FUNCTION WITH HISTORY
-- =============================================

-- Create payment with automatic history entry
-- Supports retry functionality via idempotency key
CREATE OR REPLACE FUNCTION create_payment_with_history(
    p_user_id VARCHAR(255),
    p_order_id VARCHAR(255),
    p_amount INTEGER,
    p_currency CHAR(3),
    p_gateway_response JSONB DEFAULT '{}',
    p_idempotency_key VARCHAR(255) DEFAULT NULL,
    p_retry BOOLEAN DEFAULT FALSE,
    p_metadata JSONB DEFAULT '{}'
) RETURNS TABLE(
    payment_id UUID,
    status payment_status,
    created_at TIMESTAMPTZ,
    success BOOLEAN,
    error_message TEXT
) AS $$
DECLARE
    new_payment_id UUID;
    payment_status payment_status := 'PENDING';
    payment_created_at TIMESTAMPTZ;
    error_msg TEXT;
BEGIN
    -- Validate input parameters
    IF p_user_id IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::payment_status, NULL::TIMESTAMPTZ, FALSE, 'User ID is required'::TEXT;
        RETURN;
    END IF;
    
    IF p_order_id IS NULL OR length(trim(p_order_id)) = 0 THEN
        RETURN QUERY SELECT NULL::UUID, NULL::payment_status, NULL::TIMESTAMPTZ, FALSE, 'Order ID is required'::TEXT;
        RETURN;
    END IF;
    
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN QUERY SELECT NULL::UUID, NULL::payment_status, NULL::TIMESTAMPTZ, FALSE, 'Amount must be greater than 0'::TEXT;
        RETURN;
    END IF;
    
    IF p_currency IS NULL OR length(p_currency) != 3 THEN
        RETURN QUERY SELECT NULL::UUID, NULL::payment_status, NULL::TIMESTAMPTZ, FALSE, 'Currency must be 3 characters'::TEXT;
        RETURN;
    END IF;
    
    -- Check for duplicate idempotency key with explicit alias
    IF p_idempotency_key IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM payments p WHERE p.idempotency_key = p_idempotency_key) THEN
            -- Return existing payment with explicit alias
            SELECT p.id, p.status, p.created_at INTO new_payment_id, payment_status, payment_created_at
            FROM payments p
            WHERE p.idempotency_key = p_idempotency_key;
            
            -- If retry is requested, return existing payment
            IF p_retry THEN
                RETURN QUERY SELECT new_payment_id, payment_status, payment_created_at, TRUE, 'Payment already exists'::TEXT;
                RETURN;
            ELSE
                -- If not retry, return error
                RETURN QUERY SELECT NULL::UUID, NULL::payment_status, NULL::TIMESTAMPTZ, FALSE, 'Payment already exists'::TEXT;
                RETURN;
            END IF;
        END IF;
    END IF;
    
    BEGIN
        -- Insert payment
        INSERT INTO payments (
            user_id, order_id, amount, currency, status, 
            gateway_response, idempotency_key, metadata
        ) VALUES (
            p_user_id, p_order_id, p_amount, p_currency, payment_status,
            p_gateway_response, p_idempotency_key, p_metadata
        ) RETURNING id, created_at INTO new_payment_id, payment_created_at;
        
        -- Insert payment history entry
        INSERT INTO payment_history (
            payment_id, status, metadata
        ) VALUES (
            new_payment_id, payment_status, p_metadata
        );
        
        RETURN QUERY SELECT new_payment_id, payment_status, payment_created_at, TRUE, NULL::TEXT;
        
    EXCEPTION WHEN OTHERS THEN
        error_msg := SQLERRM;
        RETURN QUERY SELECT NULL::UUID, NULL::payment_status, NULL::TIMESTAMPTZ, FALSE, error_msg;
    END;
END;
$$ LANGUAGE plpgsql;
