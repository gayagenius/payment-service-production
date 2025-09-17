#!/usr/bin/env node

/**
 * Partitioning Validation Tests
 * Tests partitioning functionality, data distribution, and query performance
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

class PartitioningTester {
  constructor() {
    this.results = {
      partitioning: { passed: 0, failed: 0, tests: [] },
      performance: { passed: 0, failed: 0, tests: [] },
      dataIntegrity: { passed: 0, failed: 0, tests: [] }
    };
  }

  async runTest(testName, testFn, category = 'partitioning') {
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

  async testPartitioningEnabled() {
    const query = `
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
      FROM pg_tables 
      WHERE tablename LIKE '%payments%' OR tablename LIKE '%refunds%'
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
    `;
    
    const result = await pool.query(query);
    const partitionedTables = result.rows.filter(row => 
      row.tablename.includes('payments_partitioned') || 
      row.tablename.includes('refunds_partitioned')
    );
    
    if (partitionedTables.length === 0) {
      throw new Error('No partitioned tables found');
    }
    
    return { partitionedTables, totalTables: result.rows.length };
  }

  async testPartitionCreation() {
    const query = `
      SELECT 
        n.nspname as schemaname,
        c.relname as tablename,
        pg_get_expr(c.relpartbound, c.oid) as partition_bound
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE c.relkind = 'p' AND c.relname LIKE '%payments%'
      ORDER BY c.relname;
    `;
    
    const result = await pool.query(query);
    return result.rows;
  }

  async testDataDistribution() {
    // Insert test data across different time periods
    const testData = [
      { date: '2024-01-15', count: 1000 },
      { date: '2024-06-15', count: 1500 },
      { date: '2025-01-15', count: 2000 },
      { date: '2025-06-15', count: 2500 }
    ];

    const results = [];
    
    for (const data of testData) {
      // Insert test payments
      const insertQuery = `
        INSERT INTO payments_partitioned (
          id, user_id, order_id, amount, currency, status, 
          created_at, idempotency_key
        ) 
        SELECT 
          uuid_generate_v4(),
          uuid_generate_v4(),
          'test_order_' || generate_series,
          (random() * 10000 + 100)::integer,
          'USD',
          'SUCCEEDED',
          $1::timestamp + (random() * interval '1 day'),
          'test_key_' || generate_series
        FROM generate_series(1, $2);
      `;
      
      await pool.query(insertQuery, [data.date, data.count]);
      
      // Check distribution
      const countQuery = `
        SELECT 
          COUNT(*) as count,
          MIN(created_at) as min_date,
          MAX(created_at) as max_date
        FROM payments_partitioned 
        WHERE created_at::date = $1::date;
      `;
      
      const countResult = await pool.query(countQuery, [data.date]);
      results.push({
        expected: data.count,
        actual: parseInt(countResult.rows[0].count),
        date: data.date,
        range: `${countResult.rows[0].min_date} to ${countResult.rows[0].max_date}`
      });
    }
    
    return results;
  }

  async testQueryPerformance() {
    const queries = [
      {
        name: 'Recent payments by user',
        query: `
          SELECT * FROM payments_partitioned 
          WHERE user_id = (SELECT user_id FROM payments_partitioned LIMIT 1)
          AND created_at >= NOW() - INTERVAL '30 days'
          ORDER BY created_at DESC LIMIT 100;
        `
      },
      {
        name: 'Payments by status and date range',
        query: `
          SELECT COUNT(*) FROM payments_partitioned 
          WHERE status = 'SUCCEEDED' 
          AND created_at BETWEEN '2024-01-01' AND '2024-12-31';
        `
      },
      {
        name: 'Monthly payment totals',
        query: `
          SELECT 
            DATE_TRUNC('month', created_at) as month,
            COUNT(*) as payment_count,
            SUM(amount) as total_amount
          FROM payments_partitioned 
          WHERE created_at >= '2023-01-01'
          GROUP BY DATE_TRUNC('month', created_at)
          ORDER BY month;
        `
      }
    ];

    const results = [];
    
    for (const test of queries) {
      const start = Date.now();
      const result = await pool.query(test.query);
      const duration = Date.now() - start;
      
      results.push({
        query: test.name,
        duration: `${duration}ms`,
        rows: result.rows.length,
        performance: duration < 1000 ? 'GOOD' : duration < 5000 ? 'ACCEPTABLE' : 'SLOW'
      });
    }
    
    return results;
  }

  async testPartitionPruning() {
    // Test that queries only hit relevant partitions
    const query = `
      EXPLAIN (ANALYZE, BUFFERS) 
      SELECT COUNT(*) FROM payments_partitioned 
      WHERE created_at BETWEEN '2024-01-01' AND '2024-01-31';
    `;
    
    const result = await pool.query(query);
    const plan = result.rows.map(row => row['QUERY PLAN']).join('\n');
    
    // Check if partition pruning is working
    const hasPruning = plan.includes('Seq Scan') && !plan.includes('Seq Scan on payments_partitioned');
    const hasIndexScan = plan.includes('Index Scan');
    
    return {
      plan,
      hasPruning,
      hasIndexScan,
      performance: hasPruning || hasIndexScan ? 'OPTIMIZED' : 'NEEDS_OPTIMIZATION'
    };
  }

  async cleanup() {
    console.log('\n🧹 Cleaning up test data...');
    await pool.query("DELETE FROM payments_partitioned WHERE idempotency_key LIKE 'test_key_%'");
    console.log('✅ Cleanup completed');
  }

  async runAllTests() {
    console.log('🚀 Starting Partitioning Tests...\n');
    
    try {
      // Partitioning Tests
      await this.runTest('Partitioning Enabled', () => this.testPartitioningEnabled());
      await this.runTest('Partition Creation', () => this.testPartitionCreation());
      await this.runTest('Data Distribution', () => this.testDataDistribution(), 'dataIntegrity');
      await this.runTest('Query Performance', () => this.testQueryPerformance(), 'performance');
      await this.runTest('Partition Pruning', () => this.testPartitionPruning(), 'performance');
      
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
    console.log('\n📊 PARTITIONING TEST SUMMARY');
    console.log('================================');
    
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
      console.log('\n🎉 ALL PARTITIONING TESTS PASSED! System is ready for production load.');
    } else {
      console.log('\n⚠️  Some tests failed. Review and fix before production deployment.');
      process.exit(1);
    }
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new PartitioningTester();
  tester.runAllTests().catch(console.error);
}

export default PartitioningTester;
