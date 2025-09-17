-- Archival Jobs for Payments and Refunds
-- This file contains all archival-related SQL jobs and procedures
-- for performance and compliance archival

-- =============================================
-- ARCHIVAL CONFIGURATION
-- =============================================

-- Create configuration table for archival settings
CREATE TABLE IF NOT EXISTS archival_config (
    id SERIAL PRIMARY KEY,
    config_key VARCHAR(100) NOT NULL UNIQUE,
    config_value TEXT NOT NULL,
    description TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert default configuration
INSERT INTO archival_config (config_key, config_value, description) VALUES
('performance_threshold', '49999', 'Number of rows in payments table before performance archival triggers'),
('performance_archive_count', '20000', 'Number of rows to archive during performance archival'),
('compliance_retention_years', '1', 'Years to retain data before compliance archival'),
('reports_retention_years', '7', 'Years to retain data in reports table'),
('archival_enabled', 'true', 'Whether archival is enabled'),
('last_performance_archival', '1970-01-01', 'Last performance archival timestamp'),
('last_compliance_archival', '1970-01-01', 'Last compliance archival timestamp'),
('last_reports_generation', '1970-01-01', 'Last reports generation timestamp')
ON CONFLICT (config_key) DO NOTHING;

-- =============================================
-- ARCHIVAL PROCEDURES
-- =============================================

-- Procedure to archive closed payments for performance
CREATE OR REPLACE FUNCTION archive_closed_payments_performance()
RETURNS TABLE(
    archived_count INTEGER,
    threshold_exceeded BOOLEAN,
    message TEXT
) AS $$
DECLARE
    current_count INTEGER;
    threshold_count INTEGER;
    archive_count INTEGER;
    archived_rows INTEGER := 0;
    config_value TEXT;
BEGIN
    -- Get configuration values
    SELECT config_value INTO config_value FROM archival_config WHERE config_key = 'archival_enabled';
    IF config_value != 'true' THEN
        RETURN QUERY SELECT 0, false, 'Archival is disabled'::TEXT;
        RETURN;
    END IF;
    
    SELECT config_value INTO config_value FROM archival_config WHERE config_key = 'performance_threshold';
    threshold_count := config_value::INTEGER;
    
    SELECT config_value INTO config_value FROM archival_config WHERE config_key = 'performance_archive_count';
    archive_count := config_value::INTEGER;
    
    -- Get current count
    SELECT COUNT(*) INTO current_count FROM payments_partitioned;
    
    -- Check if threshold is exceeded
    IF current_count <= threshold_count THEN
        RETURN QUERY SELECT 0, false, format('Threshold not exceeded: %s <= %s', current_count, threshold_count);
        RETURN;
    END IF;
    
    -- Archive oldest closed payments
    WITH payments_to_archive AS (
        SELECT * FROM payments_partitioned 
        WHERE status IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')
        ORDER BY created_at ASC 
        LIMIT archive_count
    )
    INSERT INTO payments_archive (
        id, user_id, order_id, amount, currency, status, 
        payment_method_id, gateway_response, idempotency_key, 
        created_at, updated_at
    )
    SELECT 
        id, user_id, order_id, amount, currency, status,
        payment_method_id, gateway_response, idempotency_key,
        created_at, updated_at
    FROM payments_to_archive;
    
    -- Delete archived payments from main table
    WITH payments_to_archive AS (
        SELECT id FROM payments_partitioned 
        WHERE status IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')
        ORDER BY created_at ASC 
        LIMIT archive_count
    )
    DELETE FROM payments_partitioned 
    WHERE id IN (SELECT id FROM payments_to_archive);
    
    GET DIAGNOSTICS archived_rows = ROW_COUNT;
    
    -- Update last archival timestamp
    UPDATE archival_config 
    SET config_value = NOW()::TEXT, updated_at = NOW()
    WHERE config_key = 'last_performance_archival';
    
    RETURN QUERY SELECT archived_rows, true, format('Archived %s payments for performance', archived_rows);
END;
$$ LANGUAGE plpgsql;

-- Procedure to archive payments for compliance (1 year)
CREATE OR REPLACE FUNCTION archive_payments_compliance()
RETURNS TABLE(
    archived_count INTEGER,
    compliance_triggered BOOLEAN,
    message TEXT
) AS $$
DECLARE
    retention_years INTEGER;
    archived_rows INTEGER := 0;
    config_value TEXT;
BEGIN
    -- Get configuration values
    SELECT config_value INTO config_value FROM archival_config WHERE config_key = 'archival_enabled';
    IF config_value != 'true' THEN
        RETURN QUERY SELECT 0, false, 'Archival is disabled'::TEXT;
        RETURN;
    END IF;
    
    SELECT config_value INTO config_value FROM archival_config WHERE config_key = 'compliance_retention_years';
    retention_years := config_value::INTEGER;
    
    -- Archive payments older than retention period
    WITH payments_to_archive AS (
        SELECT * FROM payments_partitioned 
        WHERE created_at < NOW() - INTERVAL '1 year' * retention_years
        AND status IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')
    )
    INSERT INTO payments_archive (
        id, user_id, order_id, amount, currency, status, 
        payment_method_id, gateway_response, idempotency_key, 
        created_at, updated_at
    )
    SELECT 
        id, user_id, order_id, amount, currency, status,
        payment_method_id, gateway_response, idempotency_key,
        created_at, updated_at
    FROM payments_to_archive;
    
    -- Delete archived payments from main table
    WITH payments_to_archive AS (
        SELECT id FROM payments_partitioned 
        WHERE created_at < NOW() - INTERVAL '1 year' * retention_years
        AND status IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')
    )
    DELETE FROM payments_partitioned 
    WHERE id IN (SELECT id FROM payments_to_archive);
    
    GET DIAGNOSTICS archived_rows = ROW_COUNT;
    
    -- Update last archival timestamp
    UPDATE archival_config 
    SET config_value = NOW()::TEXT, updated_at = NOW()
    WHERE config_key = 'last_compliance_archival';
    
    RETURN QUERY SELECT archived_rows, true, format('Archived %s payments for compliance (%s years)', archived_rows, retention_years);
END;
$$ LANGUAGE plpgsql;

-- Procedure to generate payment reports (7-year retention)
CREATE OR REPLACE FUNCTION generate_payment_reports()
RETURNS TABLE(
    report_count INTEGER,
    reports_generated BOOLEAN,
    message TEXT
) AS $$
DECLARE
    retention_years INTEGER;
    report_rows INTEGER := 0;
    config_value TEXT;
BEGIN
    -- Get configuration values
    SELECT config_value INTO config_value FROM archival_config WHERE config_key = 'archival_enabled';
    IF config_value != 'true' THEN
        RETURN QUERY SELECT 0, false, 'Archival is disabled'::TEXT;
        RETURN;
    END IF;
    
    SELECT config_value INTO config_value FROM archival_config WHERE config_key = 'reports_retention_years';
    retention_years := config_value::INTEGER;
    
    -- Generate reports for payments older than 1 year
    INSERT INTO payment_reports (
        payment_id, user_id, order_id, amount, currency, status,
        payment_method_id, gateway_response, created_at, updated_at
    )
    SELECT 
        id, user_id, order_id, amount, currency, status,
        payment_method_id, gateway_response, created_at, updated_at
    FROM payments_partitioned 
    WHERE created_at < NOW() - INTERVAL '1 year'
    AND id NOT IN (SELECT payment_id FROM payment_reports);
    
    GET DIAGNOSTICS report_rows = ROW_COUNT;
    
    -- Update last reports generation timestamp
    UPDATE archival_config 
    SET config_value = NOW()::TEXT, updated_at = NOW()
    WHERE config_key = 'last_reports_generation';
    
    RETURN QUERY SELECT report_rows, true, format('Generated %s payment reports', report_rows);
END;
$$ LANGUAGE plpgsql;

-- Procedure to archive refunds (follows same pattern as payments)
CREATE OR REPLACE FUNCTION archive_refunds_compliance()
RETURNS TABLE(
    archived_count INTEGER,
    compliance_triggered BOOLEAN,
    message TEXT
) AS $$
DECLARE
    retention_years INTEGER;
    archived_rows INTEGER := 0;
    config_value TEXT;
BEGIN
    -- Get configuration values
    SELECT config_value INTO config_value FROM archival_config WHERE config_key = 'archival_enabled';
    IF config_value != 'true' THEN
        RETURN QUERY SELECT 0, false, 'Archival is disabled'::TEXT;
        RETURN;
    END IF;
    
    SELECT config_value INTO config_value FROM archival_config WHERE config_key = 'compliance_retention_years';
    retention_years := config_value::INTEGER;
    
    -- Archive refunds older than retention period
    WITH refunds_to_archive AS (
        SELECT * FROM refunds_partitioned 
        WHERE created_at < NOW() - INTERVAL '1 year' * retention_years
        AND status IN ('SUCCEEDED', 'FAILED')
    )
    INSERT INTO refunds_archive (
        id, payment_id, amount, currency, status, reason,
        idempotency_key, created_at, updated_at
    )
    SELECT 
        id, payment_id, amount, currency, status, reason,
        idempotency_key, created_at, updated_at
    FROM refunds_to_archive;
    
    -- Delete archived refunds from main table
    WITH refunds_to_archive AS (
        SELECT id FROM refunds_partitioned 
        WHERE created_at < NOW() - INTERVAL '1 year' * retention_years
        AND status IN ('SUCCEEDED', 'FAILED')
    )
    DELETE FROM refunds_partitioned 
    WHERE id IN (SELECT id FROM refunds_to_archive);
    
    GET DIAGNOSTICS archived_rows = ROW_COUNT;
    
    RETURN QUERY SELECT archived_rows, true, format('Archived %s refunds for compliance (%s years)', archived_rows, retention_years);
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- ARCHIVAL MONITORING AND STATUS
-- =============================================

-- Function to get archival status
CREATE OR REPLACE FUNCTION get_archival_status()
RETURNS TABLE(
    table_name TEXT,
    current_count BIGINT,
    closed_count BIGINT,
    old_count BIGINT,
    archive_count BIGINT,
    last_archival TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        'payments_partitioned'::TEXT as table_name,
        COUNT(*) as current_count,
        COUNT(*) FILTER (WHERE status IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')) as closed_count,
        COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '1 year') as old_count,
        (SELECT COUNT(*) FROM payments_archive) as archive_count,
        (SELECT config_value::TIMESTAMPTZ FROM archival_config WHERE config_key = 'last_performance_archival') as last_archival
    FROM payments_partitioned
    UNION ALL
    SELECT 
        'refunds_partitioned'::TEXT as table_name,
        COUNT(*) as current_count,
        COUNT(*) FILTER (WHERE status IN ('SUCCEEDED', 'FAILED')) as closed_count,
        COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '1 year') as old_count,
        (SELECT COUNT(*) FROM refunds_archive) as archive_count,
        (SELECT config_value::TIMESTAMPTZ FROM archival_config WHERE config_key = 'last_compliance_archival') as last_archival
    FROM refunds_partitioned
    UNION ALL
    SELECT 
        'payment_reports'::TEXT as table_name,
        COUNT(*) as current_count,
        COUNT(*) as closed_count,
        COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '1 year') as old_count,
        0 as archive_count,
        (SELECT config_value::TIMESTAMPTZ FROM archival_config WHERE config_key = 'last_reports_generation') as last_archival
    FROM payment_reports;
END;
$$ LANGUAGE plpgsql;

-- Function to check if archival is needed
CREATE OR REPLACE FUNCTION check_archival_needed()
RETURNS TABLE(
    performance_needed BOOLEAN,
    compliance_needed BOOLEAN,
    reports_needed BOOLEAN,
    performance_count INTEGER,
    compliance_count INTEGER,
    reports_count INTEGER
) AS $$
DECLARE
    current_count INTEGER;
    threshold_count INTEGER;
    old_count INTEGER;
    config_value TEXT;
BEGIN
    -- Get configuration
    SELECT config_value INTO config_value FROM archival_config WHERE config_key = 'performance_threshold';
    threshold_count := config_value::INTEGER;
    
    -- Get current counts
    SELECT COUNT(*) INTO current_count FROM payments_partitioned;
    SELECT COUNT(*) INTO old_count FROM payments_partitioned WHERE created_at < NOW() - INTERVAL '1 year';
    
    RETURN QUERY SELECT 
        (current_count > threshold_count) as performance_needed,
        (old_count > 0) as compliance_needed,
        (old_count > 0) as reports_needed,
        current_count as performance_count,
        old_count as compliance_count,
        old_count as reports_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- ARCHIVAL SCHEDULING
-- =============================================

-- Function to run all archival jobs
CREATE OR REPLACE FUNCTION run_archival_jobs()
RETURNS TABLE(
    job_name TEXT,
    executed BOOLEAN,
    result_count INTEGER,
    message TEXT
) AS $$
DECLARE
    performance_result RECORD;
    compliance_result RECORD;
    reports_result RECORD;
    refunds_result RECORD;
BEGIN
    -- Run performance archival
    SELECT * INTO performance_result FROM archive_closed_payments_performance();
    RETURN QUERY SELECT 
        'performance_archival'::TEXT,
        performance_result.threshold_exceeded,
        performance_result.archived_count,
        performance_result.message;
    
    -- Run compliance archival
    SELECT * INTO compliance_result FROM archive_payments_compliance();
    RETURN QUERY SELECT 
        'compliance_archival'::TEXT,
        compliance_result.compliance_triggered,
        compliance_result.archived_count,
        compliance_result.message;
    
    -- Run reports generation
    SELECT * INTO reports_result FROM generate_payment_reports();
    RETURN QUERY SELECT 
        'reports_generation'::TEXT,
        reports_result.reports_generated,
        reports_result.report_count,
        reports_result.message;
    
    -- Run refunds archival
    SELECT * INTO refunds_result FROM archive_refunds_compliance();
    RETURN QUERY SELECT 
        'refunds_archival'::TEXT,
        refunds_result.compliance_triggered,
        refunds_result.archived_count,
        refunds_result.message;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- ARCHIVAL CONFIGURATION MANAGEMENT
-- =============================================

-- Function to update archival configuration
CREATE OR REPLACE FUNCTION update_archival_config(
    p_config_key VARCHAR(100),
    p_config_value TEXT
) RETURNS BOOLEAN AS $$
BEGIN
    UPDATE archival_config 
    SET config_value = p_config_value, updated_at = NOW()
    WHERE config_key = p_config_key;
    
    IF FOUND THEN
        RETURN TRUE;
    ELSE
        INSERT INTO archival_config (config_key, config_value)
        VALUES (p_config_key, p_config_value);
        RETURN TRUE;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Function to get archival configuration
CREATE OR REPLACE FUNCTION get_archival_config()
RETURNS TABLE(
    config_key VARCHAR(100),
    config_value TEXT,
    description TEXT,
    updated_at TIMESTAMPTZ
) AS $$
BEGIN
    RETURN QUERY
    SELECT ac.config_key, ac.config_value, ac.description, ac.updated_at
    FROM archival_config ac
    ORDER BY ac.config_key;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- ARCHIVAL VERIFICATION
-- =============================================

-- Function to verify archival integrity
CREATE OR REPLACE FUNCTION verify_archival_integrity()
RETURNS TABLE(
    check_name TEXT,
    passed BOOLEAN,
    message TEXT
) AS $$
DECLARE
    total_payments BIGINT;
    archived_payments BIGINT;
    reported_payments BIGINT;
    total_refunds BIGINT;
    archived_refunds BIGINT;
BEGIN
    -- Check 1: Total payments = active + archived + reported
    SELECT COUNT(*) INTO total_payments FROM payments_partitioned;
    SELECT COUNT(*) INTO archived_payments FROM payments_archive;
    SELECT COUNT(*) INTO reported_payments FROM payment_reports;
    
    IF (total_payments + archived_payments) = (SELECT COUNT(*) FROM payments) THEN
        RETURN QUERY SELECT 'payment_count_integrity'::TEXT, TRUE, 'Payment counts match'::TEXT;
    ELSE
        RETURN QUERY SELECT 'payment_count_integrity'::TEXT, FALSE, 
            format('Payment count mismatch: active=%s, archived=%s, total=%s', 
                   total_payments, archived_payments, total_payments + archived_payments)::TEXT;
    END IF;
    
    -- Check 2: No duplicate payments in archive and active
    IF NOT EXISTS (
        SELECT 1 FROM payments_partitioned p 
        INNER JOIN payments_archive pa ON p.id = pa.id
    ) THEN
        RETURN QUERY SELECT 'no_duplicate_payments'::TEXT, TRUE, 'No duplicate payments found'::TEXT;
    ELSE
        RETURN QUERY SELECT 'no_duplicate_payments'::TEXT, FALSE, 'Duplicate payments found in archive and active'::TEXT;
    END IF;
    
    -- Check 3: Archive contains only closed payments
    IF NOT EXISTS (
        SELECT 1 FROM payments_archive 
        WHERE status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')
    ) THEN
        RETURN QUERY SELECT 'archive_closed_only'::TEXT, TRUE, 'Archive contains only closed payments'::TEXT;
    ELSE
        RETURN QUERY SELECT 'archive_closed_only'::TEXT, FALSE, 'Archive contains non-closed payments'::TEXT;
    END IF;
    
    -- Check 4: Reports table integrity
    IF NOT EXISTS (
        SELECT 1 FROM payment_reports pr
        LEFT JOIN payments_partitioned p ON pr.payment_id = p.id
        WHERE p.id IS NULL
    ) THEN
        RETURN QUERY SELECT 'reports_integrity'::TEXT, TRUE, 'All reports reference valid payments'::TEXT;
    ELSE
        RETURN QUERY SELECT 'reports_integrity'::TEXT, FALSE, 'Reports reference invalid payments'::TEXT;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- COMMENTS
-- =============================================

COMMENT ON TABLE archival_config IS 'Configuration table for archival settings and thresholds';
COMMENT ON FUNCTION archive_closed_payments_performance IS 'Archives closed payments when performance threshold is exceeded';
COMMENT ON FUNCTION archive_payments_compliance IS 'Archives payments older than compliance retention period';
COMMENT ON FUNCTION generate_payment_reports IS 'Generates payment reports for 7-year retention';
COMMENT ON FUNCTION archive_refunds_compliance IS 'Archives refunds older than compliance retention period';
COMMENT ON FUNCTION get_archival_status IS 'Returns current archival status for all tables';
COMMENT ON FUNCTION check_archival_needed IS 'Checks if archival is needed based on current data';
COMMENT ON FUNCTION run_archival_jobs IS 'Runs all archival jobs and returns results';
COMMENT ON FUNCTION verify_archival_integrity IS 'Verifies data integrity across all archival tables';
