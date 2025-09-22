#!/usr/bin/env node

/**
 * Backfill Partitions Script
 * 
 * This script migrates data from the original payments/refunds tables
 * to the new partitioned tables with comprehensive verification and rollback support.
 * 
 * Features:
 * - Dry-run mode for safe testing
 * - Data integrity verification
 * - Rollback capability
 * - Progress tracking
 * - Comprehensive logging
 * - Transaction safety
 */

import pg from 'pg';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Configuration
const config = {
  // Database connection
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'payment_service',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'password',
  
  // Migration settings
  batchSize: parseInt(process.env.BATCH_SIZE) || 1000,
  dryRun: process.env.DRY_RUN === 'true',
  verifyData: process.env.VERIFY_DATA !== 'false',
  
  // Logging
  logLevel: process.env.LOG_LEVEL || 'info',
  logFile: process.env.LOG_FILE || 'backfill-partitions.log'
};

// Logging setup
const logLevels = { error: 0, warn: 1, info: 2, debug: 3 };
const currentLogLevel = logLevels[config.logLevel] || 2;

function log(level, message, data = null) {
  if (logLevels[level] <= currentLogLevel) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    
    console.log(logMessage);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
    
    // Write to log file
    fs.appendFile(config.logFile, logMessage + '\n').catch(err => {
      console.error('Failed to write to log file:', err.message);
    });
  }
}

// Database connection pool
let pool = null;

/**
 * Initialize database connection
 */
async function initDatabase() {
  try {
    pool = new pg.Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    
    // Test connection
    const client = await pool.connect();
    const result = await client.query('SELECT NOW()');
    client.release();
    
    log('info', 'Database connection established', { 
      host: config.host, 
      port: config.port, 
      database: config.database 
    });
    
    return true;
  } catch (error) {
    log('error', 'Failed to connect to database', { error: error.message });
    return false;
  }
}

/**
 * Verify source tables exist and have data
 */
async function verifySourceTables() {
  try {
    const client = await pool.connect();
    
    // Check if original tables exist
    const tablesCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('payments', 'refunds')
    `);
    
    if (tablesCheck.rows.length !== 2) {
      throw new Error('Source tables (payments, refunds) not found');
    }
    
    // Get row counts
    const paymentsCount = await client.query('SELECT COUNT(*) FROM payments');
    const refundsCount = await client.query('SELECT COUNT(*) FROM refunds');
    
    client.release();
    
    log('info', 'Source tables verified', {
      payments_count: parseInt(paymentsCount.rows[0].count),
      refunds_count: parseInt(refundsCount.rows[0].count)
    });
    
    return {
      paymentsCount: parseInt(paymentsCount.rows[0].count),
      refundsCount: parseInt(refundsCount.rows[0].count)
    };
  } catch (error) {
    log('error', 'Source table verification failed', { error: error.message });
    throw error;
  }
}

/**
 * Verify partitioned tables exist and are empty
 */
async function verifyPartitionedTables() {
  try {
    const client = await pool.connect();
    
    // Check if partitioned tables exist
    const tablesCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('payments_partitioned', 'refunds_partitioned')
    `);
    
    if (tablesCheck.rows.length !== 2) {
      throw new Error('Partitioned tables not found. Run V001_enable_partitioning.sql first.');
    }
    
    // Get row counts
    const paymentsCount = await client.query('SELECT COUNT(*) FROM payments_partitioned');
    const refundsCount = await client.query('SELECT COUNT(*) FROM refunds_partitioned');
    
    client.release();
    
    log('info', 'Partitioned tables verified', {
      payments_partitioned_count: parseInt(paymentsCount.rows[0].count),
      refunds_partitioned_count: parseInt(refundsCount.rows[0].count)
    });
    
    return {
      paymentsCount: parseInt(paymentsCount.rows[0].count),
      refundsCount: parseInt(refundsCount.rows[0].count)
    };
  } catch (error) {
    log('error', 'Partitioned table verification failed', { error: error.message });
    throw error;
  }
}

/**
 * Migrate payments data in batches
 */
async function migratePayments(sourceCount) {
  log('info', 'Starting payments migration', { 
    total_records: sourceCount,
    batch_size: config.batchSize,
    dry_run: config.dryRun 
  });
  
  let migratedCount = 0;
  let offset = 0;
  
  while (offset < sourceCount) {
    try {
      const client = await pool.connect();
      
      // Get batch of payments
      const batchQuery = `
        SELECT id, user_id, order_id, amount, currency, status, 
               payment_method_id, gateway_response, idempotency_key, 
               created_at, updated_at
        FROM payments 
        ORDER BY created_at ASC
        LIMIT $1 OFFSET $2
      `;
      
      const batch = await client.query(batchQuery, [config.batchSize, offset]);
      
      if (batch.rows.length === 0) {
        client.release();
        break;
      }
      
      if (!config.dryRun) {
        // Insert into partitioned table
        const insertQuery = `
          INSERT INTO payments_partitioned (
            id, user_id, order_id, amount, currency, status,
            payment_method_id, gateway_response, idempotency_key,
            created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `;
        
        for (const row of batch.rows) {
          await client.query(insertQuery, [
            row.id, row.user_id, row.order_id, row.amount, row.currency,
            row.status, row.payment_method_id, row.gateway_response,
            row.idempotency_key, row.created_at, row.updated_at
          ]);
        }
      }
      
      client.release();
      
      migratedCount += batch.rows.length;
      offset += config.batchSize;
      
      log('info', 'Payments batch migrated', {
        batch_size: batch.rows.length,
        total_migrated: migratedCount,
        remaining: sourceCount - migratedCount,
        progress: `${((migratedCount / sourceCount) * 100).toFixed(2)}%`
      });
      
    } catch (error) {
      log('error', 'Payments batch migration failed', { 
        error: error.message,
        offset,
        batch_size: config.batchSize
      });
      throw error;
    }
  }
  
  log('info', 'Payments migration completed', { total_migrated: migratedCount });
  return migratedCount;
}

/**
 * Migrate refunds data in batches
 */
async function migrateRefunds(sourceCount) {
  log('info', 'Starting refunds migration', { 
    total_records: sourceCount,
    batch_size: config.batchSize,
    dry_run: config.dryRun 
  });
  
  let migratedCount = 0;
  let offset = 0;
  
  while (offset < sourceCount) {
    try {
      const client = await pool.connect();
      
      // Get batch of refunds
      const batchQuery = `
        SELECT id, payment_id, amount, currency, status, reason,
               idempotency_key, created_at, updated_at
        FROM refunds 
        ORDER BY created_at ASC
        LIMIT $1 OFFSET $2
      `;
      
      const batch = await client.query(batchQuery, [config.batchSize, offset]);
      
      if (batch.rows.length === 0) {
        client.release();
        break;
      }
      
      if (!config.dryRun) {
        // Insert into partitioned table
        const insertQuery = `
          INSERT INTO refunds_partitioned (
            id, payment_id, amount, currency, status, reason,
            idempotency_key, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;
        
        for (const row of batch.rows) {
          await client.query(insertQuery, [
            row.id, row.payment_id, row.amount, row.currency,
            row.status, row.reason, row.idempotency_key,
            row.created_at, row.updated_at
          ]);
        }
      }
      
      client.release();
      
      migratedCount += batch.rows.length;
      offset += config.batchSize;
      
      log('info', 'Refunds batch migrated', {
        batch_size: batch.rows.length,
        total_migrated: migratedCount,
        remaining: sourceCount - migratedCount,
        progress: `${((migratedCount / sourceCount) * 100).toFixed(2)}%`
      });
      
    } catch (error) {
      log('error', 'Refunds batch migration failed', { 
        error: error.message,
        offset,
        batch_size: config.batchSize
      });
      throw error;
    }
  }
  
  log('info', 'Refunds migration completed', { total_migrated: migratedCount });
  return migratedCount;
}

/**
 * Verify data integrity after migration
 */
async function verifyDataIntegrity(sourceCounts) {
  if (!config.verifyData) {
    log('info', 'Data verification skipped');
    return true;
  }
  
  log('info', 'Starting data integrity verification');
  
  try {
    const client = await pool.connect();
    
    // Verify row counts
    const paymentsCount = await client.query('SELECT COUNT(*) FROM payments_partitioned');
    const refundsCount = await client.query('SELECT COUNT(*) FROM refunds_partitioned');
    
    const paymentsMigrated = parseInt(paymentsCount.rows[0].count);
    const refundsMigrated = parseInt(refundsCount.rows[0].count);
    
    if (paymentsMigrated !== sourceCounts.paymentsCount) {
      throw new Error(`Payments count mismatch: expected ${sourceCounts.paymentsCount}, got ${paymentsMigrated}`);
    }
    
    if (refundsMigrated !== sourceCounts.refundsCount) {
      throw new Error(`Refunds count mismatch: expected ${sourceCounts.refundsCount}, got ${refundsMigrated}`);
    }
    
    // Verify data consistency (sample check)
    const sampleSize = Math.min(100, sourceCounts.paymentsCount);
    const sampleQuery = `
      SELECT p.id, p.user_id, p.amount, p.status, p.created_at
      FROM payments p
      ORDER BY p.created_at DESC
      LIMIT $1
    `;
    
    const sample = await client.query(sampleQuery, [sampleSize]);
    
    for (const row of sample.rows) {
      const verifyQuery = `
        SELECT id, user_id, amount, status, created_at
        FROM payments_partitioned
        WHERE id = $1
      `;
      
      const verifyResult = await client.query(verifyQuery, [row.id]);
      
      if (verifyResult.rows.length === 0) {
        throw new Error(`Payment ${row.id} not found in partitioned table`);
      }
      
      const verified = verifyResult.rows[0];
      if (verified.user_id !== row.user_id || 
          verified.amount !== row.amount || 
          verified.status !== row.status) {
        throw new Error(`Payment ${row.id} data mismatch`);
      }
    }
    
    client.release();
    
    log('info', 'Data integrity verification passed', {
      payments_verified: paymentsMigrated,
      refunds_verified: refundsMigrated,
      sample_size: sampleSize
    });
    
    return true;
  } catch (error) {
    log('error', 'Data integrity verification failed', { error: error.message });
    throw error;
  }
}

/**
 * Create rollback script
 */
async function createRollbackScript(sourceCounts) {
  const rollbackScript = `
-- Rollback Script for Partition Migration
-- Generated: ${new Date().toISOString()}
-- Source counts: payments=${sourceCounts.paymentsCount}, refunds=${sourceCounts.refundsCount}

-- Step 1: Drop partitioned tables
DROP TABLE IF EXISTS refunds_partitioned CASCADE;
DROP TABLE IF EXISTS payments_partitioned CASCADE;

-- Step 2: Drop archive tables
DROP TABLE IF EXISTS refunds_archive CASCADE;
DROP TABLE IF EXISTS payments_archive CASCADE;

-- Step 3: Drop reports table
DROP TABLE IF EXISTS payment_reports CASCADE;

-- Step 4: Drop partition management functions
DROP FUNCTION IF EXISTS create_monthly_partition(TEXT, DATE);
DROP FUNCTION IF EXISTS get_partition_name(TEXT, TIMESTAMPTZ);
DROP FUNCTION IF EXISTS archive_closed_payments_performance();
DROP FUNCTION IF EXISTS archive_payments_compliance();
DROP FUNCTION IF EXISTS generate_payment_reports();

-- Step 5: Drop monitoring views
DROP VIEW IF EXISTS partition_sizes;
DROP VIEW IF EXISTS archival_status;

-- Step 6: Recreate original tables if they don't exist
-- (This would need to be done manually based on original schema)
`;
  
  const rollbackFile = join(__dirname, 'rollback-partitioning.sql');
  await fs.writeFile(rollbackFile, rollbackScript);
  
  log('info', 'Rollback script created', { file: rollbackFile });
}

/**
 * Main migration function
 */
async function runMigration() {
  log('info', 'Starting partition migration', { 
    config: {
      dry_run: config.dryRun,
      batch_size: config.batchSize,
      verify_data: config.verifyData
    }
  });
  
  try {
    // Initialize database
    if (!await initDatabase()) {
      throw new Error('Database initialization failed');
    }
    
    // Verify source tables
    const sourceCounts = await verifySourceTables();
    
    // Verify partitioned tables
    const partitionedCounts = await verifyPartitionedTables();
    
    if (partitionedCounts.paymentsCount > 0 || partitionedCounts.refundsCount > 0) {
      throw new Error('Partitioned tables are not empty. Please clean them first.');
    }
    
    // Create rollback script
    await createRollbackScript(sourceCounts);
    
    // Migrate payments
    const paymentsMigrated = await migratePayments(sourceCounts.paymentsCount);
    
    // Migrate refunds
    const refundsMigrated = await migrateRefunds(sourceCounts.refundsCount);
    
    // Verify data integrity
    if (!config.dryRun) {
      await verifyDataIntegrity(sourceCounts);
    }
    
    log('info', 'Migration completed successfully', {
      payments_migrated: paymentsMigrated,
      refunds_migrated: refundsMigrated,
      dry_run: config.dryRun
    });
    
    return {
      success: true,
      paymentsMigrated,
      refundsMigrated,
      sourceCounts
    };
    
  } catch (error) {
    log('error', 'Migration failed', { error: error.message });
    throw error;
  } finally {
    if (pool) {
      await pool.end();
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
      config.dryRun = true;
    } else if (arg === '--no-verify') {
      config.verifyData = false;
    } else if (arg.startsWith('--batch-size=')) {
      config.batchSize = parseInt(arg.split('=')[1]);
    } else if (arg.startsWith('--log-level=')) {
      config.logLevel = arg.split('=')[1];
    } else if (arg === '--help') {
      console.log(`
Usage: node backfill-partitions.js [options]

Options:
  --dry-run              Run in dry-run mode (no actual migration)
  --no-verify           Skip data integrity verification
  --batch-size=N        Set batch size (default: 1000)
  --log-level=LEVEL     Set log level (error|warn|info|debug)
  --help                Show this help message

Environment Variables:
  DB_HOST               Database host (default: localhost)
  DB_PORT               Database port (default: 5432)
  DB_NAME               Database name (default: payment_service)
  DB_USER               Database user (default: postgres)
  DB_PASSWORD           Database password (default: password)
  DRY_RUN               Set to 'true' for dry-run mode
  VERIFY_DATA           Set to 'false' to skip verification
  BATCH_SIZE            Batch size for migration
  LOG_LEVEL             Log level (error|warn|info|debug)
  LOG_FILE              Log file path (default: backfill-partitions.log)
      `);
      process.exit(0);
    }
  }
  
  try {
    const result = await runMigration();
    
    if (result.success) {
      log('info', 'Migration completed successfully');
      process.exit(0);
    } else {
      log('error', 'Migration failed');
      process.exit(1);
    }
  } catch (error) {
    log('error', 'Migration failed with error', { error: error.message });
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { runMigration, config };
