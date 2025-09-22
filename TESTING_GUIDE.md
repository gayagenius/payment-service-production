# 🧪 Comprehensive Testing Guide

This guide covers all testing scenarios for the payment service, including partitioning, archiving, load testing, and compliance validation.

## 🚀 Quick Start

### Run All Tests
```bash
npm run test:all
```

### Run Individual Test Suites
```bash
# Partitioning tests
npm run test:partitioning

# Archiving and compliance tests
npm run test:archiving

# Load tests (50k+ records)
npm run test:load

# End-to-end tests
npm run test:e2e
```

## 📋 Test Suites Overview

### 1. Partitioning Tests (`test-partitioning.js`)
**Purpose**: Validates partitioning functionality and performance

**Tests**:
- ✅ Partitioning enabled and configured
- ✅ Partition creation and management
- ✅ Data distribution across partitions
- ✅ Query performance optimization
- ✅ Partition pruning effectiveness

**What it validates**:
- Tables are properly partitioned by `created_at`
- Data is distributed correctly across partitions
- Queries only hit relevant partitions
- Performance is optimized for large datasets

### 2. Archiving Tests (`test-archiving.js`)
**Purpose**: Validates archival thresholds and compliance retention

**Tests**:
- ✅ Threshold-based archiving (49,999 records)
- ✅ 7-year compliance retention
- ✅ Data integrity after archiving
- ✅ Archival performance under load
- ✅ Compliance reporting capabilities

**What it validates**:
- Archival triggers at correct thresholds
- Old data is preserved for compliance
- Archived data remains accessible
- No data loss during archival process
- Reports can access historical data

### 3. Load Tests (`test-load.js`)
**Purpose**: Validates system performance under high load

**Tests**:
- ✅ Database connection pool handling
- ✅ Bulk data insertion (50k+ records)
- ✅ Concurrent query performance
- ✅ API load testing
- ✅ Connection timeout handling
- ✅ Data integrity under load

**What it validates**:
- System can handle 50k+ records without breaking
- No connection timeouts under load
- No data loss during high-volume operations
- API endpoints remain responsive
- Database performance remains stable

### 4. End-to-End Tests (`test-e2e.js`)
**Purpose**: Validates complete system functionality

**Tests**:
- ✅ Payment creation and processing
- ✅ Retry functionality with idempotency keys
- ✅ Payment history tracking
- ✅ Safe helper functions
- ✅ Read/write pool separation
- ✅ Data integrity across all operations
- ✅ API endpoint functionality

**What it validates**:
- All API endpoints work correctly
- Retry functionality works with idempotency keys
- Safe helpers function properly
- Read/write pools are configured correctly
- No data loss across operations
- Complete audit trail is maintained

## 🔧 Test Configuration

### Environment Variables
```bash
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=payment_service
DB_USER=postgres
DB_PASSWORD=password

# API Configuration
PORT=8888
DOCS_PORT=8889

# Test Configuration
NODE_ENV=test
```

### Prerequisites
1. **Database Setup**: Ensure PostgreSQL is running and accessible
2. **Schema Migration**: Run `npm run db:migrate` to set up tables
3. **API Server**: Start the API server with `npm start`
4. **Test Data**: Tests will create and clean up their own test data

## 📊 Test Results Interpretation

### Success Criteria
- **Partitioning**: All partitions created, data distributed correctly
- **Archiving**: Thresholds trigger, compliance retention works
- **Load**: 50k+ records processed without issues
- **E2E**: All functionality works end-to-end

### Performance Benchmarks
- **Query Performance**: < 1000ms for most queries
- **Bulk Insertion**: > 500 records/second
- **API Response**: < 2000ms for all endpoints
- **Concurrent Operations**: > 90% success rate

### Failure Indicators
- ❌ Connection timeouts
- ❌ Data loss or corruption
- ❌ Performance degradation
- ❌ Failed API responses
- ❌ Broken audit trails

## 🚨 Troubleshooting

### Common Issues

#### 1. Database Connection Errors
```bash
# Check database status
npm run api:health

# Verify connection settings
echo $DB_HOST $DB_PORT $DB_NAME
```

#### 2. Partitioning Issues
```bash
# Check partition status
psql -d payment_service -c "
SELECT schemaname, tablename 
FROM pg_tables 
WHERE tablename LIKE '%partitioned%';
"
```

#### 3. Archiving Problems
```bash
# Check archive tables
psql -d payment_service -c "
SELECT COUNT(*) FROM payments_archive;
"
```

#### 4. Load Test Failures
```bash
# Check connection pool
psql -d payment_service -c "
SELECT count(*) FROM pg_stat_activity;
"
```

## 📈 Performance Monitoring

### Key Metrics to Monitor
1. **Database Performance**
   - Query execution times
   - Connection pool utilization
   - Index usage statistics

2. **API Performance**
   - Response times
   - Error rates
   - Throughput (requests/second)

3. **System Resources**
   - CPU usage
   - Memory consumption
   - Disk I/O

### Monitoring Commands
```bash
# Database performance
npm run db:optimize

# API health check
npm run api:health

# System logs
npm run logs
```

## 🔄 Continuous Testing

### Pre-Deployment Checklist
- [ ] All test suites pass (`npm run test:all`)
- [ ] No data loss detected
- [ ] Performance benchmarks met
- [ ] Compliance requirements satisfied
- [ ] Load testing successful

### Post-Deployment Validation
- [ ] Health checks pass
- [ ] API endpoints responsive
- [ ] Database connections stable
- [ ] Monitoring alerts configured

## 📚 Additional Resources

### Documentation
- [API Documentation](http://localhost:8889) - Swagger UI
- [Database Schema](db/schema.sql) - Complete schema definition
- [Migration Scripts](db/migrations/) - Database migrations

### Scripts
- `npm run test:all` - Run all tests
- `npm run test:partitioning` - Partitioning tests only
- `npm run test:archiving` - Archiving tests only
- `npm run test:load` - Load tests only
- `npm run test:e2e` - End-to-end tests only

### Support
- Check logs: `npm run logs`
- Health check: `npm run api:health`
- Database status: `npm run db:migrate`

---

## 🎯 Production Readiness Checklist

✅ **Partitioning enabled, migrations verified with dry-run**
✅ **Archival works (threshold + compliance cadence)**
✅ **Reports table serves history data (payments table never serves history)**
✅ **Safe read/write helpers for payments, history, refunds**
✅ **Retry key in payments endpoint works with idempotency key**
✅ **Query optimization documented**
✅ **Read/write DB pools configured and tested**
✅ **End-to-end testing confirms:**
   - No data loss
   - No breaking under load
   - Compliance rules followed
✅ **Production-ready code meeting industry standards**

**🚀 Your payment service is ready for production!**
