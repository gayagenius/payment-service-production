-- Add metadata column to payments table
ALTER TABLE payments ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}';

-- Add metadata column to refunds table
ALTER TABLE refunds ADD COLUMN metadata JSONB NOT NULL DEFAULT '{}';

-- Add gateway_response column to refunds table
ALTER TABLE refunds ADD COLUMN gateway_response JSONB NOT NULL DEFAULT '{}';

-- Update the create_payment_with_history function to include metadata
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
    error_msg TEXT;
    payment_created_at TIMESTAMPTZ;
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
            gateway_response, idempotency_key, metadata
        ) VALUES (
            p_user_id, p_order_id, p_amount, p_currency, payment_status,
            p_gateway_response, p_idempotency_key, p_metadata
        ) RETURNING id, created_at INTO new_payment_id, payment_created_at;
        
        -- Insert payment history entry
        INSERT INTO payment_history (
            payment_id, status, created_at, updated_at
        ) VALUES (
            new_payment_id, payment_status, payment_created_at, payment_created_at
        );
        
        RETURN QUERY SELECT new_payment_id, payment_status, payment_created_at, TRUE, NULL::TEXT;
        
    EXCEPTION WHEN OTHERS THEN
        error_msg := SQLERRM;
        RETURN QUERY SELECT NULL::UUID, NULL::payment_status, NULL::TIMESTAMPTZ, FALSE, error_msg;
    END;
END;
$$ LANGUAGE plpgsql;

-- Update the create_refund_with_history function to include metadata
CREATE OR REPLACE FUNCTION create_refund_with_history(
    p_payment_id UUID,
    p_amount INTEGER,
    p_currency CHAR(3),
    p_status refund_status DEFAULT 'PENDING',
    p_reason TEXT DEFAULT NULL,
    p_idempotency_key VARCHAR(255) DEFAULT NULL,
    p_metadata JSONB DEFAULT '{}'
) RETURNS TABLE(
    refund_id UUID,
    success BOOLEAN,
    error_message TEXT
) AS $$
DECLARE
    new_refund_id UUID;
    error_msg TEXT;
BEGIN
    -- Validate input parameters
    IF p_payment_id IS NULL THEN
        RETURN QUERY SELECT NULL::UUID, FALSE, 'Payment ID is required'::TEXT;
        RETURN;
    END IF;
    
    IF p_amount IS NULL OR p_amount <= 0 THEN
        RETURN QUERY SELECT NULL::UUID, FALSE, 'Amount must be greater than 0'::TEXT;
        RETURN;
    END IF;
    
    IF p_currency IS NULL OR length(p_currency) != 3 THEN
        RETURN QUERY SELECT NULL::UUID, FALSE, 'Currency must be 3 characters'::TEXT;
        RETURN;
    END IF;
    
    -- Check for duplicate idempotency key
    IF p_idempotency_key IS NOT NULL THEN
        IF EXISTS (SELECT 1 FROM refunds WHERE idempotency_key = p_idempotency_key) THEN
            -- Return existing refund
            SELECT id INTO new_refund_id
            FROM refunds 
            WHERE idempotency_key = p_idempotency_key;
            
            RETURN QUERY SELECT new_refund_id, TRUE, 'Refund already exists'::TEXT;
            RETURN;
        END IF;
    END IF;
    
    BEGIN
        -- Insert refund
        INSERT INTO refunds (
            payment_id, amount, currency, status, reason, idempotency_key, metadata
        ) VALUES (
            p_payment_id, p_amount, p_currency, p_status, p_reason, p_idempotency_key, p_metadata
        ) RETURNING id INTO new_refund_id;
        
        RETURN QUERY SELECT new_refund_id, TRUE, NULL::TEXT;
        
    EXCEPTION WHEN OTHERS THEN
        error_msg := SQLERRM;
        RETURN QUERY SELECT NULL::UUID, FALSE, error_msg;
    END;
END;
$$ LANGUAGE plpgsql;

-- Update the update_refund_status function to include gateway_response
CREATE OR REPLACE FUNCTION update_refund_status(
    p_refund_id UUID,
    p_new_status refund_status,
    p_gateway_response JSONB DEFAULT NULL
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
            gateway_response = COALESCE(p_gateway_response, gateway_response),
            updated_at = NOW()
        WHERE id = p_refund_id;
        
        RETURN QUERY SELECT TRUE, current_status, p_new_status, NULL::TEXT;
        
    EXCEPTION WHEN OTHERS THEN
        error_msg := SQLERRM;
        RETURN QUERY SELECT FALSE, NULL::refund_status, NULL::refund_status, error_msg;
    END;
END;
$$ LANGUAGE plpgsql;
