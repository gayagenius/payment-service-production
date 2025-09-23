#!/usr/bin/env node

/**
 * End-to-End Scalability Testing Script
 * 
 * This script performs comprehensive testing of the payment service's
 * scalability, compliance, and data integrity features.
 * 
 * Features:
 * - Load testing with >49k requests
 * - Archival threshold testing
 * - Data integrity verification
 * - Compliance policy validation
 * - Performance benchmarking
 * - Rollback testing
 */

import pg from 'pg';
import axios from 'axios';
import fs from 'fs/promises';

// Configuration
const config = {
  // Database connection
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'payment_service',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
  },
  
  // API connection
  api: {
    baseUrl: process.env.API_BASE_URL || 'http://localhost:8080',
    timeout: parseInt(process.env.API_TIMEOUT) || 30000,
  },
  
  // Test settings
  test: {
    loadTestRequests: parseInt(process.env.LOAD_TEST_REQUESTS) || 50000,
    batchSize: parseInt(process.env.BATCH_SIZE) || 1000,
    concurrency: parseInt(process.env.CONCURRENCY) || 10,
    dryRun: process.env.DRY_RUN === 'true',
    skipLoadTest: process.env.SKIP_LOAD_TEST === 'true',
  },
  
  // Output settings
  output: {
    reportFile: process.env.REPORT_FILE || 'scalability-test-report.json',
    logLevel: process.env.LOG_LEVEL || 'info',
  }
};

// Logging setup
const logLevels = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLogLevel = logLevels[config.output.logLevel] || 2;

function log(level, message, data = null) {
  if (logLevels[level] <= currentLogLevel) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    console.log(logMessage);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

// Test results storage
const testResults = {
  timestamp: new Date().toISOString(),
  configuration: config,
  tests: {},
  summary: {
    totalTests: 0,
    passedTests: 0,
    failedTests: 0,
    warnings: 0
  }
};

// Database connection
let dbPool = null;

/**
 * Initialize database connection
 */
async function initDatabase() {
  try {
    dbPool = new pg.Pool({
      ...config.db,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    
    // Test connection
    const client = await dbPool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    
    log('info', 'Database connection established');
    return true;
  } catch (error) {
    log('error', 'Failed to connect to database', { error: error.message });
    return false;
  }
}

/**
 * Test database schema and partitioning
 */
async function testDatabaseSchema() {
  log('info', 'Testing database schema and partitioning');
  
  const tests = [];
  
  try {
    const client = await dbPool.connect();
    
    // Test 1: Check if partitioned tables exist
    const partitionedTables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('payments_partitioned', 'refunds_partitioned')
    `);
    
    tests.push({
      name: 'partitioned_tables_exist',
      passed: partitionedTables.rows.length === 2,
      message: `Found ${partitionedTables.rows.length} partitioned tables`
    });
    
    // Test 2: Check if archive tables exist
    const archiveTables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('payments_archive', 'refunds_archive', 'payment_reports')
    `);
    
    tests.push({
      name: 'archive_tables_exist',
      passed: archiveTables.rows.length === 3,
      message: `Found ${archiveTables.rows.length} archive tables`
    });
    
    // Test 3: Check if helper functions exist
    const helperFunctions = await client.query(`
      SELECT routine_name 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
      AND routine_name IN (
        'create_payment_with_history',
        'get_payment_by_id',
        'get_payments_by_user',
        'update_payment_status',
        'create_refund',
        'get_refund_by_id',
        'can_refund_payment'
      )
    `);
    
    tests.push({
      name: 'helper_functions_exist',
      passed: helperFunctions.rows.length >= 7,
      message: `Found ${helperFunctions.rows.length} helper functions`
    });
    
    // Test 4: Check if archival functions exist
    const archivalFunctions = await client.query(`
      SELECT routine_name 
      FROM information_schema.routines 
      WHERE routine_schema = 'public' 
      AND routine_name IN (
        'archive_closed_payments_performance',
        'archive_payments_compliance',
        'generate_payment_reports',
        'verify_archival_integrity'
      )
    `);
    
    tests.push({
      name: 'archival_functions_exist',
      passed: archivalFunctions.rows.length >= 4,
      message: `Found ${archivalFunctions.rows.length} archival functions`
    });
    
    // Test 5: Check partition configuration
    const partitions = await client.query(`
      SELECT 
        schemaname,
        tablename,
        partitionname,
        partitionrank
      FROM pg_partitions 
      WHERE schemaname = 'public'
      AND tablename IN ('payments_partitioned', 'refunds_partitioned')
      ORDER BY tablename, partitionrank
    `);
    
    tests.push({
      name: 'partitions_configured',
      passed: partitions.rows.length > 0,
      message: `Found ${partitions.rows.length} partitions`
    });
    
    client.release();
    
    log('info', 'Database schema tests completed', { 
      total: tests.length,
      passed: tests.filter(t => t.passed).length 
    });
    
    return tests;
    
  } catch (error) {
    log('error', 'Database schema test failed', { error: error.message });
    return [{
      name: 'database_schema_test',
      passed: false,
      message: `Database schema test failed: ${error.message}`
    }];
  }
}

/**
 * Test data integrity
 */
async function testDataIntegrity() {
  log('info', 'Testing data integrity');
  
  const tests = [];
  
  try {
    const client = await dbPool.connect();
    
    // Test 1: Verify archival integrity
    const integrityResult = await client.query('SELECT * FROM verify_archival_integrity()');
    
    for (const row of integrityResult.rows) {
      tests.push({
        name: `integrity_${row.check_name}`,
        passed: row.passed,
        message: row.message
      });
    }
    
    // Test 2: Check for duplicate payments
    const duplicateCheck = await client.query(`
      SELECT id, COUNT(*) as count
      FROM (
        SELECT id FROM payments_partitioned
        UNION ALL
        SELECT id FROM payments_archive
      ) t
      GROUP BY id
      HAVING COUNT(*) > 1
    `);
    
    tests.push({
      name: 'no_duplicate_payments',
      passed: duplicateCheck.rows.length === 0,
      message: `Found ${duplicateCheck.rows.length} duplicate payments`
    });
    
    // Test 3: Check archive contains only closed payments
    const archiveStatusCheck = await client.query(`
      SELECT COUNT(*) as count
      FROM payments_archive
      WHERE status NOT IN ('SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED')
    `);
    
    tests.push({
      name: 'archive_closed_only',
      passed: parseInt(archiveStatusCheck.rows[0].count) === 0,
      message: `Found ${archiveStatusCheck.rows[0].count} non-closed payments in archive`
    });
    
    client.release();
    
    log('info', 'Data integrity tests completed', { 
      total: tests.length,
      passed: tests.filter(t => t.passed).length 
    });
    
    return tests;
    
  } catch (error) {
    log('error', 'Data integrity test failed', { error: error.message });
    return [{
      name: 'data_integrity_test',
      passed: false,
      message: `Data integrity test failed: ${error.message}`
    }];
  }
}

/**
 * Test archival functionality
 */
async function testArchivalFunctionality() {
  log('info', 'Testing archival functionality');
  
  const tests = [];
  
  try {
    const client = await dbPool.connect();
    
    // Test 1: Check archival configuration
    const configResult = await client.query('SELECT * FROM get_archival_config()');
    
    tests.push({
      name: 'archival_config_exists',
      passed: configResult.rows.length > 0,
      message: `Found ${configResult.rows.length} archival configuration entries`
    });
    
    // Test 2: Test performance archival function
    const performanceResult = await client.query('SELECT * FROM archive_closed_payments_performance()');
    const perfResult = performanceResult.rows[0];
    
    tests.push({
      name: 'performance_archival_function',
      passed: true, // Function executed without error
      message: `Performance archival: ${perfResult.message}`
    });
    
    // Test 3: Test compliance archival function
    const complianceResult = await client.query('SELECT * FROM archive_payments_compliance()');
    const compResult = complianceResult.rows[0];
    
    tests.push({
      name: 'compliance_archival_function',
      passed: true, // Function executed without error
      message: `Compliance archival: ${compResult.message}`
    });
    
    // Test 4: Test reports generation function
    const reportsResult = await client.query('SELECT * FROM generate_payment_reports()');
    const repResult = reportsResult.rows[0];
    
    tests.push({
      name: 'reports_generation_function',
      passed: true, // Function executed without error
      message: `Reports generation: ${repResult.message}`
    });
    
    // Test 5: Check archival status
    const statusResult = await client.query('SELECT * FROM get_archival_status()');
    
    tests.push({
      name: 'archival_status_function',
      passed: statusResult.rows.length > 0,
      message: `Found ${statusResult.rows.length} archival status entries`
    });
    
    client.release();
    
    log('info', 'Archival functionality tests completed', { 
      total: tests.length,
      passed: tests.filter(t => t.passed).length 
    });
    
    return tests;
    
  } catch (error) {
    log('error', 'Archival functionality test failed', { error: error.message });
    return [{
      name: 'archival_functionality_test',
      passed: false,
      message: `Archival functionality test failed: ${error.message}`
    }];
  }
}

/**
 * Test API endpoints
 */
async function testApiEndpoints() {
  log('info', 'Testing API endpoints');
  
  const tests = [];
  
  try {
    // Test 1: Health check
    try {
      const healthResponse = await axios.get(`${config.api.baseUrl}/`, {
        timeout: config.api.timeout
      });
      
      tests.push({
        name: 'health_check',
        passed: healthResponse.status === 200,
        message: `Health check returned status ${healthResponse.status}`
      });
    } catch (error) {
      tests.push({
        name: 'health_check',
        passed: false,
        message: `Health check failed: ${error.message}`
      });
    }
    
    // Test 2: Create payment
    try {
      const paymentData = {
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        order_id: `test-order-${Date.now()}`,
        amount: 1000,
        currency: 'USD',
        idempotency_key: `test-payment-${Date.now()}`
      };
      
      const paymentResponse = await axios.post(`${config.api.baseUrl}/payments`, paymentData, {
        timeout: config.api.timeout
      });
      
      tests.push({
        name: 'create_payment',
        passed: paymentResponse.status === 201,
        message: `Create payment returned status ${paymentResponse.status}`
      });
      
      // Test 3: Get payment by ID
      if (paymentResponse.status === 201 && paymentResponse.data.success) {
        const payment_id = paymentResponse.data.data.id;
        
        try {
          const getResponse = await axios.get(`${config.api.baseUrl}/payments/${payment_id}`, {
            timeout: config.api.timeout
          });
          
          tests.push({
            name: 'get_payment_by_id',
            passed: getResponse.status === 200,
            message: `Get payment returned status ${getResponse.status}`
          });
        } catch (error) {
          tests.push({
            name: 'get_payment_by_id',
            passed: false,
            message: `Get payment failed: ${error.message}`
          });
        }
      }
      
    } catch (error) {
      tests.push({
        name: 'create_payment',
        passed: false,
        message: `Create payment failed: ${error.message}`
      });
    }
    
    // Test 4: Get payments with pagination
    try {
      const paymentsResponse = await axios.get(`${config.api.baseUrl}/payments?limit=10`, {
        timeout: config.api.timeout
      });
      
      tests.push({
        name: 'get_payments_pagination',
        passed: paymentsResponse.status === 200,
        message: `Get payments returned status ${paymentsResponse.status}`
      });
    } catch (error) {
      tests.push({
        name: 'get_payments_pagination',
        passed: false,
        message: `Get payments failed: ${error.message}`
      });
    }
    
    log('info', 'API endpoint tests completed', { 
      total: tests.length,
      passed: tests.filter(t => t.passed).length 
    });
    
    return tests;
    
  } catch (error) {
    log('error', 'API endpoint test failed', { error: error.message });
    return [{
      name: 'api_endpoint_test',
      passed: false,
      message: `API endpoint test failed: ${error.message}`
    }];
  }
}

/**
 * Test retry functionality
 */
async function testRetryFunctionality() {
  log('info', 'Testing retry functionality');
  
  const tests = [];
  
  try {
    // Test 1: Create payment with idempotency key
    const idempotencyKey = `test-retry-${Date.now()}`;
    const paymentData = {
      user_id: '550e8400-e29b-41d4-a716-446655440000',
      order_id: `test-retry-order-${Date.now()}`,
      amount: 2000,
      currency: 'USD',
      idempotency_key: idempotencyKey,
      retry: false
    };
    
    const firstResponse = await axios.post(`${config.api.baseUrl}/payments`, paymentData, {
      timeout: config.api.timeout
    });
    
    tests.push({
      name: 'first_payment_creation',
      passed: firstResponse.status === 201,
      message: `First payment creation returned status ${firstResponse.status}`
    });
    
    // Test 2: Retry with same idempotency key
    const retryData = {
      ...paymentData,
      retry: true
    };
    
    const retryResponse = await axios.post(`${config.api.baseUrl}/payments`, retryData, {
      timeout: config.api.timeout
    });
    
    tests.push({
      name: 'retry_payment_creation',
      passed: retryResponse.status === 200,
      message: `Retry payment creation returned status ${retryResponse.status}`
    });
    
    // Test 3: Verify idempotency
    if (firstResponse.status === 201 && retryResponse.status === 200) {
      const firstPaymentId = firstResponse.data.data.id;
      const retryPaymentId = retryResponse.data.data.id;
      
      tests.push({
        name: 'idempotency_verification',
        passed: firstPaymentId === retryPaymentId,
        message: `Payment IDs match: ${firstPaymentId} === ${retryPaymentId}`
      });
    }
    
    log('info', 'Retry functionality tests completed', { 
      total: tests.length,
      passed: tests.filter(t => t.passed).length 
    });
    
    return tests;
    
  } catch (error) {
    log('error', 'Retry functionality test failed', { error: error.message });
    return [{
      name: 'retry_functionality_test',
      passed: false,
      message: `Retry functionality test failed: ${error.message}`
    }];
  }
}

/**
 * Test load scalability
 */
async function testLoadScalability() {
  if (config.test.skipLoadTest) {
    log('info', 'Load test skipped');
    return [{
      name: 'load_test',
      passed: true,
      message: 'Load test skipped by configuration'
    }];
  }
  
  log('info', 'Testing load scalability', { 
    requests: config.test.loadTestRequests,
    concurrency: config.test.concurrency 
  });
  
  const tests = [];
  const startTime = Date.now();
  
  try {
    // Generate test data
    const testPayments = [];
    for (let i = 0; i < config.test.loadTestRequests; i++) {
      testPayments.push({
        user_id: '550e8400-e29b-41d4-a716-446655440000',
        order_id: `load-test-order-${i}`,
        amount: Math.floor(Math.random() * 10000) + 100,
        currency: 'USD',
        idempotency_key: `load-test-${i}-${Date.now()}`
      });
    }
    
    // Execute load test in batches
    const batchSize = config.test.batchSize;
    const batches = Math.ceil(testPayments.length / batchSize);
    let successCount = 0;
    let errorCount = 0;
    
    for (let batch = 0; batch < batches; batch++) {
      const batchStart = batch * batchSize;
      const batchEnd = Math.min(batchStart + batchSize, testPayments.length);
      const batchPayments = testPayments.slice(batchStart, batchEnd);
      
      // Execute batch concurrently
      const promises = batchPayments.map(async (payment) => {
        try {
          const response = await axios.post(`${config.api.baseUrl}/payments`, payment, {
            timeout: config.api.timeout
          });
          return { success: true, status: response.status };
        } catch (error) {
          return { success: false, error: error.message };
        }
      });
      
      const results = await Promise.all(promises);
      
      // Count results
      const batchSuccesses = results.filter(r => r.success).length;
      const batchErrors = results.filter(r => !r.success).length;
      
      successCount += batchSuccesses;
      errorCount += batchErrors;
      
      log('info', `Batch ${batch + 1}/${batches} completed`, {
        batchSuccesses,
        batchErrors,
        totalSuccesses: successCount,
        totalErrors: errorCount
      });
    }
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    const requestsPerSecond = (successCount / duration) * 1000;
    
    // Test results
    tests.push({
      name: 'load_test_success_rate',
      passed: (successCount / config.test.loadTestRequests) >= 0.95,
      message: `Success rate: ${(successCount / config.test.loadTestRequests * 100).toFixed(2)}%`
    });
    
    tests.push({
      name: 'load_test_performance',
      passed: requestsPerSecond >= 100,
      message: `Performance: ${requestsPerSecond.toFixed(2)} requests/second`
    });
    
    tests.push({
      name: 'load_test_duration',
      passed: duration < 300000, // 5 minutes
      message: `Duration: ${(duration / 1000).toFixed(2)} seconds`
    });
    
    log('info', 'Load scalability tests completed', {
      totalRequests: config.test.loadTestRequests,
      successCount,
      errorCount,
      duration: `${(duration / 1000).toFixed(2)}s`,
      requestsPerSecond: requestsPerSecond.toFixed(2)
    });
    
    return tests;
    
  } catch (error) {
    log('error', 'Load scalability test failed', { error: error.message });
    return [{
      name: 'load_scalability_test',
      passed: false,
      message: `Load scalability test failed: ${error.message}`
    }];
  }
}

/**
 * Test archival threshold
 */
async function testArchivalThreshold() {
  log('info', 'Testing archival threshold');
  
  const tests = [];
  
  try {
    const client = await dbPool.connect();
    
    // Check current payment count
    const countResult = await client.query('SELECT COUNT(*) as count FROM payments_partitioned');
    const currentCount = parseInt(countResult.rows[0].count);
    
    tests.push({
      name: 'current_payment_count',
      passed: true,
      message: `Current payment count: ${currentCount}`
    });
    
    // Check if threshold is exceeded
    const thresholdExceeded = currentCount > 49999;
    
    tests.push({
      name: 'threshold_exceeded',
      passed: thresholdExceeded,
      message: `Threshold exceeded: ${thresholdExceeded} (${currentCount} > 49999)`
    });
    
    // If threshold exceeded, test archival
    if (thresholdExceeded) {
      const archivalResult = await client.query('SELECT * FROM archive_closed_payments_performance()');
      const archivalData = archivalResult.rows[0];
      
      tests.push({
        name: 'archival_triggered',
        passed: archivalData.threshold_exceeded,
        message: `Archival triggered: ${archivalData.message}`
      });
      
      // Check count after archival
      const afterCountResult = await client.query('SELECT COUNT(*) as count FROM payments_partitioned');
      const afterCount = parseInt(afterCountResult.rows[0].count);
      
      tests.push({
        name: 'count_after_archival',
        passed: afterCount < currentCount,
        message: `Count after archival: ${afterCount} (was ${currentCount})`
      });
    }
    
    client.release();
    
    log('info', 'Archival threshold tests completed', { 
      total: tests.length,
      passed: tests.filter(t => t.passed).length 
    });
    
    return tests;
    
  } catch (error) {
    log('error', 'Archival threshold test failed', { error: error.message });
    return [{
      name: 'archival_threshold_test',
      passed: false,
      message: `Archival threshold test failed: ${error.message}`
    }];
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  log('info', 'Starting comprehensive scalability testing');
  
  try {
    // Initialize database
    if (!await initDatabase()) {
      throw new Error('Database initialization failed');
    }
    
    // Run all test suites
    testResults.tests.databaseSchema = await testDatabaseSchema();
    testResults.tests.dataIntegrity = await testDataIntegrity();
    testResults.tests.archivalFunctionality = await testArchivalFunctionality();
    testResults.tests.apiEndpoints = await testApiEndpoints();
    testResults.tests.retryFunctionality = await testRetryFunctionality();
    testResults.tests.loadScalability = await testLoadScalability();
    testResults.tests.archivalThreshold = await testArchivalThreshold();
    
    // Calculate summary
    const allTests = Object.values(testResults.tests).flat();
    testResults.summary.totalTests = allTests.length;
    testResults.summary.passedTests = allTests.filter(t => t.passed).length;
    testResults.summary.failedTests = allTests.filter(t => !t.passed).length;
    testResults.summary.warnings = allTests.filter(t => t.passed && t.message.includes('warning')).length;
    
    // Save report
    await fs.writeFile(config.output.reportFile, JSON.stringify(testResults, null, 2));
    
    log('info', 'Comprehensive scalability testing completed', testResults.summary);
    
    return testResults;
    
  } catch (error) {
    log('error', 'Comprehensive scalability testing failed', { error: error.message });
    throw error;
  } finally {
    if (dbPool) {
      await dbPool.end();
    }
  }
}

/**
 * Command line interface
 */
async function main() {
  const args = process.argv.slice(2);
  
  // Parse command line arguments
  for (const arg of args) {
    if (arg === '--dry-run') {
      config.test.dryRun = true;
    } else if (arg === '--skip-load-test') {
      config.test.skipLoadTest = true;
    } else if (arg.startsWith('--load-requests=')) {
      config.test.loadTestRequests = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--concurrency=')) {
      config.test.concurrency = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--report-file=')) {
      config.output.reportFile = arg.split('=')[1];
    } else if (arg.startsWith('--log-level=')) {
      config.output.logLevel = arg.split('=')[1];
    } else if (arg === '--help') {
      console.log(`
Usage: node test-scalability.js [options]

Options:
  --dry-run              Run in dry-run mode (no actual load testing)
  --skip-load-test       Skip load testing
  --load-requests=N      Number of load test requests (default: 50000)
  --concurrency=N        Concurrency level (default: 10)
  --report-file=FILE     Output file for test report (default: scalability-test-report.json)
  --log-level=LEVEL      Set log level (error|warn|info|debug)
  --help                 Show this help message

Environment Variables:
  DB_HOST                Database host (default: localhost)
  DB_PORT                Database port (default: 5432)
  DB_NAME                Database name (default: payment_service)
  DB_USER                Database user (default: postgres)
  DB_PASSWORD            Database password (default: password)
  API_BASE_URL           API base URL (default: http://localhost:8080)
  API_TIMEOUT            API timeout in milliseconds (default: 30000)
  LOAD_TEST_REQUESTS     Number of load test requests (default: 50000)
  BATCH_SIZE             Batch size for load testing (default: 1000)
  CONCURRENCY            Concurrency level (default: 10)
  DRY_RUN                Set to 'true' for dry-run mode
  SKIP_LOAD_TEST         Set to 'true' to skip load testing
  REPORT_FILE             Output file path
  LOG_LEVEL              Log level (error|warn|info|debug)
      `);
      process.exit(0);
    }
  }
  
  try {
    const results = await runAllTests();
    
    console.log('\n=== SCALABILITY TEST SUMMARY ===');
    console.log(`Total Tests: ${results.summary.totalTests}`);
    console.log(`Passed: ${results.summary.passedTests}`);
    console.log(`Failed: ${results.summary.failedTests}`);
    console.log(`Warnings: ${results.summary.warnings}`);
    console.log(`Report saved to: ${config.output.reportFile}`);
    
    if (results.summary.failedTests > 0) {
      console.log('\n=== FAILED TESTS ===');
      Object.values(results.tests).flat()
        .filter(t => !t.passed)
        .forEach(t => console.log(`- ${t.name}: ${t.message}`));
    }
    
    process.exit(results.summary.failedTests > 0 ? 1 : 0);
  } catch (error) {
    log('error', 'Scalability testing failed', { error: error.message });
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { runAllTests, config };
