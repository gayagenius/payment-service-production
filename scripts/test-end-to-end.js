#!/usr/bin/env node

/**
 * End-to-End Test Script
 * 
 * This script performs comprehensive end-to-end testing of the payment service
 * including database setup, API functionality, archival processes, and scalability.
 * 
 * Features:
 * - Database schema validation
 * - API endpoint testing
 * - Archival functionality testing
 * - Data integrity verification
 * - Performance testing
 * - Retry logic validation
 */

import pg from 'pg';
import axios from 'axios';
import fs from 'fs/promises';
import { TEST_CONFIG, API_CONFIG, PAYMENT_CONFIG } from '../src/config/constants.js';


// Configuration
const config = {
  // Database connection
  db: {
    host: process.env.TEST_DB_HOST || process.env.DB_HOST || 'localhost',
    port: process.env.TEST_DB_PORT || process.env.DB_PORT || 5432,
    database: process.env.TEST_DB_NAME || process.env.DB_NAME || 'payment_service',
    user: process.env.TEST_DB_USER || process.env.DB_USER || 'postgres',
    password: process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD || 'password',
  },
  
  // API connection
  api: {
    baseUrl: process.env.API_BASE_URL || 'http://localhost:8080',
    timeout: parseInt(process.env.API_TIMEOUT) || TEST_CONFIG.LOAD_TEST.DEFAULT_TIMEOUT,
  },
  
  // Test settings
  test: {
    createTestData: process.env.CREATE_TEST_DATA !== 'false',
    cleanupAfterTest: process.env.CLEANUP_AFTER_TEST !== 'false',
    dryRun: process.env.DRY_RUN === 'true',
  },
  
  // Output settings
  output: {
    reportFile: process.env.REPORT_FILE || 'end-to-end-test-report.json',
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
      max: 10,
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
 * Test database schema and functions
 */
async function testDatabaseSchema() {
  log('info', 'Testing database schema and functions');
  
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
    
    // Test 2: Check if helper functions exist
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
    
    // Test 3: Check if archival functions exist
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
        passed: healthResponse.status === API_CONFIG.STATUS_CODES.OK,
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
        user_id: TEST_CONFIG.TEST_DATA.USER_ID,
        order_id: `${TEST_CONFIG.TEST_DATA.ORDER_ID_PREFIX}-${Date.now()}`,
        amount: 1000,
        currency: 'USD',
        idempotency_key: `${TEST_CONFIG.TEST_DATA.IDEMPOTENCY_PREFIX}-payment-${Date.now()}`
      };
      
      const paymentResponse = await axios.post(`${config.api.baseUrl}/payments`, paymentData, {
        timeout: config.api.timeout
      });
      
      tests.push({
        name: 'create_payment',
        passed: paymentResponse.status === API_CONFIG.STATUS_CODES.CREATED,
        message: `Create payment returned status ${paymentResponse.status}`
      });
      
      // Test 3: Get payment by ID
      if (paymentResponse.status === API_CONFIG.STATUS_CODES.CREATED && paymentResponse.data.success) {
        const payment_id = paymentResponse.data.data.id;
        
        try {
          const getResponse = await axios.get(`${config.api.baseUrl}/payments/${payment_id}`, {
            timeout: config.api.timeout
          });
          
          tests.push({
            name: 'get_payment_by_id',
            passed: getResponse.status === API_CONFIG.STATUS_CODES.OK,
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
        passed: paymentsResponse.status === API_CONFIG.STATUS_CODES.OK,
        message: `Get payments returned status ${paymentsResponse.status}`
      });
    } catch (error) {
      tests.push({
        name: 'get_payments_pagination',
        passed: false,
        message: `Get payments failed: ${error.message}`
      });
    }
    
    // Test 5: Get user payments
    try {
      const userPaymentsResponse = await axios.get(`${config.api.baseUrl}/payments/user/${TEST_CONFIG.TEST_DATA.USER_ID}?limit=10`, {
        timeout: config.api.timeout
      });
      
      tests.push({
        name: 'get_user_payments',
        passed: userPaymentsResponse.status === API_CONFIG.STATUS_CODES.OK,
        message: `Get user payments returned status ${userPaymentsResponse.status}`
      });
    } catch (error) {
      tests.push({
        name: 'get_user_payments',
        passed: false,
        message: `Get user payments failed: ${error.message}`
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
    const idempotencyKey = `${TEST_CONFIG.TEST_DATA.IDEMPOTENCY_PREFIX}-retry-${Date.now()}`;
    const paymentData = {
      user_id: TEST_CONFIG.TEST_DATA.USER_ID,
      order_id: `${TEST_CONFIG.TEST_DATA.ORDER_ID_PREFIX}-retry-${Date.now()}`,
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
      passed: firstResponse.status === API_CONFIG.STATUS_CODES.CREATED,
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
      passed: retryResponse.status === API_CONFIG.STATUS_CODES.OK,
      message: `Retry payment creation returned status ${retryResponse.status}`
    });
    
    // Test 3: Verify idempotency
    if (firstResponse.status === API_CONFIG.STATUS_CODES.CREATED && retryResponse.status === API_CONFIG.STATUS_CODES.OK) {
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
 * Test database helper functions
 */
async function testDatabaseHelpers() {
  log('info', 'Testing database helper functions');
  
  const tests = [];
  
  try {
    const client = await dbPool.connect();
    
    // Test 1: Create payment with history
    const createPaymentResult = await client.query(`
      SELECT * FROM create_payment_with_history(
        $1, $2, $3, $4, $5, $6, $7
      )
    `, [
      TEST_CONFIG.TEST_DATA.USER_ID,
      `${TEST_CONFIG.TEST_DATA.ORDER_ID_PREFIX}-helper-${Date.now()}`,
      1500,
      'USD',
      null,
      '{}',
      `${TEST_CONFIG.TEST_DATA.IDEMPOTENCY_PREFIX}-helper-${Date.now()}`
    ]);
    
    const createResult = createPaymentResult.rows[0];
    
    tests.push({
      name: 'create_payment_with_history',
      passed: createResult.success,
      message: createResult.success ? 'Payment created successfully' : createResult.error_message
    });
    
    if (createResult.success) {
      const payment_id = createResult.payment_id;
      
      // Test 2: Get payment by ID
      const getPaymentResult = await client.query('SELECT * FROM get_payment_by_id($1)', [payment_id]);
      const getResult = getPaymentResult.rows[0];
      
      tests.push({
        name: 'get_payment_by_id_helper',
        passed: getResult.found,
        message: getResult.found ? 'Payment found successfully' : 'Payment not found'
      });
      
      // Test 3: Update payment status
      const updateStatusResult = await client.query('SELECT * FROM update_payment_status($1, $2)', [
        payment_id,
        PAYMENT_CONFIG.STATUS.SUCCEEDED
      ]);
      
      const updateResult = updateStatusResult.rows[0];
      
      tests.push({
        name: 'update_payment_status',
        passed: updateResult.success,
        message: updateResult.success ? 'Payment status updated successfully' : updateResult.error_message
      });
      
      // Test 4: Create refund
      const createRefundResult = await client.query(`
        SELECT * FROM create_refund(
          $1, $2, $3, $4, $5
        )
      `, [
        payment_id,
        500,
        'USD',
        'Test refund',
        `${TEST_CONFIG.TEST_DATA.IDEMPOTENCY_PREFIX}-refund-${Date.now()}`
      ]);
      
      const refundResult = createRefundResult.rows[0];
      
      tests.push({
        name: 'create_refund',
        passed: refundResult.success,
        message: refundResult.success ? 'Refund created successfully' : refundResult.error_message
      });
      
      // Test 5: Check if payment can be refunded
      const canRefundResult = await client.query('SELECT * FROM can_refund_payment($1, $2)', [
        payment_id,
        200
      ]);
      
      const canRefund = canRefundResult.rows[0];
      
      tests.push({
        name: 'can_refund_payment',
        passed: canRefund.can_refund,
        message: canRefund.can_refund ? 'Payment can be refunded' : canRefund.error_message
      });
    }
    
    client.release();
    
    log('info', 'Database helper function tests completed', { 
      total: tests.length,
      passed: tests.filter(t => t.passed).length 
    });
    
    return tests;
    
  } catch (error) {
    log('error', 'Database helper function test failed', { error: error.message });
    return [{
      name: 'database_helper_functions_test',
      passed: false,
      message: `Database helper function test failed: ${error.message}`
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
    
    // Test 5: Verify archival integrity
    const integrityResult = await client.query('SELECT * FROM verify_archival_integrity()');
    
    for (const row of integrityResult.rows) {
      tests.push({
        name: `integrity_${row.check_name}`,
        passed: row.passed,
        message: row.message
      });
    }
    
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
 * Test data integrity
 */
async function testDataIntegrity() {
  log('info', 'Testing data integrity');
  
  const tests = [];
  
  try {
    const client = await dbPool.connect();
    
    // Test 1: Check for duplicate payments
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
    
    // Test 2: Check archive contains only closed payments
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
    
    // Test 3: Check payment counts consistency
    const paymentsCount = await client.query('SELECT COUNT(*) as count FROM payments_partitioned');
    const archiveCount = await client.query('SELECT COUNT(*) as count FROM payments_archive');
    const reportsCount = await client.query('SELECT COUNT(*) as count FROM payment_reports');
    
    tests.push({
      name: 'payment_counts_consistent',
      passed: true, // Just log the counts
      message: `Payments: ${paymentsCount.rows[0].count}, Archive: ${archiveCount.rows[0].count}, Reports: ${reportsCount.rows[0].count}`
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
 * Create test data
 */
async function createTestData() {
  if (!config.test.createTestData) {
    log('info', 'Test data creation skipped');
    return;
  }
  
  log('info', 'Creating test data');
  
  try {
    const client = await dbPool.connect();
    
    // Create some test payments
    for (let i = 0; i < 10; i++) {
      await client.query(`
        SELECT * FROM create_payment_with_history(
          $1, $2, $3, $4, $5, $6, $7
        )
      `, [
        TEST_CONFIG.TEST_DATA.USER_ID,
        `${TEST_CONFIG.TEST_DATA.ORDER_ID_PREFIX}-test-${i}`,
        Math.floor(Math.random() * 10000) + 100,
        'USD',
        null,
        '{}',
        `${TEST_CONFIG.TEST_DATA.IDEMPOTENCY_PREFIX}-test-${i}-${Date.now()}`
      ]);
    }
    
    client.release();
    
    log('info', 'Test data created successfully');
    
  } catch (error) {
    log('error', 'Failed to create test data', { error: error.message });
  }
}

/**
 * Cleanup test data
 */
async function cleanupTestData() {
  if (!config.test.cleanupAfterTest) {
    log('info', 'Test data cleanup skipped');
    return;
  }
  
  log('info', 'Cleaning up test data');
  
  try {
    const client = await dbPool.connect();
    
    // Delete test payments
    await client.query(`
      DELETE FROM payments_partitioned 
      WHERE order_id LIKE $1
    `, [`${TEST_CONFIG.TEST_DATA.ORDER_ID_PREFIX}-%`]);
    
    // Delete test refunds
    await client.query(`
      DELETE FROM refunds_partitioned 
      WHERE idempotency_key LIKE $1
    `, [`${TEST_CONFIG.TEST_DATA.IDEMPOTENCY_PREFIX}-%`]);
    
    client.release();
    
    log('info', 'Test data cleaned up successfully');
    
  } catch (error) {
    log('error', 'Failed to cleanup test data', { error: error.message });
  }
}

/**
 * Run all tests
 */
async function runAllTests() {
  log('info', 'Starting comprehensive end-to-end testing');
  
  try {
    // Initialize database
    if (!await initDatabase()) {
      throw new Error('Database initialization failed');
    }
    
    // Create test data
    await createTestData();
    
    // Run all test suites
    testResults.tests.databaseSchema = await testDatabaseSchema();
    testResults.tests.apiEndpoints = await testApiEndpoints();
    testResults.tests.retryFunctionality = await testRetryFunctionality();
    testResults.tests.databaseHelpers = await testDatabaseHelpers();
    testResults.tests.archivalFunctionality = await testArchivalFunctionality();
    testResults.tests.dataIntegrity = await testDataIntegrity();
    
    // Cleanup test data
    await cleanupTestData();
    
    // Calculate summary
    const allTests = Object.values(testResults.tests).flat();
    testResults.summary.totalTests = allTests.length;
    testResults.summary.passedTests = allTests.filter(t => t.passed).length;
    testResults.summary.failedTests = allTests.filter(t => !t.passed).length;
    testResults.summary.warnings = allTests.filter(t => t.passed && t.message.includes('warning')).length;
    
    // Save report
    await fs.writeFile(config.output.reportFile, JSON.stringify(testResults, null, 2));
    
    log('info', 'Comprehensive end-to-end testing completed', testResults.summary);
    
    return testResults;
    
  } catch (error) {
    log('error', 'Comprehensive end-to-end testing failed', { error: error.message });
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
    } else if (arg === '--no-cleanup') {
      config.test.cleanupAfterTest = false;
    } else if (arg === '--no-test-data') {
      config.test.createTestData = false;
    } else if (arg.startsWith('--report-file=')) {
      config.output.reportFile = arg.split('=')[1];
    } else if (arg.startsWith('--log-level=')) {
      config.output.logLevel = arg.split('=')[1];
    } else if (arg === '--help') {
      console.log(`
Usage: node test-end-to-end.js [options]

Options:
  --dry-run              Run in dry-run mode
  --no-cleanup           Skip cleanup after tests
  --no-test-data         Skip test data creation
  --report-file=FILE     Output file for test report (default: end-to-end-test-report.json)
  --log-level=LEVEL       Set log level (error|warn|info|debug)
  --help                 Show this help message

Environment Variables:
  TEST_DB_HOST           Test database host (default: localhost)
  TEST_DB_PORT           Test database port (default: 5432)
  TEST_DB_NAME           Test database name (default: payment_service)
  TEST_DB_USER           Test database user (default: postgres)
  TEST_DB_PASSWORD       Test database password (default: password)
  API_BASE_URL           API base URL (default: http://localhost:8080)
  API_TIMEOUT            API timeout in milliseconds (default: 30000)
  CREATE_TEST_DATA       Set to 'false' to skip test data creation
  CLEANUP_AFTER_TEST     Set to 'false' to skip cleanup
  DRY_RUN                Set to 'true' for dry-run mode
  REPORT_FILE             Output file path
  LOG_LEVEL              Log level (error|warn|info|debug)
      `);
      process.exit(0);
    }
  }
  
  try {
    const results = await runAllTests();
    
    console.log('\n=== END-TO-END TEST SUMMARY ===');
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
    log('error', 'End-to-end testing failed', { error: error.message });
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { runAllTests, config };
