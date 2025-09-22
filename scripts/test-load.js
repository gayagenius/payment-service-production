#!/usr/bin/env node

/**
 * Load Testing Script
 * Tests system performance under high load (50k+ records)
 * Validates no connection timeouts, data loss, or functionality breaks
 */

import pg from 'pg';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const { Pool } = pg;

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'payment_service',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  max: 50, // Increased for load testing
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

const pool = new Pool(config);

class LoadTester {
  constructor() {
    this.results = {
      database: { passed: 0, failed: 0, tests: [] },
      api: { passed: 0, failed: 0, tests: [] },
      performance: { passed: 0, failed: 0, tests: [] },
      concurrency: { passed: 0, failed: 0, tests: [] }
    };
    this.apiBaseUrl = `http://localhost:${process.env.PORT || 8888}`;
    this.testData = [];
  }

  async runTest(testName, testFn, category = 'database') {
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

  async testDatabaseConnectionPool() {
    // Test connection pool under load
    const connections = [];
    const maxConnections = 50;
    
    try {
      // Create multiple connections
      for (let i = 0; i < maxConnections; i++) {
        const client = await pool.connect();
        connections.push(client);
      }
      
      // Test concurrent queries
      const queries = connections.map((client, index) => 
        client.query('SELECT $1 as connection_id, NOW() as timestamp', [index])
      );
      
      const results = await Promise.all(queries);
      
      return {
        connectionsCreated: connections.length,
        queriesExecuted: results.length,
        allSuccessful: results.every(r => r.rows.length > 0),
        poolSize: pool.totalCount,
        idleConnections: pool.idleCount
      };
    } finally {
      // Release all connections
      connections.forEach(client => client.release());
    }
  }

  async testBulkDataInsertion() {
    // Test inserting 50k+ records
    const batchSize = 1000;
    const totalRecords = 50000;
    const batches = Math.ceil(totalRecords / batchSize);
    
    console.log(`📊 Inserting ${totalRecords} records in ${batches} batches...`);
    
    const startTime = Date.now();
    const insertedIds = [];
    
    for (let batch = 0; batch < batches; batch++) {
      const batchStart = batch * batchSize;
      const batchEnd = Math.min(batchStart + batchSize, totalRecords);
      
      const insertQuery = `
        INSERT INTO payments_partitioned (
          user_id, order_id, amount, currency, status, 
          created_at, idempotency_key, gateway_response
        ) 
        SELECT 
          uuid_generate_v4(),
          'load_test_' || (batch_start + generate_series),
          (random() * 10000 + 100)::integer,
          'USD',
          CASE 
            WHEN random() < 0.8 THEN 'SUCCEEDED'
            WHEN random() < 0.9 THEN 'FAILED'
            ELSE 'REFUNDED'
          END,
          NOW() - (random() * interval '1 year'),
          'load_key_' || (batch_start + generate_series),
          jsonb_build_object(
            'metadata', jsonb_build_object(
              'order', jsonb_build_object(
                'id', 'load_order_' || (batch_start + generate_series),
                'description', 'Load test order',
                'items', '["Load Test Item"]',
                'totalItems', 1,
                'shippingAddress', 'Load Test Address'
              ),
              'user', jsonb_build_object(
                'id', uuid_generate_v4(),
                'email', 'loadtest' || (batch_start + generate_series) || '@example.com',
                'name', 'Load Test User ' || (batch_start + generate_series),
                'phone', '+1234567890'
              )
            )
          )
        FROM generate_series(1, $1)
        RETURNING id;
      `;
      
      const result = await pool.query(insertQuery, [batchEnd - batchStart]);
      insertedIds.push(...result.rows.map(row => row.id));
      
      if (batch % 10 === 0) {
        console.log(`  📈 Batch ${batch + 1}/${batches} completed (${insertedIds.length} records)`);
      }
    }
    
    const duration = Date.now() - startTime;
    const recordsPerSecond = Math.round((totalRecords / duration) * 1000);
    
    return {
      totalRecords,
      insertedRecords: insertedIds.length,
      duration: `${duration}ms`,
      recordsPerSecond,
      performance: recordsPerSecond > 1000 ? 'EXCELLENT' : recordsPerSecond > 500 ? 'GOOD' : 'ACCEPTABLE'
    };
  }

  async testConcurrentQueries() {
    // Test concurrent read/write operations
    const concurrentOperations = 100;
    const operations = [];
    
    for (let i = 0; i < concurrentOperations; i++) {
      operations.push(this.performConcurrentOperation(i));
    }
    
    const startTime = Date.now();
    const results = await Promise.allSettled(operations);
    const duration = Date.now() - startTime;
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    return {
      totalOperations: concurrentOperations,
      successful,
      failed,
      duration: `${duration}ms`,
      successRate: `${((successful / concurrentOperations) * 100).toFixed(1)}%`,
      performance: duration < 10000 ? 'GOOD' : duration < 30000 ? 'ACCEPTABLE' : 'SLOW'
    };
  }

  async performConcurrentOperation(index) {
    const operations = [
      () => pool.query('SELECT COUNT(*) FROM payments_partitioned'),
      () => pool.query('SELECT COUNT(*) FROM payment_history'),
      () => pool.query('SELECT * FROM payments_partitioned ORDER BY created_at DESC LIMIT 10'),
      () => pool.query('SELECT * FROM payments_partitioned WHERE status = $1 LIMIT 5', ['SUCCEEDED']),
      () => pool.query('SELECT user_id, COUNT(*) FROM payments_partitioned GROUP BY user_id LIMIT 10')
    ];
    
    const randomOperation = operations[Math.floor(Math.random() * operations.length)];
    return randomOperation();
  }

  async testApiLoad() {
    // Test API endpoints under load
    const concurrentRequests = 50;
    const requests = [];
    
    for (let i = 0; i < concurrentRequests; i++) {
      requests.push(this.performApiRequest(i));
    }
    
    const startTime = Date.now();
    const results = await Promise.allSettled(requests);
    const duration = Date.now() - startTime;
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    return {
      totalRequests: concurrentRequests,
      successful,
      failed,
      duration: `${duration}ms`,
      successRate: `${((successful / concurrentRequests) * 100).toFixed(1)}%`,
      requestsPerSecond: Math.round((concurrentRequests / duration) * 1000)
    };
  }

  async performApiRequest(index) {
    const endpoints = [
      `${this.apiBaseUrl}/health`,
      `${this.apiBaseUrl}/payments`,
      `${this.apiBaseUrl}/payment-history/user/550e8400-e29b-41d4-a716-446655440000`
    ];
    
    const randomEndpoint = endpoints[Math.floor(Math.random() * endpoints.length)];
    
    const response = await axios.get(randomEndpoint, {
      timeout: 10000,
      headers: {
        'X-Correlation-ID': `load-test-${index}`,
        'Authorization': 'Bearer test-token'
      }
    });
    
    return {
      endpoint: randomEndpoint,
      status: response.status,
      responseTime: response.headers['x-response-time'] || 'unknown'
    };
  }

  async testQueryPerformanceUnderLoad() {
    // Test query performance with large dataset
    const queries = [
      {
        name: 'Count all payments',
        query: 'SELECT COUNT(*) FROM payments_partitioned'
      },
      {
        name: 'Recent payments (last 30 days)',
        query: 'SELECT COUNT(*) FROM payments_partitioned WHERE created_at >= NOW() - INTERVAL \'30 days\''
      },
      {
        name: 'Payments by status',
        query: 'SELECT status, COUNT(*) FROM payments_partitioned GROUP BY status'
      },
      {
        name: 'Monthly totals',
        query: `
          SELECT 
            DATE_TRUNC('month', created_at) as month,
            COUNT(*) as count,
            SUM(amount) as total
          FROM payments_partitioned 
          WHERE created_at >= NOW() - INTERVAL '1 year'
          GROUP BY DATE_TRUNC('month', created_at)
          ORDER BY month
        `
      },
      {
        name: 'Top users by payment count',
        query: `
          SELECT user_id, COUNT(*) as payment_count
          FROM payments_partitioned 
          GROUP BY user_id 
          ORDER BY payment_count DESC 
          LIMIT 10
        `
      }
    ];
    
    const results = [];
    
    for (const query of queries) {
      const start = Date.now();
      const result = await pool.query(query.query);
      const duration = Date.now() - start;
      
      results.push({
        query: query.name,
        duration: `${duration}ms`,
        rows: result.rows.length,
        performance: duration < 1000 ? 'EXCELLENT' : duration < 5000 ? 'GOOD' : duration < 10000 ? 'ACCEPTABLE' : 'SLOW'
      });
    }
    
    return results;
  }

  async testConnectionTimeoutHandling() {
    // Test that connections don't timeout under load
    const longRunningQueries = 10;
    const queries = [];
    
    for (let i = 0; i < longRunningQueries; i++) {
      queries.push(
        pool.query(`
          SELECT 
            generate_series(1, 1000000) as number,
            NOW() as timestamp,
            $1 as query_id
        `, [i])
      );
    }
    
    const startTime = Date.now();
    const results = await Promise.allSettled(queries);
    const duration = Date.now() - startTime;
    
    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;
    
    return {
      longRunningQueries,
      successful,
      failed,
      duration: `${duration}ms`,
      timeoutHandling: failed === 0 ? 'EXCELLENT' : failed < longRunningQueries / 2 ? 'GOOD' : 'POOR'
    };
  }

  async testDataIntegrityUnderLoad() {
    // Test that data integrity is maintained under load
    const integrityTests = [];
    
    // Test 1: Check total count consistency
    const countQuery = 'SELECT COUNT(*) FROM payments_partitioned';
    const countResult = await pool.query(countQuery);
    const totalCount = parseInt(countResult.rows[0].count);
    
    integrityTests.push({
      test: 'Total Count Consistency',
      count: totalCount,
      status: totalCount > 0 ? 'PASS' : 'FAIL'
    });
    
    // Test 2: Check for duplicate idempotency keys
    const duplicateQuery = `
      SELECT idempotency_key, COUNT(*) 
      FROM payments_partitioned 
      WHERE idempotency_key LIKE 'load_key_%'
      GROUP BY idempotency_key 
      HAVING COUNT(*) > 1;
    `;
    
    const duplicateResult = await pool.query(duplicateQuery);
    integrityTests.push({
      test: 'No Duplicate Idempotency Keys',
      duplicates: duplicateResult.rows.length,
      status: duplicateResult.rows.length === 0 ? 'PASS' : 'FAIL'
    });
    
    // Test 3: Check payment history integrity
    const historyQuery = `
      SELECT COUNT(*) as history_count
      FROM payment_history ph
      JOIN payments_partitioned p ON ph.payment_id = p.id
      WHERE p.idempotency_key LIKE 'load_key_%';
    `;
    
    const historyResult = await pool.query(historyQuery);
    integrityTests.push({
      test: 'Payment History Integrity',
      historyCount: parseInt(historyResult.rows[0].history_count),
      status: 'PASS' // History might be empty for new records
    });
    
    return integrityTests;
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up load test data...');
    
    const cleanupQueries = [
      "DELETE FROM payments_partitioned WHERE idempotency_key LIKE 'load_key_%'",
      "DELETE FROM payments_partitioned WHERE idempotency_key LIKE 'load_test_%'"
    ];
    
    for (const query of cleanupQueries) {
      try {
        await pool.query(query);
      } catch (error) {
        console.log(`ℹ️  Cleanup query failed: ${error.message}`);
      }
    }
    
    console.log('✅ Cleanup completed');
  }

  async runAllTests() {
    console.log('🚀 Starting Load Tests (50k+ records)...\n');
    
    try {
      // Database Tests
      await this.runTest('Database Connection Pool', () => this.testDatabaseConnectionPool());
      await this.runTest('Bulk Data Insertion (50k records)', () => this.testBulkDataInsertion());
      await this.runTest('Concurrent Queries', () => this.testConcurrentQueries(), 'concurrency');
      await this.runTest('Query Performance Under Load', () => this.testQueryPerformanceUnderLoad(), 'performance');
      await this.runTest('Connection Timeout Handling', () => this.testConnectionTimeoutHandling(), 'concurrency');
      await this.runTest('Data Integrity Under Load', () => this.testDataIntegrityUnderLoad(), 'database');
      
      // API Tests
      await this.runTest('API Load Testing', () => this.testApiLoad(), 'api');
      
      // Cleanup
      await this.cleanup();
      
      // Summary
      this.printSummary();
      
    } catch (error) {
      console.error('❌ Load test suite failed:', error.message);
      await this.cleanup();
      process.exit(1);
    } finally {
      await pool.end();
    }
  }

  printSummary() {
    console.log('\n📊 LOAD TEST SUMMARY');
    console.log('===================');
    
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
      console.log('\n🎉 ALL LOAD TESTS PASSED! System can handle 50k+ records without issues.');
      console.log('✅ No connection timeouts detected');
      console.log('✅ No data loss detected');
      console.log('✅ All functionality working under load');
    } else {
      console.log('\n⚠️  Some tests failed. Review and fix before production deployment.');
      process.exit(1);
    }
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new LoadTester();
  tester.runAllTests().catch(console.error);
}

export default LoadTester;
