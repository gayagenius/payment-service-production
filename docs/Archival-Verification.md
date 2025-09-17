# Archival Verification and Compliance Documentation

## Overview

This document provides comprehensive guidelines for verifying archival processes, ensuring compliance with data retention policies, and maintaining data integrity across the payment service's partitioned and archived tables.

## Table of Contents

1. [Archival Architecture](#archival-architecture)
2. [Compliance Requirements](#compliance-requirements)
3. [Verification Procedures](#verification-procedures)
4. [Monitoring and Alerting](#monitoring-and-alerting)
5. [Troubleshooting](#troubleshooting)
6. [Compliance Checklist](#compliance-checklist)

## Archival Architecture

### Table Structure

The payment service uses a three-tier archival architecture:

1. **Active Tables** (`payments_partitioned`, `refunds_partitioned`)
   - Current, frequently accessed data
   - Partitioned by `created_at` for performance
   - Performance threshold: 49,999 rows

2. **Archive Tables** (`payments_archive`, `refunds_archive`)
   - Closed payments older than 1 year
   - Performance-archived payments (oldest 20k when threshold exceeded)
   - Compliance-archived payments (1+ years old)

3. **Reports Table** (`payment_reports`)
   - 7-year retention for compliance
   - Read-only historical data
   - Used for audits and reporting

### Archival Triggers

#### Performance Archival
- **Trigger**: When `payments_partitioned` exceeds 49,999 rows
- **Action**: Archive oldest 20,000 closed payments
- **Frequency**: Automatic, triggered by threshold
- **Retention**: Indefinite in archive tables

#### Compliance Archival
- **Trigger**: Payments older than 1 year
- **Action**: Archive closed payments to archive tables
- **Frequency**: Daily (scheduled job)
- **Retention**: 1 year in active tables, indefinite in archive

#### Reports Generation
- **Trigger**: Payments older than 1 year
- **Action**: Generate reports for 7-year retention
- **Frequency**: Daily (scheduled job)
- **Retention**: 7 years in reports table

## Compliance Requirements

### Data Retention Policies

| Data Type | Active Tables | Archive Tables | Reports Table |
|-----------|---------------|----------------|---------------|
| Open Payments | Indefinite | N/A | N/A |
| Closed Payments | 1 year | Indefinite | 7 years |
| Payment History | 1 year | Indefinite | 7 years |
| Refunds | 1 year | Indefinite | 7 years |

### Regulatory Compliance

#### PCI DSS Compliance
- **Requirement**: Secure storage of payment data
- **Implementation**: Encrypted storage in all tables
- **Verification**: Regular encryption key rotation

#### GDPR Compliance
- **Requirement**: Right to be forgotten
- **Implementation**: Data anonymization in archive tables
- **Verification**: Audit trail for data deletion

#### SOX Compliance
- **Requirement**: Financial data integrity
- **Implementation**: Immutable audit trail
- **Verification**: Regular integrity checks

## Verification Procedures

### Daily Verification

#### 1. Archival Status Check
```sql
-- Check archival status
SELECT * FROM get_archival_status();

-- Verify no data loss
SELECT * FROM verify_archival_integrity();
```

#### 2. Performance Threshold Monitoring
```sql
-- Check if performance archival is needed
SELECT * FROM check_archival_needed();

-- Monitor partition sizes
SELECT * FROM partition_sizes;
```

#### 3. Data Integrity Verification
```sql
-- Verify payment counts
SELECT 
    'payments_partitioned' as table_name,
    COUNT(*) as count
FROM payments_partitioned
UNION ALL
SELECT 
    'payments_archive' as table_name,
    COUNT(*) as count
FROM payments_archive
UNION ALL
SELECT 
    'payment_reports' as table_name,
    COUNT(*) as count
FROM payment_reports;
```

### Weekly Verification

#### 1. Compliance Audit
```sql
-- Check for payments older than 1 year in active tables
SELECT COUNT(*) as old_payments
FROM payments_partitioned
WHERE created_at < NOW() - INTERVAL '1 year'
AND status IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');
```

#### 2. Archive Table Health
```sql
-- Check archive table sizes
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE tablename IN ('payments_archive', 'refunds_archive', 'payment_reports')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

#### 3. Index Performance
```sql
-- Check index usage statistics
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_scan as index_scans,
    idx_tup_read as tuples_read,
    idx_tup_fetch as tuples_fetched
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
AND tablename IN ('payments_partitioned', 'refunds_partitioned', 'payments_archive', 'refunds_archive')
ORDER BY idx_scan DESC;
```

### Monthly Verification

#### 1. Full Data Integrity Check
```sql
-- Comprehensive integrity verification
SELECT 
    'payment_count_integrity' as check_name,
    CASE 
        WHEN (SELECT COUNT(*) FROM payments_partitioned) + 
             (SELECT COUNT(*) FROM payments_archive) = 
             (SELECT COUNT(*) FROM payments) 
        THEN 'PASS' 
        ELSE 'FAIL' 
    END as result
UNION ALL
SELECT 
    'no_duplicate_payments' as check_name,
    CASE 
        WHEN NOT EXISTS (
            SELECT 1 FROM payments_partitioned p 
            INNER JOIN payments_archive pa ON p.id = pa.id
        ) 
        THEN 'PASS' 
        ELSE 'FAIL' 
    END as result
UNION ALL
SELECT 
    'archive_closed_only' as check_name,
    CASE 
        WHEN NOT EXISTS (
            SELECT 1 FROM payments_archive 
            WHERE status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')
        ) 
        THEN 'PASS' 
        ELSE 'FAIL' 
    END as result;
```

#### 2. Compliance Report Generation
```sql
-- Generate compliance report
SELECT 
    'Active Payments' as category,
    COUNT(*) as count,
    MIN(created_at) as oldest_record,
    MAX(created_at) as newest_record
FROM payments_partitioned
UNION ALL
SELECT 
    'Archived Payments' as category,
    COUNT(*) as count,
    MIN(created_at) as oldest_record,
    MAX(created_at) as newest_record
FROM payments_archive
UNION ALL
SELECT 
    'Payment Reports' as category,
    COUNT(*) as count,
    MIN(created_at) as oldest_record,
    MAX(created_at) as newest_record
FROM payment_reports;
```

## Monitoring and Alerting

### Key Metrics to Monitor

#### 1. Archival Performance
- **Metric**: Archival job execution time
- **Threshold**: < 5 minutes
- **Alert**: If archival takes longer than 10 minutes

#### 2. Data Integrity
- **Metric**: Failed integrity checks
- **Threshold**: 0 failures
- **Alert**: Any integrity check failure

#### 3. Storage Usage
- **Metric**: Archive table growth rate
- **Threshold**: < 10% growth per month
- **Alert**: If growth exceeds 20% per month

#### 4. Query Performance
- **Metric**: Average query execution time
- **Threshold**: < 100ms for read queries
- **Alert**: If queries exceed 500ms

### Alerting Rules

#### Critical Alerts
- Data integrity check failures
- Archival job failures
- Storage space > 90% full
- Query performance degradation > 5x baseline

#### Warning Alerts
- Archival job duration > 5 minutes
- Storage growth rate > 15% per month
- Index usage < 50% for critical indexes
- Replication lag > 30 seconds

### Monitoring Queries

#### 1. Archival Job Status
```sql
-- Check last archival timestamps
SELECT 
    config_key,
    config_value::TIMESTAMPTZ as last_run,
    NOW() - config_value::TIMESTAMPTZ as time_since_last_run
FROM archival_config
WHERE config_key LIKE 'last_%_archival' OR config_key LIKE 'last_%_generation';
```

#### 2. Storage Monitoring
```sql
-- Monitor storage usage
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
    pg_total_relation_size(schemaname||'.'||tablename) as size_bytes
FROM pg_tables 
WHERE schemaname = 'public'
AND tablename IN ('payments_partitioned', 'refunds_partitioned', 'payments_archive', 'refunds_archive', 'payment_reports')
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

#### 3. Performance Monitoring
```sql
-- Monitor query performance
SELECT 
    query,
    calls,
    total_time,
    mean_time,
    rows
FROM pg_stat_statements
WHERE query LIKE '%payments%' OR query LIKE '%refunds%'
ORDER BY total_time DESC
LIMIT 10;
```

## Troubleshooting

### Common Issues

#### 1. Archival Job Failures
**Symptoms**: Archival jobs not running or failing
**Causes**: 
- Database connection issues
- Insufficient disk space
- Lock contention
- Configuration errors

**Solutions**:
```sql
-- Check archival configuration
SELECT * FROM get_archival_config();

-- Verify archival functions
SELECT * FROM archive_closed_payments_performance();
SELECT * FROM archive_payments_compliance();
```

#### 2. Data Integrity Issues
**Symptoms**: Integrity check failures
**Causes**:
- Concurrent modifications during archival
- Network issues during data transfer
- Database corruption

**Solutions**:
```sql
-- Run integrity verification
SELECT * FROM verify_archival_integrity();

-- Check for duplicate data
SELECT id, COUNT(*) as count
FROM (
    SELECT id FROM payments_partitioned
    UNION ALL
    SELECT id FROM payments_archive
) t
GROUP BY id
HAVING COUNT(*) > 1;
```

#### 3. Performance Degradation
**Symptoms**: Slow queries, high CPU usage
**Causes**:
- Missing indexes
- Outdated statistics
- Large table scans

**Solutions**:
```sql
-- Update table statistics
ANALYZE payments_partitioned;
ANALYZE payments_archive;
ANALYZE payment_reports;

-- Check index usage
SELECT * FROM pg_stat_user_indexes
WHERE schemaname = 'public'
AND tablename IN ('payments_partitioned', 'payments_archive');
```

### Recovery Procedures

#### 1. Data Recovery
If data is accidentally archived or deleted:

```sql
-- Restore from archive
INSERT INTO payments_partitioned (
    id, user_id, order_id, amount, currency, status,
    payment_method_id, gateway_response, idempotency_key,
    created_at, updated_at
)
SELECT 
    id, user_id, order_id, amount, currency, status,
    payment_method_id, gateway_response, idempotency_key,
    created_at, updated_at
FROM payments_archive
WHERE id = 'payment-id-to-restore';

-- Remove from archive
DELETE FROM payments_archive WHERE id = 'payment-id-to-restore';
```

#### 2. Archival Rollback
If archival needs to be rolled back:

```sql
-- Disable archival
UPDATE archival_config 
SET config_value = 'false' 
WHERE config_key = 'archival_enabled';

-- Restore all archived data
INSERT INTO payments_partitioned (
    id, user_id, order_id, amount, currency, status,
    payment_method_id, gateway_response, idempotency_key,
    created_at, updated_at
)
SELECT 
    id, user_id, order_id, amount, currency, status,
    payment_method_id, gateway_response, idempotency_key,
    created_at, updated_at
FROM payments_archive;

-- Clear archive tables
TRUNCATE payments_archive;
TRUNCATE refunds_archive;
```

## Compliance Checklist

### Daily Checklist
- [ ] Verify archival status
- [ ] Check data integrity
- [ ] Monitor performance thresholds
- [ ] Review error logs
- [ ] Check storage usage

### Weekly Checklist
- [ ] Run compliance audit
- [ ] Verify archive table health
- [ ] Check index performance
- [ ] Review monitoring alerts
- [ ] Update documentation

### Monthly Checklist
- [ ] Full data integrity check
- [ ] Generate compliance report
- [ ] Review archival policies
- [ ] Update monitoring thresholds
- [ ] Conduct security review

### Quarterly Checklist
- [ ] Comprehensive system audit
- [ ] Review compliance requirements
- [ ] Update archival procedures
- [ ] Test disaster recovery
- [ ] Review access controls

### Annual Checklist
- [ ] Full compliance audit
- [ ] Review data retention policies
- [ ] Update regulatory requirements
- [ ] Conduct penetration testing
- [ ] Review business continuity plans

## Conclusion

This document provides a comprehensive framework for verifying archival processes and ensuring compliance with data retention policies. Regular monitoring, verification, and maintenance are essential for maintaining data integrity and regulatory compliance.

For questions or issues related to archival verification, contact the database administration team or refer to the troubleshooting section above.
