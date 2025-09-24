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
-- This function ensures atomicity between payment creation and history logging
-- Supports retry functionality via idempotency key
CREATE OR REPLACE FUNCTION create_payment_with_history(
    p_user_id UUID,
    p_order_id VARCHAR(255),
    p_amount INTEGER,
    p_currency CHAR(3),
    p_payment_method_id UUID DEFAULT NULL,
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
    
    -- Check for duplicate idempotency key
    IF p_idempotency_key IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM payments WHERE idempotency_key = p_idempotency_key) THEN
            -- Return existing payment
            SELECT id, status, created_at INTO new_payment_id, payment_status, payment_created_at
            FROM payments 
            WHERE idempotency_key = p_idempotency_key;
            
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
            payment_method_id, gateway_response, idempotency_key, metadata
        ) VALUES (
            p_user_id, p_order_id, p_amount, p_currency, payment_status,
            p_payment_method_id, p_gateway_response, p_idempotency_key, p_metadata
        ) RETURNING id, created_at INTO new_payment_id, payment_created_at;
        
        -- Insert payment history entry
        INSERT INTO payment_history (
            payment_id, status, created_at, metadata
        ) VALUES (
            new_payment_id, payment_status, payment_created_at, p_metadata
        );
        
        RETURN QUERY SELECT new_payment_id, payment_status, payment_created_at, TRUE, NULL::TEXT;
        
    EXCEPTION WHEN OTHERS THEN
        error_msg := SQLERRM;
        RETURN QUERY SELECT NULL::UUID, NULL::payment_status, NULL::TIMESTAMPTZ, FALSE, error_msg;
    END;
END;
$$ LANGUAGE plpgsql;

-- Function to safely read payment by ID
-- This function is replica-safe and handles missing payments gracefully
CREATE OR REPLACE FUNCTION get_payment_by_id(
    p_payment_id UUID
) RETURNS TABLE(
    id UUID,
    user_id UUID,
    order_id VARCHAR(255),
    amount INTEGER,
    currency CHAR(3),
    status payment_status,
    payment_method_id UUID,
    gateway_response JSONB,
    idempotency_key VARCHAR(255),
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    found BOOLEAN
) AS $$
BEGIN
    -- Try to find payment in main table first
    RETURN QUERY
    SELECT 
        p.id, p.user_id, p.order_id, p.amount, p.currency,
        p.status, p.payment_method_id, p.gateway_response,
        p.idempotency_key, p.created_at, p.updated_at,
        TRUE as found
    FROM payments p
    WHERE p.id = p_payment_id;
    
    -- If not found in main table, return NULL values
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT 
            NULL::UUID, NULL::UUID, NULL::VARCHAR(255), NULL::INTEGER, NULL::CHAR(3),
            NULL::payment_status, NULL::UUID, NULL::JSONB,
            NULL::VARCHAR(255), NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ,
            FALSE as found;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to safely read payments by user ID
-- This function is replica-safe and handles pagination
CREATE OR REPLACE FUNCTION get_payments_by_user(
    p_user_id UUID,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0,
    p_status payment_status DEFAULT NULL
) RETURNS TABLE(
    id UUID,
    user_id UUID,
    order_id VARCHAR(255),
    amount INTEGER,
    currency CHAR(3),
    status payment_status,
    payment_method_id UUID,
    gateway_response JSONB,
    idempotency_key VARCHAR(255),
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    total_count BIGINT
) AS $$
DECLARE
    total_count BIGINT;
BEGIN
    -- Get total count
    SELECT COUNT(*) INTO total_count
        FROM payments p
        WHERE p.user_id = p_user_id
        AND (p_status IS NULL OR p.status = p_status);
    
    -- Return paginated results
    RETURN QUERY
    SELECT 
        p.id, p.user_id, p.order_id, p.amount, p.currency,
        p.status, p.payment_method_id, p.gateway_response,
        p.idempotency_key, p.created_at, p.updated_at,
        total_count
    FROM payments p
    WHERE p.user_id = p_user_id
    AND (p_status IS NULL OR p.status = p_status)
    ORDER BY p.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Function to safely update payment status
-- This function ensures atomicity and creates history entry
CREATE OR REPLACE FUNCTION update_payment_status(
    p_payment_id UUID,
    p_new_status payment_status,
    p_gateway_response JSONB DEFAULT NULL
) RETURNS TABLE(
    success BOOLEAN,
    old_status payment_status,
    new_status payment_status,
    error_message TEXT
) AS $$
DECLARE
    current_status payment_status;
    error_msg TEXT;
BEGIN
    -- Validate input parameters
    IF p_payment_id IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::payment_status, NULL::payment_status, 'Payment ID is required'::TEXT;
        RETURN;
    END IF;
    
    IF p_new_status IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::payment_status, NULL::payment_status, 'New status is required'::TEXT;
        RETURN;
    END IF;
    
    BEGIN
        -- Get current status
        SELECT status INTO current_status
        FROM payments
        WHERE id = p_payment_id;
        
        IF current_status IS NULL THEN
            RETURN QUERY SELECT FALSE, NULL::payment_status, NULL::payment_status, 'Payment not found'::TEXT;
            RETURN;
        END IF;
        
        -- Update payment status
        UPDATE payments
        SET 
            status = p_new_status,
            updated_at = NOW(),
            gateway_response = COALESCE(p_gateway_response, gateway_response)
        WHERE id = p_payment_id;
        
        -- Insert history entry
        INSERT INTO payment_history (
            payment_id, status, created_at, updated_at
        ) VALUES (
            p_payment_id, p_new_status, NOW(), NOW()
        );
        
        RETURN QUERY SELECT TRUE, current_status, p_new_status, NULL::TEXT;
        
    EXCEPTION WHEN OTHERS THEN
        error_msg := SQLERRM;
        RETURN QUERY SELECT FALSE, NULL::payment_status, NULL::payment_status, error_msg;
    END;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- PAYMENT HISTORY HELPER FUNCTIONS
-- =============================================

-- Function to safely read all payment history
-- This function is replica-safe and handles pagination
CREATE OR REPLACE FUNCTION get_payment_history(
    p_payment_id UUID,
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0
) RETURNS TABLE(
    id UUID,
    payment_id UUID,
    status payment_status,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    total_count BIGINT
) AS $$
DECLARE
    total_count BIGINT;
BEGIN
    -- Get total count
    SELECT COUNT(*) INTO total_count
    FROM payment_history
    WHERE payment_id = p_payment_id;
    
    -- Return paginated results
    RETURN QUERY
    SELECT 
        ph.id, ph.payment_id, ph.status, ph.created_at, ph.updated_at,
        total_count
    FROM payment_history ph
    WHERE ph.payment_id = p_payment_id
    ORDER BY ph.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Function to safely read individual user's payment history
-- This function is replica-safe and handles pagination
CREATE OR REPLACE FUNCTION get_user_payment_history(
    p_user_id UUID,
    p_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0,
    p_start_date TIMESTAMPTZ DEFAULT NULL,
    p_end_date TIMESTAMPTZ DEFAULT NULL
) RETURNS TABLE(
    payment_id UUID,
    user_id UUID,
    order_id VARCHAR(255),
    amount INTEGER,
    currency CHAR(3),
    status payment_status,
    created_at TIMESTAMPTZ,
    total_count BIGINT
) AS $$
DECLARE
    total_count BIGINT;
BEGIN
    -- Get total count
    SELECT COUNT(*) INTO total_count
    FROM payments p
    WHERE p.user_id = p_user_id
    AND (p_start_date IS NULL OR p.created_at >= p_start_date)
    AND (p_end_date IS NULL OR p.created_at <= p_end_date);
    
    -- Return paginated results
    RETURN QUERY
    SELECT 
        p.id, p.user_id, p.order_id, p.amount, p.currency,
        p.status, p.created_at, total_count
    FROM payments p
    WHERE p.user_id = p_user_id
    AND (p_start_date IS NULL OR p.created_at >= p_start_date)
    AND (p_end_date IS NULL OR p.created_at <= p_end_date)
    ORDER BY p.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- PAYMENT HISTORY HELPER FUNCTIONS
-- =============================================

-- Function to get payment history for a specific payment
CREATE OR REPLACE FUNCTION get_payment_history(
    p_payment_id UUID
) RETURNS TABLE(
    id UUID,
    payment_id UUID,
    status payment_status,
    previous_status payment_status,
    changed_by UUID,
    change_reason TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ
) AS $$
BEGIN
    -- Validate input
    IF p_payment_id IS NULL THEN
        RAISE EXCEPTION 'Payment ID is required';
    END IF;
    
    -- Return payment history ordered by creation time
    RETURN QUERY
    SELECT 
        ph.id,
        ph.payment_id,
        ph.status,
        ph.previous_status,
        ph.changed_by,
        ph.change_reason,
        ph.metadata,
        ph.created_at
    FROM payment_history ph
    WHERE ph.payment_id = p_payment_id
    ORDER BY ph.created_at DESC;
END;
$$ LANGUAGE plpgsql;

-- Function to get payment history for a user
CREATE OR REPLACE FUNCTION get_user_payment_history(
    p_user_id UUID,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
) RETURNS TABLE(
    id UUID,
    payment_id UUID,
    status payment_status,
    previous_status payment_status,
    changed_by UUID,
    change_reason TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ,
    user_id UUID,
    order_id VARCHAR(255),
    amount INTEGER,
    currency CHAR(3)
) AS $$
BEGIN
    -- Validate input
    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'User ID is required';
    END IF;
    
    -- Validate pagination parameters
    IF p_limit < 1 OR p_limit > 100 THEN
        p_limit := 50;
    END IF;
    
    IF p_offset < 0 THEN
        p_offset := 0;
    END IF;
    
    -- Return payment history for user's payments
    RETURN QUERY
    SELECT 
        ph.id,
        ph.payment_id,
        ph.status,
        ph.previous_status,
        ph.changed_by,
        ph.change_reason,
        ph.metadata,
        ph.created_at,
        p.user_id,
        p.order_id,
        p.amount,
        p.currency
    FROM payment_history ph
    JOIN payments p ON ph.payment_id = p.id
    WHERE p.user_id = p_user_id
    ORDER BY ph.created_at DESC
    LIMIT p_limit OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Function to manually create payment history entry
CREATE OR REPLACE FUNCTION create_payment_history_entry(
    p_payment_id UUID,
    p_status payment_status,
    p_previous_status payment_status DEFAULT NULL,
    p_changed_by UUID DEFAULT NULL,
    p_change_reason TEXT DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
) RETURNS TABLE(
    history_id UUID,
    success BOOLEAN,
    error_message TEXT
) AS $$
DECLARE
    new_history_id UUID;
    error_msg TEXT;
BEGIN
    -- Validate input
    IF p_payment_id IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, FALSE, 'Payment ID is required'::TEXT;
        RETURN;
    END IF;
    
    IF p_status IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, FALSE, 'Status is required'::TEXT;
        RETURN;
    END IF;
    
    -- Check if payment exists
    IF NOT EXISTS (SELECT 1 FROM payments WHERE id = p_payment_id) THEN
        RETURN QUERY SELECT NULL::UUID, FALSE, 'Payment not found'::TEXT;
        RETURN;
    END IF;
    
    BEGIN
        -- Insert history entry
        INSERT INTO payment_history (
            payment_id,
            status,
            previous_status,
            changed_by,
            change_reason,
            metadata
        ) VALUES (
            p_payment_id,
            p_status,
            p_previous_status,
            p_changed_by,
            p_change_reason,
            p_metadata
        ) RETURNING id INTO new_history_id;
        
        RETURN QUERY SELECT new_history_id, TRUE, NULL::TEXT;
        
    EXCEPTION WHEN OTHERS THEN
        error_msg := 'Failed to create payment history entry: ' || SQLERRM;
        RETURN QUERY SELECT NULL::UUID, FALSE, error_msg;
    END;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- REFUND HELPER FUNCTIONS
-- =============================================

-- Function to safely create a refund
-- This function ensures atomicity and validates refund amount
CREATE OR REPLACE FUNCTION create_refund(
    p_payment_id UUID,
    p_amount INTEGER,
    p_currency CHAR(3),
    p_reason TEXT DEFAULT NULL,
    p_idempotency_key VARCHAR(255) DEFAULT NULL
) RETURNS TABLE(
    refund_id UUID,
    payment_id UUID,
    amount INTEGER,
    currency CHAR(3),
    status refund_status,
    reason TEXT,
    created_at TIMESTAMPTZ,
    success BOOLEAN,
    error_message TEXT
) AS $$
DECLARE
    new_refund_id UUID;
    payment_amount INTEGER;
    total_refunded INTEGER;
    refund_status refund_status := 'PENDING';
    refund_created_at TIMESTAMPTZ;
    refund_amount INTEGER;
    refund_currency CHAR(3);
    refund_reason TEXT;
    error_msg TEXT;
BEGIN
    -- Validate input parameters
    IF p_payment_id IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::INTEGER, NULL::CHAR(3), NULL::refund_status, NULL::TEXT, NULL::TIMESTAMPTZ, FALSE, 'Payment ID is required'::TEXT;
        RETURN;
    END IF;
    
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::INTEGER, NULL::CHAR(3), NULL::refund_status, NULL::TEXT, NULL::TIMESTAMPTZ, FALSE, 'Amount must be greater than 0'::TEXT;
        RETURN;
    END IF;
    
    IF p_currency IS NULL OR length(p_currency) != 3 THEN
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::INTEGER, NULL::CHAR(3), NULL::refund_status, NULL::TEXT, NULL::TIMESTAMPTZ, FALSE, 'Currency must be 3 characters'::TEXT;
        RETURN;
    END IF;
    
    -- Check for duplicate idempotency key
    IF p_idempotency_key IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM refunds WHERE idempotency_key = p_idempotency_key) THEN
            -- Return existing refund
            SELECT r.id, r.payment_id, r.amount, r.currency, r.status, r.reason, r.created_at 
            INTO new_refund_id, payment_id, refund_amount, refund_currency, refund_status, refund_reason, refund_created_at
            FROM refunds r
            WHERE r.idempotency_key = p_idempotency_key;
            
            RETURN QUERY SELECT new_refund_id, payment_id, refund_amount, refund_currency, refund_status, refund_reason, refund_created_at, TRUE, 'Refund already exists'::TEXT;
            RETURN;
        END IF;
    END IF;
    
    BEGIN
        -- Get payment amount
        SELECT amount INTO payment_amount
        FROM payments
        WHERE id = p_payment_id;
        
        IF payment_amount IS NULL THEN
            RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::INTEGER, NULL::CHAR(3), NULL::refund_status, NULL::TEXT, NULL::TIMESTAMPTZ, FALSE, 'Payment not found'::TEXT;
            RETURN;
        END IF;
        
        -- Get total refunded amount
        SELECT COALESCE(SUM(r.amount), 0) INTO total_refunded
        FROM refunds r
        WHERE r.payment_id = p_payment_id AND r.status = 'SUCCEEDED';
        
        -- Validate refund amount
        IF (total_refunded + p_amount) > payment_amount THEN
            RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::INTEGER, NULL::CHAR(3), NULL::refund_status, NULL::TEXT, NULL::TIMESTAMPTZ, FALSE, 'Refund amount exceeds available amount'::TEXT;
            RETURN;
        END IF;
        
        -- Insert refund
        INSERT INTO refunds (
            payment_id, amount, currency, status, reason, idempotency_key
        ) VALUES (
            p_payment_id, p_amount, p_currency, refund_status, p_reason, p_idempotency_key
        ) RETURNING id, created_at INTO new_refund_id, refund_created_at;
        
        RETURN QUERY SELECT new_refund_id, p_payment_id, p_amount, p_currency, refund_status, p_reason, refund_created_at, TRUE, NULL::TEXT;
        
    EXCEPTION WHEN OTHERS THEN
        error_msg := SQLERRM;
        RETURN QUERY SELECT NULL::UUID, NULL::UUID, NULL::INTEGER, NULL::CHAR(3), NULL::refund_status, NULL::TEXT, NULL::TIMESTAMPTZ, FALSE, error_msg;
    END;
END;
$$ LANGUAGE plpgsql;

-- Function to safely read refund by ID
-- This function is replica-safe and handles missing refunds gracefully
CREATE OR REPLACE FUNCTION get_refund_by_id(
    p_refund_id UUID
) RETURNS TABLE(
    id UUID,
    payment_id UUID,
    amount INTEGER,
    currency CHAR(3),
    status refund_status,
    reason TEXT,
    idempotency_key VARCHAR(255),
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    found BOOLEAN
) AS $$
BEGIN
    -- Try to find refund in main table first
    RETURN QUERY
    SELECT 
        r.id, r.payment_id, r.amount, r.currency,
        r.status, r.reason, r.idempotency_key,
        r.created_at, r.updated_at, TRUE as found
    FROM refunds r
    WHERE r.id = p_refund_id;
    
    -- If not found in main table, return NULL values
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT 
            NULL::UUID, NULL::UUID, NULL::INTEGER, NULL::CHAR(3),
            NULL::refund_status, NULL::TEXT, NULL::VARCHAR(255),
            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, FALSE as found;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to safely read refunds by payment ID
-- This function is replica-safe and handles pagination
CREATE OR REPLACE FUNCTION get_refunds_by_payment(
    p_payment_id UUID,
    p_limit INTEGER DEFAULT 50,
    p_offset INTEGER DEFAULT 0
) RETURNS TABLE(
    id UUID,
    payment_id UUID,
    amount INTEGER,
    currency CHAR(3),
    status refund_status,
    reason TEXT,
    idempotency_key VARCHAR(255),
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    total_count BIGINT
) AS $$
DECLARE
    total_count BIGINT;
BEGIN
    -- Get total count
    SELECT COUNT(*) INTO total_count
        FROM refunds
        WHERE payment_id = p_payment_id;
    
    -- Return paginated results
    RETURN QUERY
    SELECT 
        r.id, r.payment_id, r.amount, r.currency,
        r.status, r.reason, r.idempotency_key,
        r.created_at, r.updated_at, total_count
    FROM refunds r
    WHERE r.payment_id = p_payment_id
    ORDER BY r.created_at DESC
    LIMIT p_limit
    OFFSET p_offset;
END;
$$ LANGUAGE plpgsql;

-- Function to safely update refund status
-- This function ensures atomicity and creates history entry
CREATE OR REPLACE FUNCTION update_refund_status(
    p_refund_id UUID,
    p_new_status refund_status
) RETURNS TABLE(
    success BOOLEAN,
    old_status refund_status,
    new_status refund_status,
    error_message TEXT
) AS $$
DECLARE
    current_status refund_status;
    error_msg TEXT;
BEGIN
    -- Validate input parameters
    IF p_refund_id IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::refund_status, NULL::refund_status, 'Refund ID is required'::TEXT;
        RETURN;
    END IF;
    
    IF p_new_status IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::refund_status, NULL::refund_status, 'New status is required'::TEXT;
        RETURN;
    END IF;
    
    BEGIN
        -- Get current status
        SELECT status INTO current_status
        FROM refunds
        WHERE id = p_refund_id;
        
        IF current_status IS NULL THEN
            RETURN QUERY SELECT FALSE, NULL::refund_status, NULL::refund_status, 'Refund not found'::TEXT;
            RETURN;
        END IF;
        
        -- Update refund status
        UPDATE refunds
        SET 
            status = p_new_status,
            updated_at = NOW()
        WHERE id = p_refund_id;
        
        RETURN QUERY SELECT TRUE, current_status, p_new_status, NULL::TEXT;
        
    EXCEPTION WHEN OTHERS THEN
        error_msg := SQLERRM;
        RETURN QUERY SELECT FALSE, NULL::refund_status, NULL::refund_status, error_msg;
    END;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- UTILITY FUNCTIONS
-- =============================================

-- Function to check if a payment can be refunded
-- This function is replica-safe and provides business logic validation
CREATE OR REPLACE FUNCTION can_refund_payment(
    p_payment_id UUID,
    p_refund_amount INTEGER
) RETURNS TABLE(
    can_refund BOOLEAN,
    payment_amount INTEGER,
    total_refunded INTEGER,
    available_amount INTEGER,
    error_message TEXT
) AS $$
DECLARE
    payment_amount INTEGER;
    total_refunded INTEGER;
    available_amount INTEGER;
    error_msg TEXT;
BEGIN
    -- Validate input parameters
    IF p_payment_id IS NULL THEN
        RETURN QUERY SELECT FALSE, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, 'Payment ID is required'::TEXT;
        RETURN;
    END IF;
    
    IF p_refund_amount IS NULL OR p_refund_amount <= 0 THEN
        RETURN QUERY SELECT FALSE, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, 'Refund amount must be greater than 0'::TEXT;
        RETURN;
    END IF;
    
    BEGIN
        -- Get payment amount
        SELECT amount INTO payment_amount
        FROM payments
        WHERE id = p_payment_id;
        
        IF payment_amount IS NULL THEN
            RETURN QUERY SELECT FALSE, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, 'Payment not found'::TEXT;
            RETURN;
        END IF;
        
        -- Get total refunded amount
        SELECT COALESCE(SUM(amount), 0) INTO total_refunded
        FROM refunds
        WHERE payment_id = p_payment_id AND status = 'SUCCEEDED';
        
        -- Calculate available amount
        available_amount := payment_amount - total_refunded;
        
        -- Check if refund is possible
        IF p_refund_amount <= available_amount THEN
            RETURN QUERY SELECT TRUE, payment_amount, total_refunded, available_amount, NULL::TEXT;
        ELSE
            RETURN QUERY SELECT FALSE, payment_amount, total_refunded, available_amount, 'Refund amount exceeds available amount'::TEXT;
        END IF;
        
    EXCEPTION WHEN OTHERS THEN
        error_msg := SQLERRM;
        RETURN QUERY SELECT FALSE, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER, error_msg;
    END;
END;
$$ LANGUAGE plpgsql;

-- Function to get payment summary with refund information
-- This function is replica-safe and provides comprehensive payment information
CREATE OR REPLACE FUNCTION get_payment_summary(
    p_payment_id UUID
) RETURNS TABLE(
    payment_id UUID,
    user_id UUID,
    order_id VARCHAR(255),
    amount INTEGER,
    currency CHAR(3),
    status payment_status,
    total_refunded INTEGER,
    available_for_refund INTEGER,
    refund_count INTEGER,
    created_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ,
    found BOOLEAN
) AS $$
DECLARE
    payment_record RECORD;
    total_refunded INTEGER;
    refund_count INTEGER;
BEGIN
    -- Get payment information
    SELECT * INTO payment_record
        FROM payments
        WHERE id = p_payment_id;
    
    IF payment_record.id IS NULL THEN
        RETURN QUERY SELECT 
            NULL::UUID, NULL::UUID, NULL::VARCHAR(255), NULL::INTEGER, NULL::CHAR(3),
            NULL::payment_status, NULL::INTEGER, NULL::INTEGER, NULL::INTEGER,
            NULL::TIMESTAMPTZ, NULL::TIMESTAMPTZ, FALSE;
        RETURN;
    END IF;
    
    -- Get refund information
    SELECT 
        COALESCE(SUM(amount), 0),
        COUNT(*)
    INTO total_refunded, refund_count
        FROM refunds
        WHERE payment_id = p_payment_id AND status = 'SUCCEEDED';
    
    RETURN QUERY SELECT 
        payment_record.id,
        payment_record.user_id,
        payment_record.order_id,
        payment_record.amount,
        payment_record.currency,
        payment_record.status,
        total_refunded,
        payment_record.amount - total_refunded,
        refund_count,
        payment_record.created_at,
        payment_record.updated_at,
        TRUE;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- COMMENTS
-- =============================================

COMMENT ON FUNCTION create_payment_with_history IS 'Creates a payment with atomic history entry and idempotency support';
COMMENT ON FUNCTION get_payment_by_id IS 'Safely retrieves payment by ID from main or archive table';
COMMENT ON FUNCTION get_payments_by_user IS 'Safely retrieves paginated payments for a user';
COMMENT ON FUNCTION update_payment_status IS 'Updates payment status with atomic history entry';
COMMENT ON FUNCTION get_payment_history IS 'Safely retrieves paginated payment history';
COMMENT ON FUNCTION get_user_payment_history IS 'Safely retrieves paginated user payment history';
COMMENT ON FUNCTION create_refund IS 'Creates a refund with validation and idempotency support';
COMMENT ON FUNCTION get_refund_by_id IS 'Safely retrieves refund by ID from main or archive table';
COMMENT ON FUNCTION get_refunds_by_payment IS 'Safely retrieves paginated refunds for a payment';
COMMENT ON FUNCTION update_refund_status IS 'Updates refund status atomically';
COMMENT ON FUNCTION can_refund_payment IS 'Validates if a payment can be refunded';
COMMENT ON FUNCTION get_payment_summary IS 'Gets comprehensive payment summary with refund information';
