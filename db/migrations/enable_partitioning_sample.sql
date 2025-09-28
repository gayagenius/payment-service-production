-- Migration: Enable Partitioning for Payments and Refunds
-- Version: V001
-- Description: Implements range partitioning by created_at for scalability
-- Rollback: V001_rollback_partitioning.sql

-- =============================================
-- PARTITIONING SETUP
-- =============================================

-- Create partitioned payments table (replaces existing)
CREATE TABLE payments_partitioned (
    id UUID NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    order_id VARCHAR(255) NOT NULL,
    amount INTEGER NOT NULL,
    currency CHAR(3) NOT NULL,
    status payment_status NOT NULL DEFAULT 'PENDING',
    gateway_response JSONB NOT NULL DEFAULT '{}',
    idempotency_key VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Constraints
    CONSTRAINT chk_payments_partitioned_amount CHECK (amount > 0),
    CONSTRAINT chk_payments_partitioned_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT chk_payments_partitioned_idempotency_key CHECK (
        idempotency_key IS NULL OR length(idempotency_key) > 0
    )
) PARTITION BY RANGE (created_at);

-- Create partitioned refunds table (replaces existing)
CREATE TABLE refunds_partitioned (
    id UUID NOT NULL,
    payment_id UUID NOT NULL,
    amount INTEGER NOT NULL,
    currency CHAR(3) NOT NULL,
    status refund_status NOT NULL DEFAULT 'PENDING',
    reason TEXT NULL,
    idempotency_key VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Constraints
    CONSTRAINT chk_refunds_partitioned_amount CHECK (amount > 0),
    CONSTRAINT chk_refunds_partitioned_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT chk_refunds_partitioned_idempotency_key CHECK (
        idempotency_key IS NULL OR length(idempotency_key) > 0
    ),
    CONSTRAINT chk_refunds_partitioned_reason CHECK (
        reason IS NULL OR length(trim(reason)) > 0
    )
) PARTITION BY RANGE (created_at);

-- =============================================
-- CREATE INITIAL PARTITIONS
-- =============================================

-- Create monthly partitions for payments (starting from current month)
-- Current month partition
CREATE TABLE payments_y2024m01 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE payments_y2024m02 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

CREATE TABLE payments_y2024m03 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');

CREATE TABLE payments_y2024m04 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-04-01') TO ('2024-05-01');

CREATE TABLE payments_y2024m05 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-05-01') TO ('2024-06-01');

CREATE TABLE payments_y2024m06 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-06-01') TO ('2024-07-01');

CREATE TABLE payments_y2024m07 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-07-01') TO ('2024-08-01');

CREATE TABLE payments_y2024m08 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-08-01') TO ('2024-09-01');

CREATE TABLE payments_y2024m09 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-09-01') TO ('2024-10-01');

CREATE TABLE payments_y2024m10 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-10-01') TO ('2024-11-01');

CREATE TABLE payments_y2024m11 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');

CREATE TABLE payments_y2024m12 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

-- Create monthly partitions for refunds (same structure)
CREATE TABLE refunds_y2024m01 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE refunds_y2024m02 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

CREATE TABLE refunds_y2024m03 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');

CREATE TABLE refunds_y2024m04 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-04-01') TO ('2024-05-01');

CREATE TABLE refunds_y2024m05 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-05-01') TO ('2024-06-01');

CREATE TABLE refunds_y2024m06 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-06-01') TO ('2024-07-01');

CREATE TABLE refunds_y2024m07 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-07-01') TO ('2024-08-01');

CREATE TABLE refunds_y2024m08 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-08-01') TO ('2024-09-01');

CREATE TABLE refunds_y2024m09 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-09-01') TO ('2024-10-01');

CREATE TABLE refunds_y2024m10 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-10-01') TO ('2024-11-01');

CREATE TABLE refunds_y2024m11 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');

CREATE TABLE refunds_y2024m12 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

-- =============================================
-- CREATE ARCHIVE TABLES
-- =============================================

-- Archive table for closed payments (performance archival)
CREATE TABLE payments_archive (
    id UUID PRIMARY KEY,
    user_id VAR NOT NULL,
    order_id VARCHAR(255) NOT NULL,
    amount INTEGER NOT NULL,
    currency CHAR(3) NOT NULL,
    status payment_status NOT NULL,
    gateway_response JSONB NOT NULL DEFAULT '{}',
    idempotency_key VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Constraints
    CONSTRAINT chk_payments_archive_amount CHECK (amount > 0),
    CONSTRAINT chk_payments_archive_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT chk_payments_archive_idempotency_key CHECK (
        idempotency_key IS NULL OR length(idempotency_key) > 0
    )
);

-- Archive table for refunds
CREATE TABLE refunds_archive (
    id UUID PRIMARY KEY,
    payment_id UUID NOT NULL,
    amount INTEGER NOT NULL,
    currency CHAR(3) NOT NULL,
    status refund_status NOT NULL,
    reason TEXT NULL,
    idempotency_key VARCHAR(255) NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    archived_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Constraints
    CONSTRAINT chk_refunds_archive_amount CHECK (amount > 0),
    CONSTRAINT chk_refunds_archive_currency CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT chk_refunds_archive_idempotency_key CHECK (
        idempotency_key IS NULL OR length(idempotency_key) > 0
    ),
    CONSTRAINT chk_refunds_archive_reason CHECK (
        reason IS NULL OR length(trim(reason)) > 0
    )
);

-- =============================================
-- CREATE REPORTS TABLE (7-year retention)
-- =============================================

-- Reports table for compliance and analytics (7-year retention)
CREATE TABLE payment_reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    payment_id UUID NOT NULL,
    user_id VARCHAR(255) NOT NULL,
    order_id VARCHAR(255) NOT NULL,
    amount INTEGER NOT NULL,
    currency CHAR(3) NOT NULL,
    status payment_status NOT NULL,
    gateway_response JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    report_generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    
    -- Constraints
    CONSTRAINT chk_payment_reports_amount CHECK (amount > 0),
    CONSTRAINT chk_payment_reports_currency CHECK (currency ~ '^[A-Z]{3}$')
);

-- =============================================
-- CREATE INDEXES ON PARTITIONED TABLES
-- =============================================

-- Primary key constraints on partitioned tables
ALTER TABLE payments_partitioned ADD CONSTRAINT payments_partitioned_pkey PRIMARY KEY (id, created_at);
ALTER TABLE refunds_partitioned ADD CONSTRAINT refunds_partitioned_pkey PRIMARY KEY (id, created_at);

-- Foreign key constraints (will be added after data migration)
-- ALTER TABLE refunds_partitioned ADD CONSTRAINT fk_refunds_payment_id 
--     FOREIGN KEY (payment_id) REFERENCES payments_partitioned(id);

-- Indexes on partitioned tables
CREATE INDEX idx_payments_partitioned_user_id_created ON payments_partitioned(user_id, created_at DESC);
CREATE INDEX idx_payments_partitioned_status_created ON payments_partitioned(status, created_at DESC);
-- Payment method index removed
CREATE INDEX idx_payments_partitioned_order_id ON payments_partitioned(order_id) WHERE order_id IS NOT NULL;

CREATE INDEX idx_refunds_partitioned_payment_id_created ON refunds_partitioned(payment_id, created_at DESC);
CREATE INDEX idx_refunds_partitioned_status ON refunds_partitioned(status);

-- Unique constraints for idempotency keys
CREATE UNIQUE INDEX idx_payments_partitioned_idempotency_key 
ON payments_partitioned(idempotency_key) 
WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX idx_refunds_partitioned_idempotency_key 
ON refunds_partitioned(idempotency_key) 
WHERE idempotency_key IS NOT NULL;

-- =============================================
-- CREATE INDEXES ON ARCHIVE TABLES
-- =============================================

-- Archive table indexes
CREATE INDEX idx_payments_archive_user_id_created ON payments_archive(user_id, created_at DESC);
CREATE INDEX idx_payments_archive_status_created ON payments_archive(status, created_at DESC);
CREATE INDEX idx_payments_archive_archived_at ON payments_archive(archived_at DESC);

CREATE INDEX idx_refunds_archive_payment_id_created ON refunds_archive(payment_id, created_at DESC);
CREATE INDEX idx_refunds_archive_status ON refunds_archive(status);
CREATE INDEX idx_refunds_archive_archived_at ON refunds_archive(archived_at DESC);

-- =============================================
-- CREATE INDEXES ON REPORTS TABLE
-- =============================================

-- Reports table indexes
CREATE INDEX idx_payment_reports_user_id_created ON payment_reports(user_id, created_at DESC);
CREATE INDEX idx_payment_reports_status_created ON payment_reports(status, created_at DESC);
CREATE INDEX idx_payment_reports_report_generated_at ON payment_reports(report_generated_at DESC);

-- =============================================
-- CREATE TRIGGERS FOR PARTITIONED TABLES
-- =============================================

-- Triggers for updated_at on partitioned tables
CREATE TRIGGER update_payments_partitioned_updated_at 
    BEFORE UPDATE ON payments_partitioned 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_refunds_partitioned_updated_at 
    BEFORE UPDATE ON refunds_partitioned 
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- CREATE PARTITION MANAGEMENT FUNCTIONS
-- =============================================

-- Function to create new monthly partitions
CREATE OR REPLACE FUNCTION create_monthly_partition(
    table_name TEXT,
    start_date DATE
) RETURNS VOID AS $$
DECLARE
    partition_name TEXT;
    end_date DATE;
    sql_statement TEXT;
BEGIN
    -- Calculate partition name and end date
    partition_name := table_name || '_y' || EXTRACT(YEAR FROM start_date) || 'm' || LPAD(EXTRACT(MONTH FROM start_date)::TEXT, 2, '0');
    end_date := start_date + INTERVAL '1 month';
    
    -- Create partition for payments
    IF table_name = 'payments' THEN
        sql_statement := format('CREATE TABLE %I PARTITION OF payments_partitioned FOR VALUES FROM (%L) TO (%L)', 
                               partition_name, start_date, end_date);
        EXECUTE sql_statement;
        
        -- Create corresponding refunds partition
        sql_statement := format('CREATE TABLE %I PARTITION OF refunds_partitioned FOR VALUES FROM (%L) TO (%L)', 
                               'refunds_y' || EXTRACT(YEAR FROM start_date) || 'm' || LPAD(EXTRACT(MONTH FROM start_date)::TEXT, 2, '0'), 
                               start_date, end_date);
        EXECUTE sql_statement;
    END IF;
    
    RAISE NOTICE 'Created partition % for date range % to %', partition_name, start_date, end_date;
END;
$$ LANGUAGE plpgsql;

-- Function to get partition name for a given date
CREATE OR REPLACE FUNCTION get_partition_name(
    table_name TEXT,
    target_date TIMESTAMPTZ
) RETURNS TEXT AS $$
BEGIN
    RETURN table_name || '_y' || EXTRACT(YEAR FROM target_date) || 'm' || LPAD(EXTRACT(MONTH FROM target_date)::TEXT, 2, '0');
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- CREATE ARCHIVAL FUNCTIONS
-- =============================================

-- Function to archive closed payments (performance threshold)
CREATE OR REPLACE FUNCTION archive_closed_payments_performance()
RETURNS INTEGER AS $$
DECLARE
    archived_count INTEGER := 0;
    threshold_count INTEGER;
BEGIN
    -- Check if payments table exceeds 49,999 rows
    SELECT COUNT(*) INTO threshold_count FROM payments_partitioned;
    
    IF threshold_count > 49999 THEN
        -- Archive oldest 20,000 closed payments
        WITH payments_to_archive AS (
            SELECT * FROM payments_partitioned 
            WHERE status IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')
            ORDER BY created_at ASC 
            LIMIT 20000
        )
        INSERT INTO payments_archive (
            id, user_id, order_id, amount, currency, status, 
            gateway_response, idempotency_key, 
            created_at, updated_at
        )
        SELECT 
            id, user_id, order_id, amount, currency, status,
            gateway_response, idempotency_key,
            created_at, updated_at
        FROM payments_to_archive;
        
        -- Delete archived payments from main table
        WITH payments_to_archive AS (
            SELECT id FROM payments_partitioned 
            WHERE status IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')
            ORDER BY created_at ASC 
            LIMIT 20000
        )
        DELETE FROM payments_partitioned 
        WHERE id IN (SELECT id FROM payments_to_archive);
        
        GET DIAGNOSTICS archived_count = ROW_COUNT;
        
        RAISE NOTICE 'Archived % closed payments for performance', archived_count;
    END IF;
    
    RETURN archived_count;
END;
$$ LANGUAGE plpgsql;

-- Function to archive payments by compliance (1 year)
CREATE OR REPLACE FUNCTION archive_payments_compliance()
RETURNS INTEGER AS $$
DECLARE
    archived_count INTEGER := 0;
BEGIN
    -- Archive payments older than 1 year
    WITH payments_to_archive AS (
        SELECT * FROM payments_partitioned 
        WHERE created_at < NOW() - INTERVAL '1 year'
        AND status IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')
    )
    INSERT INTO payments_archive (
        id, user_id, order_id, amount, currency, status, 
        gateway_response, idempotency_key, 
        created_at, updated_at
    )
    SELECT 
        id, user_id, order_id, amount, currency, status,
        gateway_response, idempotency_key,
        created_at, updated_at
    FROM payments_to_archive;
    
    -- Delete archived payments from main table
    WITH payments_to_archive AS (
        SELECT id FROM payments_partitioned 
        WHERE created_at < NOW() - INTERVAL '1 year'
        AND status IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')
    )
    DELETE FROM payments_partitioned 
    WHERE id IN (SELECT id FROM payments_to_archive);
    
    GET DIAGNOSTICS archived_count = ROW_COUNT;
    
    RAISE NOTICE 'Archived % payments for compliance (1 year)', archived_count;
    
    RETURN archived_count;
END;
$$ LANGUAGE plpgsql;

-- Function to generate reports (7-year retention)
CREATE OR REPLACE FUNCTION generate_payment_reports()
RETURNS INTEGER AS $$
DECLARE
    report_count INTEGER := 0;
BEGIN
    -- Generate reports for payments older than 1 year
    INSERT INTO payment_reports (
        payment_id, user_id, order_id, amount, currency, status,
        gateway_response, created_at, updated_at
    )
    SELECT 
        id, user_id, order_id, amount, currency, status,
        gateway_response, created_at, updated_at
    FROM payments_partitioned 
    WHERE created_at < NOW() - INTERVAL '1 year'
    AND id NOT IN (SELECT payment_id FROM payment_reports);
    
    GET DIAGNOSTICS report_count = ROW_COUNT;
    
    RAISE NOTICE 'Generated % payment reports', report_count;
    
    RETURN report_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- CREATE MONITORING VIEWS
-- =============================================

-- View to monitor partition sizes
CREATE VIEW partition_sizes AS
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
    pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
FROM pg_tables 
WHERE tablename LIKE 'payments_y%' OR tablename LIKE 'refunds_y%'
ORDER BY size_bytes DESC;

-- View to monitor archival status
CREATE VIEW archival_status AS
SELECT 
    'payments_partitioned' as table_name,
    COUNT(*) as current_count,
    COUNT(*) FILTER (WHERE status IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')) as closed_count,
    COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '1 year') as old_count
FROM payments_partitioned
UNION ALL
SELECT 
    'payments_archive' as table_name,
    COUNT(*) as current_count,
    COUNT(*) as closed_count,
    COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '1 year') as old_count
FROM payments_archive
UNION ALL
SELECT 
    'payment_reports' as table_name,
    COUNT(*) as current_count,
    COUNT(*) as closed_count,
    COUNT(*) FILTER (WHERE created_at < NOW() - INTERVAL '1 year') as old_count
FROM payment_reports;

-- =============================================
-- COMMENTS
-- =============================================

COMMENT ON TABLE payments_partitioned IS 'Partitioned payments table for scalability - partitioned by created_at';
COMMENT ON TABLE refunds_partitioned IS 'Partitioned refunds table for scalability - partitioned by created_at';
COMMENT ON TABLE payments_archive IS 'Archive table for closed payments (performance and compliance archival)';
COMMENT ON TABLE refunds_archive IS 'Archive table for closed refunds';
COMMENT ON TABLE payment_reports IS 'Reports table for compliance and analytics (7-year retention)';

COMMENT ON FUNCTION create_monthly_partition IS 'Creates new monthly partitions for payments and refunds';
COMMENT ON FUNCTION archive_closed_payments_performance IS 'Archives closed payments when threshold exceeded (49,999 rows)';
COMMENT ON FUNCTION archive_payments_compliance IS 'Archives payments older than 1 year for compliance';
COMMENT ON FUNCTION generate_payment_reports IS 'Generates payment reports for 7-year retention';

COMMENT ON VIEW partition_sizes IS 'Monitor partition sizes for maintenance';
COMMENT ON VIEW archival_status IS 'Monitor archival status across all tables';
