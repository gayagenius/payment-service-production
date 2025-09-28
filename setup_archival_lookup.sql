-- Setup Archival Lookup Functionality
-- This script creates functions to lookup data in archived tables when not found in main tables

-- Function to get payment by ID with archival lookup
CREATE OR REPLACE FUNCTION get_payment_with_archive(payment_id UUID)
RETURNS TABLE (
    id UUID,
    user_id VARCHAR(255),
    order_id VARCHAR(255),
    amount INTEGER,
    currency CHAR(3),
    status payment_status,
    gateway_response JSONB,
    idempotency_key VARCHAR(255),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    -- First try to get from main payments table
    RETURN QUERY
    SELECT 
        p.id,
        p.user_id,
        p.order_id,
        p.amount,
        p.currency,
        p.status,
        p.gateway_response,
        p.idempotency_key,
        p.metadata,
        p.created_at,
        p.updated_at
    FROM payments p
    WHERE p.id = payment_id;
    
    -- If not found in main table, check archived table
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT 
            pa.id,
            pa.user_id,
            pa.order_id,
            pa.amount,
            pa.currency,
            pa.status,
            pa.gateway_response,
            pa.idempotency_key,
            pa.metadata,
            pa.created_at,
            pa.updated_at
        FROM payments_archive pa
        WHERE pa.id = payment_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to get refund by ID with archival lookup
CREATE OR REPLACE FUNCTION get_refund_with_archive(refund_id UUID)
RETURNS TABLE (
    id UUID,
    payment_id UUID,
    amount INTEGER,
    currency CHAR(3),
    status refund_status,
    reason TEXT,
    idempotency_key VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE,
    metadata JSONB,
    gateway_response JSONB
) AS $$
BEGIN
    -- First try to get from main refunds table
    RETURN QUERY
    SELECT 
        r.id,
        r.payment_id,
        r.amount,
        r.currency,
        r.status,
        r.reason,
        r.idempotency_key,
        r.created_at,
        r.updated_at,
        r.metadata,
        r.gateway_response
    FROM refunds r
    WHERE r.id = refund_id;
    
    -- If not found in main table, check archived table
    IF NOT FOUND THEN
        RETURN QUERY
        SELECT 
            ra.id,
            ra.payment_id,
            ra.amount,
            ra.currency,
            ra.status,
            ra.reason,
            ra.idempotency_key,
            ra.created_at,
            ra.updated_at,
            ra.metadata,
            ra.gateway_response
        FROM refunds_archive ra
        WHERE ra.id = refund_id;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to get payment history with archival lookup
CREATE OR REPLACE FUNCTION get_payment_history_with_archive(
    payment_id_param UUID DEFAULT NULL,
    user_id_param VARCHAR(255) DEFAULT NULL,
    limit_param INTEGER DEFAULT 100,
    offset_param INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    payment_id UUID,
    status payment_status,
    previous_status payment_status,
    changed_by UUID,
    change_reason TEXT,
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    -- Get from main payment_history table
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
    WHERE 
        (payment_id_param IS NULL OR ph.payment_id = payment_id_param)
    ORDER BY ph.created_at DESC
    LIMIT limit_param OFFSET offset_param;
    
    -- If we need more records, get from archived table
    IF (SELECT COUNT(*) FROM payment_history ph 
        WHERE (payment_id_param IS NULL OR ph.payment_id = payment_id_param)) < limit_param THEN
        
        RETURN QUERY
        SELECT 
            pha.id,
            pha.payment_id,
            pha.status,
            pha.previous_status,
            pha.changed_by,
            pha.change_reason,
            pha.metadata,
            pha.created_at
        FROM payment_history_archive pha
        WHERE 
            (payment_id_param IS NULL OR pha.payment_id = payment_id_param)
        ORDER BY pha.created_at DESC
        LIMIT limit_param OFFSET GREATEST(0, offset_param - (
            SELECT COUNT(*) FROM payment_history ph 
            WHERE (payment_id_param IS NULL OR ph.payment_id = payment_id_param)
        ));
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to get user payments with archival lookup
CREATE OR REPLACE FUNCTION get_user_payments_with_archive(
    user_id_param VARCHAR(255),
    limit_param INTEGER DEFAULT 100,
    offset_param INTEGER DEFAULT 0
)
RETURNS TABLE (
    id UUID,
    user_id VARCHAR(255),
    order_id VARCHAR(255),
    amount INTEGER,
    currency CHAR(3),
    status payment_status,
    gateway_response JSONB,
    idempotency_key VARCHAR(255),
    metadata JSONB,
    created_at TIMESTAMP WITH TIME ZONE,
    updated_at TIMESTAMP WITH TIME ZONE
) AS $$
BEGIN
    -- Get from main payments table
    RETURN QUERY
    SELECT 
        p.id,
        p.user_id,
        p.order_id,
        p.amount,
        p.currency,
        p.status,
        p.gateway_response,
        p.idempotency_key,
        p.metadata,
        p.created_at,
        p.updated_at
    FROM payments p
    WHERE p.user_id = user_id_param
    ORDER BY p.created_at DESC
    LIMIT limit_param OFFSET offset_param;
    
    -- If we need more records, get from archived table
    IF (SELECT COUNT(*) FROM payments p WHERE p.user_id = user_id_param) < limit_param THEN
        
        RETURN QUERY
        SELECT 
            pa.id,
            pa.user_id,
            pa.order_id,
            pa.amount,
            pa.currency,
            pa.status,
            pa.gateway_response,
            pa.idempotency_key,
            pa.metadata,
            pa.created_at,
            pa.updated_at
        FROM payments_archive pa
        WHERE pa.user_id = user_id_param
        ORDER BY pa.created_at DESC
        LIMIT limit_param OFFSET GREATEST(0, offset_param - (
            SELECT COUNT(*) FROM payments p WHERE p.user_id = user_id_param
        ));
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create indexes for better archival lookup performance
CREATE INDEX IF NOT EXISTS idx_payments_archive_id ON payments_archive(id);
CREATE INDEX IF NOT EXISTS idx_payments_archive_user_id ON payments_archive(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_archive_created_at ON payments_archive(created_at);

CREATE INDEX IF NOT EXISTS idx_refunds_archive_id ON refunds_archive(id);
CREATE INDEX IF NOT EXISTS idx_refunds_archive_payment_id ON refunds_archive(payment_id);

CREATE INDEX IF NOT EXISTS idx_payment_history_archive_payment_id ON payment_history_archive(payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_history_archive_created_at ON payment_history_archive(created_at);

-- Grant permissions
GRANT EXECUTE ON FUNCTION get_payment_with_archive(UUID) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_refund_with_archive(UUID) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_payment_history_with_archive(UUID, UUID, INTEGER, INTEGER) TO PUBLIC;
GRANT EXECUTE ON FUNCTION get_user_payments_with_archive(UUID, INTEGER, INTEGER) TO PUBLIC;

COMMENT ON FUNCTION get_payment_with_archive(UUID) IS 'Gets payment by ID, checking archived data if not found in main table';
COMMENT ON FUNCTION get_refund_with_archive(UUID) IS 'Gets refund by ID, checking archived data if not found in main table';
COMMENT ON FUNCTION get_payment_history_with_archive(UUID, UUID, INTEGER, INTEGER) IS 'Gets payment history with archival lookup support';
COMMENT ON FUNCTION get_user_payments_with_archive(UUID, INTEGER, INTEGER) IS 'Gets user payments with archival lookup support';