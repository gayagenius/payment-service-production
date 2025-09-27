-- Setup Partitioning for Payment Service
-- This script creates partitioned tables and migrates existing data

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- =============================================
-- CREATE PARTITIONED TABLES
-- =============================================

-- Create partitioned payments table
CREATE TABLE payments_partitioned (
    LIKE payments INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- Create partitioned refunds table  
CREATE TABLE refunds_partitioned (
    LIKE refunds INCLUDING ALL
) PARTITION BY RANGE (created_at);

-- =============================================
-- CREATE PARTITIONS (Monthly partitions for last 2 years)
-- =============================================

-- Payments partitions
CREATE TABLE payments_partitioned_2023_01 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2023-01-01') TO ('2023-02-01');

CREATE TABLE payments_partitioned_2023_02 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2023-02-01') TO ('2023-03-01');

CREATE TABLE payments_partitioned_2023_03 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2023-03-01') TO ('2023-04-01');

CREATE TABLE payments_partitioned_2023_04 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2023-04-01') TO ('2023-05-01');

CREATE TABLE payments_partitioned_2023_05 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2023-05-01') TO ('2023-06-01');

CREATE TABLE payments_partitioned_2023_06 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2023-06-01') TO ('2023-07-01');

CREATE TABLE payments_partitioned_2023_07 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2023-07-01') TO ('2023-08-01');

CREATE TABLE payments_partitioned_2023_08 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2023-08-01') TO ('2023-09-01');

CREATE TABLE payments_partitioned_2023_09 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2023-09-01') TO ('2023-10-01');

CREATE TABLE payments_partitioned_2023_10 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2023-10-01') TO ('2023-11-01');

CREATE TABLE payments_partitioned_2023_11 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2023-11-01') TO ('2023-12-01');

CREATE TABLE payments_partitioned_2023_12 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2023-12-01') TO ('2024-01-01');

-- 2024 partitions
CREATE TABLE payments_partitioned_2024_01 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE payments_partitioned_2024_02 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

CREATE TABLE payments_partitioned_2024_03 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');

CREATE TABLE payments_partitioned_2024_04 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-04-01') TO ('2024-05-01');

CREATE TABLE payments_partitioned_2024_05 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-05-01') TO ('2024-06-01');

CREATE TABLE payments_partitioned_2024_06 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-06-01') TO ('2024-07-01');

CREATE TABLE payments_partitioned_2024_07 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-07-01') TO ('2024-08-01');

CREATE TABLE payments_partitioned_2024_08 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-08-01') TO ('2024-09-01');

CREATE TABLE payments_partitioned_2024_09 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-09-01') TO ('2024-10-01');

CREATE TABLE payments_partitioned_2024_10 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-10-01') TO ('2024-11-01');

CREATE TABLE payments_partitioned_2024_11 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');

CREATE TABLE payments_partitioned_2024_12 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

-- 2025 partitions
CREATE TABLE payments_partitioned_2025_01 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE payments_partitioned_2025_02 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

CREATE TABLE payments_partitioned_2025_03 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');

CREATE TABLE payments_partitioned_2025_04 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');

CREATE TABLE payments_partitioned_2025_05 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');

CREATE TABLE payments_partitioned_2025_06 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

CREATE TABLE payments_partitioned_2025_07 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');

CREATE TABLE payments_partitioned_2025_08 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');

CREATE TABLE payments_partitioned_2025_09 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');

CREATE TABLE payments_partitioned_2025_10 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

CREATE TABLE payments_partitioned_2025_11 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

CREATE TABLE payments_partitioned_2025_12 PARTITION OF payments_partitioned
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

-- Refunds partitions (same structure)
CREATE TABLE refunds_partitioned_2023_01 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2023-01-01') TO ('2023-02-01');

CREATE TABLE refunds_partitioned_2023_02 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2023-02-01') TO ('2023-03-01');

CREATE TABLE refunds_partitioned_2023_03 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2023-03-01') TO ('2023-04-01');

CREATE TABLE refunds_partitioned_2023_04 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2023-04-01') TO ('2023-05-01');

CREATE TABLE refunds_partitioned_2023_05 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2023-05-01') TO ('2023-06-01');

CREATE TABLE refunds_partitioned_2023_06 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2023-06-01') TO ('2023-07-01');

CREATE TABLE refunds_partitioned_2023_07 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2023-07-01') TO ('2023-08-01');

CREATE TABLE refunds_partitioned_2023_08 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2023-08-01') TO ('2023-09-01');

CREATE TABLE refunds_partitioned_2023_09 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2023-09-01') TO ('2023-10-01');

CREATE TABLE refunds_partitioned_2023_10 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2023-10-01') TO ('2023-11-01');

CREATE TABLE refunds_partitioned_2023_11 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2023-11-01') TO ('2023-12-01');

CREATE TABLE refunds_partitioned_2023_12 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2023-12-01') TO ('2024-01-01');

-- 2024 refunds partitions
CREATE TABLE refunds_partitioned_2024_01 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');

CREATE TABLE refunds_partitioned_2024_02 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-02-01') TO ('2024-03-01');

CREATE TABLE refunds_partitioned_2024_03 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');

CREATE TABLE refunds_partitioned_2024_04 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-04-01') TO ('2024-05-01');

CREATE TABLE refunds_partitioned_2024_05 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-05-01') TO ('2024-06-01');

CREATE TABLE refunds_partitioned_2024_06 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-06-01') TO ('2024-07-01');

CREATE TABLE refunds_partitioned_2024_07 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-07-01') TO ('2024-08-01');

CREATE TABLE refunds_partitioned_2024_08 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-08-01') TO ('2024-09-01');

CREATE TABLE refunds_partitioned_2024_09 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-09-01') TO ('2024-10-01');

CREATE TABLE refunds_partitioned_2024_10 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-10-01') TO ('2024-11-01');

CREATE TABLE refunds_partitioned_2024_11 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-11-01') TO ('2024-12-01');

CREATE TABLE refunds_partitioned_2024_12 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2024-12-01') TO ('2025-01-01');

-- 2025 refunds partitions
CREATE TABLE refunds_partitioned_2025_01 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2025-01-01') TO ('2025-02-01');

CREATE TABLE refunds_partitioned_2025_02 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2025-02-01') TO ('2025-03-01');

CREATE TABLE refunds_partitioned_2025_03 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2025-03-01') TO ('2025-04-01');

CREATE TABLE refunds_partitioned_2025_04 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2025-04-01') TO ('2025-05-01');

CREATE TABLE refunds_partitioned_2025_05 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2025-05-01') TO ('2025-06-01');

CREATE TABLE refunds_partitioned_2025_06 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2025-06-01') TO ('2025-07-01');

CREATE TABLE refunds_partitioned_2025_07 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2025-07-01') TO ('2025-08-01');

CREATE TABLE refunds_partitioned_2025_08 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2025-08-01') TO ('2025-09-01');

CREATE TABLE refunds_partitioned_2025_09 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2025-09-01') TO ('2025-10-01');

CREATE TABLE refunds_partitioned_2025_10 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2025-10-01') TO ('2025-11-01');

CREATE TABLE refunds_partitioned_2025_11 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2025-11-01') TO ('2025-12-01');

CREATE TABLE refunds_partitioned_2025_12 PARTITION OF refunds_partitioned
    FOR VALUES FROM ('2025-12-01') TO ('2026-01-01');

-- =============================================
-- CREATE INDEXES ON PARTITIONED TABLES
-- =============================================

-- Payments indexes
CREATE INDEX idx_payments_partitioned_user_id_created ON payments_partitioned(user_id, created_at DESC);
CREATE INDEX idx_payments_partitioned_status_created ON payments_partitioned(status, created_at DESC);
CREATE INDEX idx_payments_partitioned_metadata ON payments_partitioned USING GIN(metadata);
CREATE INDEX idx_payments_partitioned_idempotency_key ON payments_partitioned(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- Refunds indexes
CREATE INDEX idx_refunds_partitioned_payment_id_created ON refunds_partitioned(payment_id, created_at DESC);
CREATE INDEX idx_refunds_partitioned_status ON refunds_partitioned(status);

-- =============================================
-- MIGRATE EXISTING DATA
-- =============================================

-- Migrate payments data
INSERT INTO payments_partitioned SELECT * FROM payments;

-- Migrate refunds data
INSERT INTO refunds_partitioned SELECT * FROM refunds;

-- =============================================
-- CREATE ARCHIVE TABLE
-- =============================================

CREATE TABLE payments_archive (
    LIKE payments_partitioned INCLUDING ALL
);

CREATE TABLE refunds_archive (
    LIKE refunds_partitioned INCLUDING ALL
);

-- =============================================
-- CREATE ARCHIVAL FUNCTION
-- =============================================

CREATE OR REPLACE FUNCTION archive_old_payments(archive_count INTEGER DEFAULT 20000)
RETURNS INTEGER AS $$
DECLARE
    archived_count INTEGER := 0;
BEGIN
    -- Archive oldest payments
    WITH old_payments AS (
        SELECT * FROM payments_partitioned 
        ORDER BY created_at ASC 
        LIMIT archive_count
    )
    INSERT INTO payments_archive 
    SELECT * FROM old_payments;
    
    GET DIAGNOSTICS archived_count = ROW_COUNT;
    
    -- Delete archived payments from main table
    DELETE FROM payments_partitioned 
    WHERE id IN (
        SELECT id FROM payments_archive 
        ORDER BY created_at ASC 
        LIMIT archive_count
    );
    
    RETURN archived_count;
END;
$$ LANGUAGE plpgsql;

-- =============================================
-- VERIFICATION
-- =============================================

-- Check partitioned tables
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE tablename LIKE '%partitioned%'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Check data migration
SELECT 'Original Payments' as table_name, COUNT(*) as count FROM payments
UNION ALL
SELECT 'Partitioned Payments', COUNT(*) FROM payments_partitioned
UNION ALL
SELECT 'Original Refunds', COUNT(*) FROM refunds
UNION ALL
SELECT 'Partitioned Refunds', COUNT(*) FROM refunds_partitioned;
