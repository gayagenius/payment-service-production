#!/usr/bin/env node

/**
 * Complete Setup Script
 * 
 * This script performs a complete end-to-end setup of the payment service
 * including database setup, migrations, testing, and validation.
 * 
 * Features:
 * - Database schema setup
 * - Partitioning migration
 * - Data migration
 * - Index optimization
 * - End-to-end testing
 * - Comprehensive validation
 */

import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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
  
  // Setup options
  setup: {
    createDatabase: process.env.CREATE_DATABASE !== 'false',
    runMigrations: process.env.RUN_MIGRATIONS !== 'false',
    migrateData: process.env.MIGRATE_DATA !== 'false',
    optimizeIndexes: process.env.OPTIMIZE_INDEXES !== 'false',
    runTests: process.env.RUN_TESTS !== 'false',
    dryRun: process.env.DRY_RUN === 'true',
  },
  
  // Output settings
  output: {
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

// Setup results
const setupResults = {
  timestamp: new Date().toISOString(),
  configuration: config,
  steps: {},
  summary: {
    totalSteps: 0,
    completedSteps: 0,
    failedSteps: 0,
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
 * Step 1: Create database if it doesn't exist
 */
async function createDatabase() {
  if (!config.setup.createDatabase) {
    log('info', 'Database creation skipped');
    return { success: true, message: 'Database creation skipped' };
  }
  
  log('info', 'Creating database if it doesn\'t exist');
  
  try {
    // Connect to postgres database to create the target database
    const adminPool = new pg.Pool({
      host: config.db.host,
      port: config.db.port,
      database: 'postgres',
      user: config.db.user,
      password: config.db.password,
    });
    
    const client = await adminPool.connect();
    
    // Check if database exists
    const dbExists = await client.query(`
      SELECT 1 FROM pg_database WHERE datname = $1
    `, [config.db.database]);
    
    if (dbExists.rows.length === 0) {
      // Create database
      await client.query(`CREATE DATABASE ${config.db.database}`);
      log('info', `Database ${config.db.database} created successfully`);
    } else {
      log('info', `Database ${config.db.database} already exists`);
    }
    
    client.release();
    await adminPool.end();
    
    return { success: true, message: 'Database creation completed' };
    
  } catch (error) {
    log('error', 'Database creation failed', { error: error.message });
    return { success: false, message: `Database creation failed: ${error.message}` };
  }
}

/**
 * Step 2: Run initial schema migration
 */
async function runInitialMigration() {
  if (!config.setup.runMigrations) {
    log('info', 'Initial migration skipped');
    return { success: true, message: 'Initial migration skipped' };
  }
  
  log('info', 'Running initial schema migration');
  
  try {
    const migrationFile = join(__dirname, '..', 'db', 'migrations', 'payment_service_schema.sql');
    
    // Check if migration file exists
    try {
      await fs.access(migrationFile);
    } catch (error) {
      log('warn', 'Initial migration file not found, skipping');
      return { success: true, message: 'Initial migration file not found' };
    }
    
    // Run migration
    const command = `psql -h ${config.db.host} -p ${config.db.port} -U ${config.db.user} -d ${config.db.database} -f "${migrationFile}"`;
    
    if (config.setup.dryRun) {
      log('info', 'Dry run: Would execute migration command', { command });
      return { success: true, message: 'Migration command prepared (dry run)' };
    }
    
    const { stdout, stderr } = await execAsync(command, {
      env: { ...process.env, PGPASSWORD: config.db.password }
    });
    
    if (stderr && !stderr.includes('NOTICE')) {
      log('warn', 'Migration warnings', { stderr });
    }
    
    log('info', 'Initial schema migration completed');
    return { success: true, message: 'Initial schema migration completed' };
    
  } catch (error) {
    log('error', 'Initial migration failed', { error: error.message });
    return { success: false, message: `Initial migration failed: ${error.message}` };
  }
}

/**
 * Step 3: Run partitioning migration
 */
async function runPartitioningMigration() {
  if (!config.setup.runMigrations) {
    log('info', 'Partitioning migration skipped');
    return { success: true, message: 'Partitioning migration skipped' };
  }
  
  log('info', 'Running partitioning migration');
  
  try {
    const migrationFile = join(__dirname, '..', 'db', 'migrations', 'V001_enable_partitioning.sql');
    
    // Check if migration file exists
    try {
      await fs.access(migrationFile);
    } catch (error) {
      log('warn', 'Partitioning migration file not found, skipping');
      return { success: true, message: 'Partitioning migration file not found' };
    }
    
    // Run migration
    const command = `psql -h ${config.db.host} -p ${config.db.port} -U ${config.db.user} -d ${config.db.database} -f "${migrationFile}"`;
    
    if (config.setup.dryRun) {
      log('info', 'Dry run: Would execute partitioning migration', { command });
      return { success: true, message: 'Partitioning migration command prepared (dry run)' };
    }
    
    const { stdout, stderr } = await execAsync(command, {
      env: { ...process.env, PGPASSWORD: config.db.password }
    });
    
    if (stderr && !stderr.includes('NOTICE')) {
      log('warn', 'Partitioning migration warnings', { stderr });
    }
    
    log('info', 'Partitioning migration completed');
    return { success: true, message: 'Partitioning migration completed' };
    
  } catch (error) {
    log('error', 'Partitioning migration failed', { error: error.message });
    return { success: false, message: `Partitioning migration failed: ${error.message}` };
  }
}

/**
 * Step 4: Run archival jobs setup
 */
async function runArchivalJobsSetup() {
  if (!config.setup.runMigrations) {
    log('info', 'Archival jobs setup skipped');
    return { success: true, message: 'Archival jobs setup skipped' };
  }
  
  log('info', 'Setting up archival jobs');
  
  try {
    const jobsFile = join(__dirname, '..', 'jobs', 'archiveClosedPayments.sql');
    
    // Check if jobs file exists
    try {
      await fs.access(jobsFile);
    } catch (error) {
      log('warn', 'Archival jobs file not found, skipping');
      return { success: true, message: 'Archival jobs file not found' };
    }
    
    // Run jobs setup
    const command = `psql -h ${config.db.host} -p ${config.db.port} -U ${config.db.user} -d ${config.db.database} -f "${jobsFile}"`;
    
    if (config.setup.dryRun) {
      log('info', 'Dry run: Would execute archival jobs setup', { command });
      return { success: true, message: 'Archival jobs setup command prepared (dry run)' };
    }
    
    const { stdout, stderr } = await execAsync(command, {
      env: { ...process.env, PGPASSWORD: config.db.password }
    });
    
    if (stderr && !stderr.includes('NOTICE')) {
      log('warn', 'Archival jobs setup warnings', { stderr });
    }
    
    log('info', 'Archival jobs setup completed');
    return { success: true, message: 'Archival jobs setup completed' };
    
  } catch (error) {
    log('error', 'Archival jobs setup failed', { error: error.message });
    return { success: false, message: `Archival jobs setup failed: ${error.message}` };
  }
}

/**
 * Step 5: Run helper functions setup
 */
async function runHelperFunctionsSetup() {
  if (!config.setup.runMigrations) {
    log('info', 'Helper functions setup skipped');
    return { success: true, message: 'Helper functions setup skipped' };
  }
  
  log('info', 'Setting up helper functions');
  
  try {
    const helpersFile = join(__dirname, '..', 'src', 'db', 'roHelpers.sql');
    
    // Check if helpers file exists
    try {
      await fs.access(helpersFile);
    } catch (error) {
      log('warn', 'Helper functions file not found, skipping');
      return { success: true, message: 'Helper functions file not found' };
    }
    
    // Run helpers setup
    const command = `psql -h ${config.db.host} -p ${config.db.port} -U ${config.db.user} -d ${config.db.database} -f "${helpersFile}"`;
    
    if (config.setup.dryRun) {
      log('info', 'Dry run: Would execute helper functions setup', { command });
      return { success: true, message: 'Helper functions setup command prepared (dry run)' };
    }
    
    const { stdout, stderr } = await execAsync(command, {
      env: { ...process.env, PGPASSWORD: config.db.password }
    });
    
    if (stderr && !stderr.includes('NOTICE')) {
      log('warn', 'Helper functions setup warnings', { stderr });
    }
    
    log('info', 'Helper functions setup completed');
    return { success: true, message: 'Helper functions setup completed' };
    
  } catch (error) {
    log('error', 'Helper functions setup failed', { error: error.message });
    return { success: false, message: `Helper functions setup failed: ${error.message}` };
  }
}

/**
 * Step 6: Migrate existing data
 */
async function migrateExistingData() {
  if (!config.setup.migrateData) {
    log('info', 'Data migration skipped');
    return { success: true, message: 'Data migration skipped' };
  }
  
  log('info', 'Migrating existing data to partitioned tables');
  
  try {
    const command = `npm run backfill:dry-run`;
    
    if (config.setup.dryRun) {
      log('info', 'Dry run: Would execute data migration', { command });
      return { success: true, message: 'Data migration command prepared (dry run)' };
    }
    
    // First run dry-run to check
    const dryRunCommand = `npm run backfill:dry-run`;
    const { stdout: dryRunOutput, stderr: dryRunError } = await execAsync(dryRunCommand, {
      cwd: join(__dirname, '..')
    });
    
    if (dryRunError) {
      log('warn', 'Data migration dry-run warnings', { stderr: dryRunError });
    }
    
    // Then run actual migration
    const migrationCommand = `npm run backfill`;
    const { stdout: migrationOutput, stderr: migrationError } = await execAsync(migrationCommand, {
      cwd: join(__dirname, '..')
    });
    
    if (migrationError) {
      log('warn', 'Data migration warnings', { stderr: migrationError });
    }
    
    log('info', 'Data migration completed');
    return { success: true, message: 'Data migration completed' };
    
  } catch (error) {
    log('error', 'Data migration failed', { error: error.message });
    return { success: false, message: `Data migration failed: ${error.message}` };
  }
}

/**
 * Step 7: Optimize indexes
 */
async function optimizeIndexes() {
  if (!config.setup.optimizeIndexes) {
    log('info', 'Index optimization skipped');
    return { success: true, message: 'Index optimization skipped' };
  }
  
  log('info', 'Optimizing database indexes');
  
  try {
    const command = `npm run optimize-indexes:create`;
    
    if (config.setup.dryRun) {
      log('info', 'Dry run: Would execute index optimization', { command });
      return { success: true, message: 'Index optimization command prepared (dry run)' };
    }
    
    const { stdout, stderr } = await execAsync(command, {
      cwd: join(__dirname, '..')
    });
    
    if (stderr) {
      log('warn', 'Index optimization warnings', { stderr });
    }
    
    log('info', 'Index optimization completed');
    return { success: true, message: 'Index optimization completed' };
    
  } catch (error) {
    log('error', 'Index optimization failed', { error: error.message });
    return { success: false, message: `Index optimization failed: ${error.message}` };
  }
}

/**
 * Step 8: Run end-to-end tests
 */
async function runEndToEndTests() {
  if (!config.setup.runTests) {
    log('info', 'End-to-end tests skipped');
    return { success: true, message: 'End-to-end tests skipped' };
  }
  
  log('info', 'Running end-to-end tests');
  
  try {
    const command = `npm run test:e2e`;
    
    if (config.setup.dryRun) {
      log('info', 'Dry run: Would execute end-to-end tests', { command });
      return { success: true, message: 'End-to-end tests command prepared (dry run)' };
    }
    
    const { stdout, stderr } = await execAsync(command, {
      cwd: join(__dirname, '..')
    });
    
    if (stderr) {
      log('warn', 'End-to-end test warnings', { stderr });
    }
    
    log('info', 'End-to-end tests completed');
    return { success: true, message: 'End-to-end tests completed' };
    
  } catch (error) {
    log('error', 'End-to-end tests failed', { error: error.message });
    return { success: false, message: `End-to-end tests failed: ${error.message}` };
  }
}

/**
 * Step 9: Validate setup
 */
async function validateSetup() {
  log('info', 'Validating complete setup');
  
  try {
    const client = await dbPool.connect();
    
    // Check if all required tables exist
    const tablesCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN (
        'payments_partitioned', 'refunds_partitioned', 
        'payments_archive', 'refunds_archive', 'payment_reports',
        'archival_config'
      )
    `);
    
    const requiredTables = [
      'payments_partitioned', 'refunds_partitioned', 
      'payments_archive', 'refunds_archive', 'payment_reports',
      'archival_config'
    ];
    
    const foundTables = tablesCheck.rows.map(row => row.table_name);
    const missingTables = requiredTables.filter(table => !foundTables.includes(table));
    
    if (missingTables.length > 0) {
      return { 
        success: false, 
        message: `Missing required tables: ${missingTables.join(', ')}` 
      };
    }
    
    // Check if helper functions exist
    const functionsCheck = await client.query(`
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
        'can_refund_payment',
        'archive_closed_payments_performance',
        'archive_payments_compliance',
        'generate_payment_reports',
        'verify_archival_integrity'
      )
    `);
    
    const requiredFunctions = [
      'create_payment_with_history',
      'get_payment_by_id',
      'get_payments_by_user',
      'update_payment_status',
      'create_refund',
      'get_refund_by_id',
      'can_refund_payment',
      'archive_closed_payments_performance',
      'archive_payments_compliance',
      'generate_payment_reports',
      'verify_archival_integrity'
    ];
    
    const foundFunctions = functionsCheck.rows.map(row => row.routine_name);
    const missingFunctions = requiredFunctions.filter(func => !foundFunctions.includes(func));
    
    if (missingFunctions.length > 0) {
      return { 
        success: false, 
        message: `Missing required functions: ${missingFunctions.join(', ')}` 
      };
    }
    
    // Check archival configuration
    const configCheck = await client.query('SELECT * FROM get_archival_config()');
    
    if (configCheck.rows.length === 0) {
      return { 
        success: false, 
        message: 'Archival configuration not found' 
      };
    }
    
    client.release();
    
    log('info', 'Setup validation completed successfully');
    return { success: true, message: 'Setup validation completed successfully' };
    
  } catch (error) {
    log('error', 'Setup validation failed', { error: error.message });
    return { success: false, message: `Setup validation failed: ${error.message}` };
  }
}

/**
 * Run complete setup
 */
async function runCompleteSetup() {
  log('info', 'Starting complete payment service setup');
  
  try {
    // Initialize database connection
    if (!await initDatabase()) {
      throw new Error('Database initialization failed');
    }
    
    // Define setup steps
    const steps = [
      { name: 'createDatabase', fn: createDatabase },
      { name: 'runInitialMigration', fn: runInitialMigration },
      { name: 'runPartitioningMigration', fn: runPartitioningMigration },
      { name: 'runArchivalJobsSetup', fn: runArchivalJobsSetup },
      { name: 'runHelperFunctionsSetup', fn: runHelperFunctionsSetup },
      { name: 'migrateExistingData', fn: migrateExistingData },
      { name: 'optimizeIndexes', fn: optimizeIndexes },
      { name: 'runEndToEndTests', fn: runEndToEndTests },
      { name: 'validateSetup', fn: validateSetup },
    ];
    
    setupResults.summary.totalSteps = steps.length;
    
    // Execute each step
    for (const step of steps) {
      log('info', `Executing step: ${step.name}`);
      
      try {
        const result = await step.fn();
        setupResults.steps[step.name] = result;
        
        if (result.success) {
          setupResults.summary.completedSteps++;
          log('info', `Step ${step.name} completed successfully`, { message: result.message });
        } else {
          setupResults.summary.failedSteps++;
          log('error', `Step ${step.name} failed`, { message: result.message });
        }
      } catch (error) {
        setupResults.summary.failedSteps++;
        setupResults.steps[step.name] = {
          success: false,
          message: `Step ${step.name} failed with error: ${error.message}`
        };
        log('error', `Step ${step.name} failed`, { error: error.message });
      }
    }
    
    // Save setup report
    const reportFile = join(__dirname, '..', 'setup-report.json');
    await fs.writeFile(reportFile, JSON.stringify(setupResults, null, 2));
    
    log('info', 'Complete setup finished', setupResults.summary);
    
    return setupResults;
    
  } catch (error) {
    log('error', 'Complete setup failed', { error: error.message });
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
      config.setup.dryRun = true;
    } else if (arg === '--no-database') {
      config.setup.createDatabase = false;
    } else if (arg === '--no-migrations') {
      config.setup.runMigrations = false;
    } else if (arg === '--no-data-migration') {
      config.setup.migrateData = false;
    } else if (arg === '--no-indexes') {
      config.setup.optimizeIndexes = false;
    } else if (arg === '--no-tests') {
      config.setup.runTests = false;
    } else if (arg.startsWith('--log-level=')) {
      config.output.logLevel = arg.split('=')[1];
    } else if (arg === '--help') {
      console.log(`
Usage: node setup-complete.js [options]

Options:
  --dry-run              Run in dry-run mode (no actual changes)
  --no-database          Skip database creation
  --no-migrations        Skip all migrations
  --no-data-migration    Skip data migration
  --no-indexes           Skip index optimization
  --no-tests             Skip end-to-end tests
  --log-level=LEVEL      Set log level (error|warn|info|debug)
  --help                 Show this help message

Environment Variables:
  DB_HOST                Database host (default: localhost)
  DB_PORT                Database port (default: 5432)
  DB_NAME                Database name (default: payment_service)
  DB_USER                Database user (default: postgres)
  DB_PASSWORD            Database password (default: password)
  CREATE_DATABASE        Set to 'false' to skip database creation
  RUN_MIGRATIONS         Set to 'false' to skip migrations
  MIGRATE_DATA           Set to 'false' to skip data migration
  OPTIMIZE_INDEXES       Set to 'false' to skip index optimization
  RUN_TESTS              Set to 'false' to skip tests
  DRY_RUN                Set to 'true' for dry-run mode
  LOG_LEVEL              Log level (error|warn|info|debug)
      `);
      process.exit(0);
    }
  }
  
  try {
    const results = await runCompleteSetup();
    
    console.log('\n=== COMPLETE SETUP SUMMARY ===');
    console.log(`Total Steps: ${results.summary.totalSteps}`);
    console.log(`Completed: ${results.summary.completedSteps}`);
    console.log(`Failed: ${results.summary.failedSteps}`);
    console.log(`Warnings: ${results.summary.warnings}`);
    console.log(`Report saved to: setup-report.json`);
    
    if (results.summary.failedSteps > 0) {
      console.log('\n=== FAILED STEPS ===');
      Object.entries(results.steps)
        .filter(([name, result]) => !result.success)
        .forEach(([name, result]) => console.log(`- ${name}: ${result.message}`));
    }
    
    process.exit(results.summary.failedSteps > 0 ? 1 : 0);
  } catch (error) {
    log('error', 'Complete setup failed', { error: error.message });
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { runCompleteSetup, config };
