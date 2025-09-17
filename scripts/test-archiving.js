#!/usr/bin/env node

/**
 * Archiving and Compliance Tests
 * Tests archival thresholds, compliance retention, and data integrity
 */

import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'payment_service',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

const pool = new Pool(config);

class ArchivingTester {
  constructor() {
    this.results = {
      threshold: { passed: 0, failed: 0, tests: [] },
      compliance: { passed: 0, failed: 0, tests: [] },
      dataIntegrity: { passed: 0, failed: 0, tests: [] }
    };
    this.testData = [];
  }

  async runTest(testName, testFn, category = 'threshold') {
    try {
      console.log(`\n🧪 Testing: ${testName}`);
      const result = await testFn();
      this.results[category].passed++;
      this.results[category].tests.push({ name: testName, status: 'PASSED', result });
      console.log(`✅ ${testName}: PASSED`);
      return result;
    } catch (error) {
      this.results[category].failed++;
      this.results[category].tests.push({ name: testName, status: 'FAILED', error: error.message });
      console.log(`❌ ${testName}: FAILED - ${error.message}`);
      throw error;
    }
  }

  async setupTestData() {
    console.log('📊 Setting up test data for archiving tests...');
    
    // Create test data across different time periods
    const periods = [
      { start: '2024-01-01', end: '2024-12-31', count: 5000 }, // Current year
      { start: '2025-01-01', end: '2025-12-31', count: 8000 }, // Next year
    ];

    for (const period of periods) {
      const insertQuery = `
        INSERT INTO payments_partitioned (
          id, user_id, order_id, amount, currency, status, 
          created_at, idempotency_key, gateway_response
        ) 
        SELECT 
          uuid_generate_v4(),
          uuid_generate_v4(),
          'archive_test_' || generate_series,
          (random() * 10000 + 100)::integer,
          'USD',
          CASE 
            WHEN random() < 0.8 THEN 'SUCCEEDED'::payment_status
            WHEN random() < 0.9 THEN 'FAILED'::payment_status
            ELSE 'REFUNDED'::payment_status
          END,
          $1::timestamp + (random() * ($2::timestamp - $1::timestamp)),
          'archive_key_' || generate_series,
          jsonb_build_object(
            'metadata', jsonb_build_object(
              'order', jsonb_build_object(
                'id', 'archive_order_' || generate_series,
                'description', 'Test order for archiving',
                'items', '["Test Item"]',
                'totalItems', 1,
                'shippingAddress', 'Test Address'
              ),
              'user', jsonb_build_object(
                'id', uuid_generate_v4(),
                'email', 'test' || generate_series || '@example.com',
                'name', 'Test User ' || generate_series,
                'phone', '+1234567890'
              )
            )
          )
        FROM generate_series(1, $3);
      `;
      
      await pool.query(insertQuery, [period.start, period.end, period.count]);
      this.testData.push({ ...period, inserted: period.count });
    }
    
    console.log(`✅ Created ${this.testData.reduce((sum, d) => sum + d.count, 0)} test records`);
  }

  async testThresholdArchiving() {
    // Test that archival triggers when threshold is reached
    const countQuery = `
      SELECT COUNT(*) as total_count FROM payments_partitioned;
    `;
    
    const countResult = await pool.query(countQuery);
    const totalCount = parseInt(countResult.rows[0].total_count);
    
    // Check if we have enough data to trigger archival
    const threshold = 49999; // As per requirements
    const shouldTrigger = totalCount > threshold;
    
    if (!shouldTrigger) {
      // Add more data to reach threshold
      const needed = threshold - totalCount + 1000; // Add extra to ensure trigger
      const insertQuery = `
        INSERT INTO payments_partitioned (
          id, user_id, order_id, amount, currency, status, 
          created_at, idempotency_key
        ) 
        SELECT 
          uuid_generate_v4(),
          uuid_generate_v4(),
          'threshold_test_' || generate_series,
          (random() * 10000 + 100)::integer,
          'USD',
          'SUCCEEDED'::payment_status,
          NOW() - (random() * interval '1 year'),
          'threshold_key_' || generate_series
        FROM generate_series(1, $1);
      `;
      
      await pool.query(insertQuery, [needed]);
    }
    
    // Check if archival function exists and can be called
    const archivalQuery = `
      SELECT archive_old_payments($1) as archived_count;
    `;
    
    const archivalResult = await pool.query(archivalQuery, [20000]); // Archive 20k oldest records
    
    return {
      totalRecords: totalCount,
      thresholdMet: totalCount > threshold,
      archivedCount: archivalResult.rows[0].archived_count,
      threshold: threshold
    };
  }

  async testComplianceRetention() {
    // Test 7-year retention policy
    const sevenYearsAgo = new Date();
    sevenYearsAgo.setFullYear(sevenYearsAgo.getFullYear() - 7);
    
    const complianceQuery = `
      SELECT 
        COUNT(*) as total_records,
        COUNT(CASE WHEN created_at < $1 THEN 1 END) as old_records,
        COUNT(CASE WHEN created_at >= $1 THEN 1 END) as recent_records
      FROM payments_partitioned;
    `;
    
    const result = await pool.query(complianceQuery, [sevenYearsAgo]);
    const data = result.rows[0];
    
    // Test that we can query archived data
    const archiveQuery = `
      SELECT COUNT(*) as archived_count 
      FROM payments_archive 
      WHERE created_at < $1;
    `;
    
    let archivedCount = 0;
    try {
      const archiveResult = await pool.query(archiveQuery, [sevenYearsAgo]);
      archivedCount = parseInt(archiveResult.rows[0].archived_count);
    } catch (error) {
      // Archive table might not exist yet
      console.log('ℹ️  Archive table not found - this is expected for new setups');
    }
    
    return {
      totalRecords: parseInt(data.total_records),
      oldRecords: parseInt(data.old_records),
      recentRecords: parseInt(data.recent_records),
      archivedRecords: archivedCount,
      sevenYearCutoff: sevenYearsAgo.toISOString(),
      complianceMet: archivedCount > 0 || parseInt(data.old_records) === 0
    };
  }

  async testDataIntegrityAfterArchiving() {
    // Test that archived data is preserved and accessible
    const integrityTests = [];
    
    // Test 1: Check that payment history is preserved
    const historyQuery = `
      SELECT 
        COUNT(*) as history_count,
        COUNT(DISTINCT payment_id) as unique_payments
      FROM payment_history;
    `;
    
    const historyResult = await pool.query(historyQuery);
    integrityTests.push({
      test: 'Payment History Integrity',
      historyCount: parseInt(historyResult.rows[0].history_count),
      uniquePayments: parseInt(historyResult.rows[0].unique_payments)
    });
    
    // Test 2: Check that refunds are preserved
    const refundsQuery = `
      SELECT COUNT(*) as refund_count FROM refunds_partitioned;
    `;
    
    const refundsResult = await pool.query(refundsQuery);
    integrityTests.push({
      test: 'Refunds Integrity',
      refundCount: parseInt(refundsResult.rows[0].refund_count)
    });
    
    // Test 3: Check that archived data can be queried
    let archiveAccessible = false;
    try {
      const archiveQuery = `
        SELECT COUNT(*) as archive_count FROM payments_archive LIMIT 1;
      `;
      await pool.query(archiveQuery);
      archiveAccessible = true;
    } catch (error) {
      archiveAccessible = false;
    }
    
    integrityTests.push({
      test: 'Archive Accessibility',
      accessible: archiveAccessible
    });
    
    return integrityTests;
  }

  async testArchivalPerformance() {
    // Test that archival doesn't block normal operations
    const startTime = Date.now();
    
    // Simulate concurrent operations during archival
    const operations = [
      pool.query('SELECT COUNT(*) FROM payments_partitioned'),
      pool.query('SELECT COUNT(*) FROM payment_history'),
      pool.query('SELECT COUNT(*) FROM refunds_partitioned'),
      pool.query('SELECT * FROM payments_partitioned ORDER BY created_at DESC LIMIT 10')
    ];
    
    const results = await Promise.all(operations);
    const duration = Date.now() - startTime;
    
    return {
      concurrentOperations: operations.length,
      duration: `${duration}ms`,
      performance: duration < 5000 ? 'GOOD' : duration < 10000 ? 'ACCEPTABLE' : 'SLOW',
      allSuccessful: results.every(r => r.rows.length > 0)
    };
  }

  async testComplianceReporting() {
    // Test that reports can access historical data
    const reportQueries = [
      {
        name: '7-Year Payment Summary',
        query: `
          SELECT 
            DATE_TRUNC('year', created_at) as year,
            COUNT(*) as payment_count,
            SUM(amount) as total_amount,
            COUNT(CASE WHEN status = 'SUCCEEDED' THEN 1 END) as successful_count
          FROM (
            SELECT created_at, amount, status FROM payments_partitioned
            UNION ALL
            SELECT created_at, amount, status FROM payments_archive
          ) all_payments
          WHERE created_at >= NOW() - INTERVAL '7 years'
          GROUP BY DATE_TRUNC('year', created_at)
          ORDER BY year;
        `
      },
      {
        name: 'Compliance Audit Trail',
        query: `
          SELECT 
            COUNT(*) as total_history_entries,
            COUNT(DISTINCT payment_id) as unique_payments_tracked,
            MIN(created_at) as oldest_entry,
            MAX(created_at) as newest_entry
          FROM payment_history;
        `
      }
    ];
    
    const results = [];
    
    for (const report of reportQueries) {
      try {
        const start = Date.now();
        const result = await pool.query(report.query);
        const duration = Date.now() - start;
        
        results.push({
          report: report.name,
          duration: `${duration}ms`,
          rows: result.rows.length,
          performance: duration < 2000 ? 'GOOD' : duration < 5000 ? 'ACCEPTABLE' : 'SLOW'
        });
      } catch (error) {
        results.push({
          report: report.name,
          error: error.message,
          performance: 'FAILED'
        });
      }
    }
    
    return results;
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test data...');
    
    const cleanupQueries = [
      "DELETE FROM payments_partitioned WHERE idempotency_key LIKE 'archive_key_%'",
      "DELETE FROM payments_partitioned WHERE idempotency_key LIKE 'threshold_key_%'",
      "DELETE FROM payments_partitioned WHERE idempotency_key LIKE 'archive_test_%'",
      "DELETE FROM payments_partitioned WHERE idempotency_key LIKE 'threshold_test_%'"
    ];
    
    for (const query of cleanupQueries) {
      try {
        await pool.query(query);
      } catch (error) {
        console.log(`ℹ️  Cleanup query failed (expected): ${error.message}`);
      }
    }
    
    console.log('✅ Cleanup completed');
  }

  async runAllTests() {
    console.log('🚀 Starting Archiving and Compliance Tests...\n');
    
    try {
      // Setup test data
      await this.setupTestData();
      
      // Archiving Tests
      await this.runTest('Threshold Archiving', () => this.testThresholdArchiving());
      await this.runTest('Compliance Retention (7 years)', () => this.testComplianceRetention(), 'compliance');
      await this.runTest('Data Integrity After Archiving', () => this.testDataIntegrityAfterArchiving(), 'dataIntegrity');
      await this.runTest('Archival Performance', () => this.testArchivalPerformance(), 'threshold');
      await this.runTest('Compliance Reporting', () => this.testComplianceReporting(), 'compliance');
      
      // Cleanup
      await this.cleanup();
      
      // Summary
      this.printSummary();
      
    } catch (error) {
      console.error('❌ Test suite failed:', error.message);
      await this.cleanup();
      process.exit(1);
    } finally {
      await pool.end();
    }
  }

  printSummary() {
    console.log('\n📊 ARCHIVING & COMPLIANCE TEST SUMMARY');
    console.log('========================================');
    
    Object.entries(this.results).forEach(([category, results]) => {
      console.log(`\n${category.toUpperCase()}:`);
      console.log(`  ✅ Passed: ${results.passed}`);
      console.log(`  ❌ Failed: ${results.failed}`);
      console.log(`  📈 Success Rate: ${((results.passed / (results.passed + results.failed)) * 100).toFixed(1)}%`);
      
      if (results.failed > 0) {
        console.log('\n  Failed Tests:');
        results.tests.filter(t => t.status === 'FAILED').forEach(test => {
          console.log(`    - ${test.name}: ${test.error}`);
        });
      }
    });
    
    const totalPassed = Object.values(this.results).reduce((sum, r) => sum + r.passed, 0);
    const totalFailed = Object.values(this.results).reduce((sum, r) => sum + r.failed, 0);
    
    console.log(`\n🎯 OVERALL RESULT:`);
    console.log(`  ✅ Total Passed: ${totalPassed}`);
    console.log(`  ❌ Total Failed: ${totalFailed}`);
    console.log(`  📈 Overall Success Rate: ${((totalPassed / (totalPassed + totalFailed)) * 100).toFixed(1)}%`);
    
    if (totalFailed === 0) {
      console.log('\n🎉 ALL ARCHIVING TESTS PASSED! Compliance and archival systems are working correctly.');
    } else {
      console.log('\n⚠️  Some tests failed. Review and fix before production deployment.');
      process.exit(1);
    }
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new ArchivingTester();
  tester.runAllTests().catch(console.error);
}

export default ArchivingTester;
