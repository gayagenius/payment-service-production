-- Read-Only Helper Functions for Payment Service
-- 
-- This file contains safe read/write helper functions for payments, history, and refunds.
-- All functions are designed to be replica-safe and transaction-safe.
-- 
-- Key Features:
-- - Replica-safe read operations
-- - Transaction-safe write operations
-- - Idempotency support
-- - Comprehensive error handling
-- - Performance optimization
-- - Data integrity validation

-- =============================================
-- PAYMENT HELPER FUNCTIONS
-- =============================================

-- Function to create a payment with history entry
-- Function to create a payment with history entry
CREATE OR REPLACE FUNCTION create_payment_with_history(
    p_user_id UUID,
    p_order_id VARCHAR(255),
    p_amount INTEGER,
    p_currency CHAR(3),
    p_payment_method_id UUID DEFAULT NULL,
    p_gateway_response JSONB DEFAULT '{}',
    p_idempotency_key VARCHAR(255) DEFAULT NULL,
    p_retry BOOLEAN DEFAULT FALSE
) RETURNS TABLE(
    payment_id UUID,
    status payment_status,
    payment_created_at TIMESTAMPTZ,  -- Changed from created_at to payment_created_at
    success BOOLEAN,
    error_message TEXT
) AS $$
DECLARE
    new_payment_id UUID;
    payment_status payment_status := 'PENDING';
    payment_created_at TIMESTAMPTZ;  -- Add this variable
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
    
    -- Check for duplicate idempotency key
    IF p_idempotency_key IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM payments WHERE idempotency_key = p_idempotency_key) THEN
            -- Return existing payment
            SELECT id, status, created_at INTO new_payment_id, payment_status, payment_created_at
            FROM payments 
            WHERE idempotency_key = p_idempotency_key;
            
            IF p_retry THEN
                RETURN QUERY SELECT new_payment_id, payment_status, payment_created_at, TRUE, 'Payment already exists'::TEXT;
                RETURN;
            ELSE
                RETURN QUERY SELECT NULL::UUID, NULL::payment_status, NULL::TIMESTAMPTZ, FALSE, 'Payment already exists'::TEXT;
                RETURN;
            END IF;
        END IF;
    END IF;
    
    BEGIN
        -- Insert payment
        INSERT INTO payments (
            user_id, order_id, amount, currency, status, 
            payment_method_id, gateway_response, idempotency_key
        ) VALUES (
            p_user_id, p_order_id, p_amount, p_currency, payment_status,
            p_payment_method_id, p_gateway_response, p_idempotency_key
        ) RETURNING id, created_at INTO new_payment_id, payment_created_at;
        
        -- Insert payment history entry
        INSERT INTO payment_history (
            payment_id, status, previous_status, changed_by, change_reason, metadata
        ) VALUES (
            new_payment_id, payment_status, NULL, NULL, 'Payment created', '{}'::jsonb
        );
        
        RETURN QUERY SELECT new_payment_id, payment_status, payment_created_at, TRUE, NULL::TEXT;
        
    EXCEPTION WHEN OTHERS THEN
        error_msg := SQLERRM;
        RETURN QUERY SELECT NULL::UUID, NULL::payment_status, NULL::TIMESTAMPTZ, FALSE, error_msg;
    END;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- GENERAL GUIDELINE
-- =============================================

-- For all other functions that return `created_at` or `updated_at`:
-- 1. Add a unique alias in RETURNS TABLE (e.g., `payment_created_at`, `refund_created_at`, `history_created_at`).
-- 2. Add the same alias in every SELECT that returns the column.

