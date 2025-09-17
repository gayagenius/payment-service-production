#!/usr/bin/env node

/**
 * Index Optimization Script
 * 
 * This script analyzes and optimizes database indexes for the payment service.
 * It collects query statistics, runs EXPLAIN ANALYZE, and provides recommendations.
 * 
 * Features:
 * - Query plan analysis
 * - Index usage statistics
 * - Performance recommendations
 * - Index creation/removal suggestions
 * - Production-safe execution
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
  
  // Analysis settings
  analyzeQueries: process.env.ANALYZE_QUERIES !== 'false',
  createIndexes: process.env.CREATE_INDEXES === 'true',
  dryRun: process.env.DRY_RUN === 'true',
  
  // Output settings
  outputFile: process.env.OUTPUT_FILE || 'index-optimization-report.json',
  logLevel: process.env.LOG_LEVEL || 'info'
};

// Top 5 production queries to analyze
const productionQueries = [
  {
    name: 'get_payments_by_user',
    query: `
      SELECT p.id, p.user_id, p.order_id, p.amount, p.currency, p.status, 
             p.payment_method_id, p.created_at, p.updated_at
      FROM payments_partitioned p
      WHERE p.user_id = $1
      ORDER BY p.created_at DESC
      LIMIT 50
    `,
    params: ['550e8400-e29b-41d4-a716-446655440000'],
    description: 'Get user payments with pagination'
  },
  {
    name: 'get_payment_by_id',
    query: `
      SELECT p.id, p.user_id, p.order_id, p.amount, p.currency, p.status,
             p.payment_method_id, p.gateway_response, p.idempotency_key,
             p.created_at, p.updated_at
      FROM payments_partitioned p
      WHERE p.id = $1
    `,
    params: ['550e8400-e29b-41d4-a716-446655440001'],
    description: 'Get payment by ID'
  },
  {
    name: 'get_payments_by_status',
    query: `
      SELECT p.id, p.user_id, p.order_id, p.amount, p.currency, p.status,
             p.created_at, p.updated_at
      FROM payments_partitioned p
      WHERE p.status = $1
      ORDER BY p.created_at DESC
      LIMIT 100
    `,
    params: ['SUCCEEDED'],
    description: 'Get payments by status'
  },
  {
    name: 'get_refunds_by_payment',
    query: `
      SELECT r.id, r.payment_id, r.amount, r.currency, r.status, r.reason,
             r.created_at, r.updated_at
      FROM refunds_partitioned r
      WHERE r.payment_id = $1
      ORDER BY r.created_at DESC
    `,
    params: ['550e8400-e29b-41d4-a716-446655440001'],
    description: 'Get refunds for a payment'
  },
  {
    name: 'get_payments_by_date_range',
    query: `
      SELECT p.id, p.user_id, p.order_id, p.amount, p.currency, p.status,
             p.created_at, p.updated_at
      FROM payments_partitioned p
      WHERE p.created_at BETWEEN $1 AND $2
      ORDER BY p.created_at DESC
      LIMIT 1000
    `,
    params: ['2024-01-01', '2024-12-31'],
    description: 'Get payments by date range'
  }
];

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
  }
}

// Database connection
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
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 2000,
    });
    
    // Test connection
    const client = await pool.connect();
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
 * Get current index statistics
 */
async function getIndexStatistics() {
  try {
    const client = await pool.connect();
    
    const query = `
      SELECT 
        schemaname,
        tablename,
        indexname,
        idx_scan as index_scans,
        idx_tup_read as tuples_read,
        idx_tup_fetch as tuples_fetched,
        pg_size_pretty(pg_relation_size(indexrelid)) as index_size,
        pg_relation_size(indexrelid) as index_size_bytes
      FROM pg_stat_user_indexes
      WHERE schemaname = 'public'
      AND tablename IN ('payments_partitioned', 'refunds_partitioned', 'payments_archive', 'refunds_archive')
      ORDER BY idx_scan DESC;
    `;
    
    const result = await client.query(query);
    client.release();
    
    log('info', 'Index statistics collected', { count: result.rows.length });
    return result.rows;
  } catch (error) {
    log('error', 'Failed to get index statistics', { error: error.message });
    throw error;
  }
}

/**
 * Get table statistics
 */
async function getTableStatistics() {
  try {
    const client = await pool.connect();
    
    const query = `
      SELECT 
        schemaname,
        tablename,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes,
        n_live_tup as live_tuples,
        n_dead_tup as dead_tuples,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as table_size,
        pg_total_relation_size(schemaname||'.'||tablename) as table_size_bytes
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      AND tablename IN ('payments_partitioned', 'refunds_partitioned', 'payments_archive', 'refunds_archive')
      ORDER BY n_live_tup DESC;
    `;
    
    const result = await client.query(query);
    client.release();
    
    log('info', 'Table statistics collected', { count: result.rows.length });
    return result.rows;
  } catch (error) {
    log('error', 'Failed to get table statistics', { error: error.message });
    throw error;
  }
}

/**
 * Analyze a single query
 */
async function analyzeQuery(queryInfo) {
  try {
    const client = await pool.connect();
    
    // Run EXPLAIN ANALYZE
    const explainQuery = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${queryInfo.query}`;
    const result = await client.query(explainQuery, queryInfo.params);
    
    client.release();
    
    const plan = result.rows[0]['QUERY PLAN'][0];
    
    return {
      name: queryInfo.name,
      description: queryInfo.description,
      query: queryInfo.query,
      params: queryInfo.params,
      executionTime: plan['Execution Time'],
      planningTime: plan['Planning Time'],
      totalTime: plan['Execution Time'] + plan['Planning Time'],
      plan: plan,
      recommendations: analyzeQueryPlan(plan)
    };
  } catch (error) {
    log('error', `Failed to analyze query ${queryInfo.name}`, { error: error.message });
    return {
      name: queryInfo.name,
      description: queryInfo.description,
      query: queryInfo.query,
      params: queryInfo.params,
      error: error.message,
      recommendations: []
    };
  }
}

/**
 * Analyze query plan and provide recommendations
 */
function analyzeQueryPlan(plan) {
  const recommendations = [];
  
  // Check for sequential scans
  if (plan['Plan'] && plan['Plan']['Node Type'] === 'Seq Scan') {
    recommendations.push({
      type: 'sequential_scan',
      severity: 'high',
      message: 'Query uses sequential scan - consider adding an index',
      table: plan['Plan']['Relation Name']
    });
  }
  
  // Check for expensive operations
  if (plan['Execution Time'] > 100) {
    recommendations.push({
      type: 'slow_query',
      severity: 'medium',
      message: `Query execution time is ${plan['Execution Time']}ms - consider optimization`
    });
  }
  
  // Check for high buffer usage
  if (plan['Plan'] && plan['Plan']['Shared Hit Blocks'] > 1000) {
    recommendations.push({
      type: 'high_buffer_usage',
      severity: 'medium',
      message: `Query uses ${plan['Plan']['Shared Hit Blocks']} buffer blocks - consider optimization`
    });
  }
  
  return recommendations;
}

/**
 * Get recommended indexes
 */
async function getRecommendedIndexes() {
  const recommendations = [];
  
  try {
    const client = await pool.connect();
    
    // Check for missing indexes on foreign keys
    const fkQuery = `
      SELECT 
        tc.table_name,
        kcu.column_name,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name
      FROM information_schema.table_constraints AS tc
      JOIN information_schema.key_column_usage AS kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage AS ccu
        ON ccu.constraint_name = tc.constraint_name
        AND ccu.table_schema = tc.table_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name IN ('payments_partitioned', 'refunds_partitioned');
    `;
    
    const fkResult = await client.query(fkQuery);
    
    for (const fk of fkResult.rows) {
      // Check if index exists
      const indexQuery = `
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = $1
        AND indexdef LIKE '%' || $2 || '%'
      `;
      
      const indexResult = await client.query(indexQuery, [fk.table_name, fk.column_name]);
      
      if (indexResult.rows.length === 0) {
        recommendations.push({
          type: 'missing_foreign_key_index',
          table: fk.table_name,
          column: fk.column_name,
          index: `CREATE INDEX idx_${fk.table_name}_${fk.column_name} ON ${fk.table_name}(${fk.column_name});`,
          priority: 'high'
        });
      }
    }
    
    // Check for missing indexes on frequently queried columns
    const commonIndexes = [
      {
        table: 'payments_partitioned',
        column: 'order_id',
        index: 'CREATE INDEX idx_payments_partitioned_order_id ON payments_partitioned(order_id);',
        priority: 'high'
      },
      {
        table: 'payments_partitioned',
        column: 'created_at',
        index: 'CREATE INDEX idx_payments_partitioned_created_at ON payments_partitioned(created_at DESC);',
        priority: 'medium'
      },
      {
        table: 'refunds_partitioned',
        column: 'status',
        index: 'CREATE INDEX idx_refunds_partitioned_status ON refunds_partitioned(status);',
        priority: 'medium'
      }
    ];
    
    for (const idx of commonIndexes) {
      const existsQuery = `
        SELECT indexname
        FROM pg_indexes
        WHERE tablename = $1
        AND indexdef LIKE '%' || $2 || '%'
      `;
      
      const existsResult = await client.query(existsQuery, [idx.table, idx.column]);
      
      if (existsResult.rows.length === 0) {
        recommendations.push({
          type: 'missing_common_index',
          table: idx.table,
          column: idx.column,
          index: idx.index,
          priority: idx.priority
        });
      }
    }
    
    client.release();
    
    log('info', 'Index recommendations collected', { count: recommendations.length });
    return recommendations;
  } catch (error) {
    log('error', 'Failed to get index recommendations', { error: error.message });
    throw error;
  }
}

/**
 * Create recommended indexes
 */
async function createRecommendedIndexes(recommendations) {
  if (config.dryRun) {
    log('info', 'Dry run mode - indexes would be created', { count: recommendations.length });
    return recommendations.map(r => ({ ...r, created: false, dryRun: true }));
  }
  
  const results = [];
  
  for (const rec of recommendations) {
    try {
      const client = await pool.connect();
      
      log('info', `Creating index: ${rec.index}`);
      await client.query(rec.index);
      
      client.release();
      
      results.push({
        ...rec,
        created: true,
        error: null
      });
      
    } catch (error) {
      log('error', `Failed to create index: ${rec.index}`, { error: error.message });
      
      results.push({
        ...rec,
        created: false,
        error: error.message
      });
    }
  }
  
  return results;
}

/**
 * Generate optimization report
 */
async function generateReport() {
  log('info', 'Starting index optimization analysis');
  
  try {
    // Initialize database
    if (!await initDatabase()) {
      throw new Error('Database initialization failed');
    }
    
    // Collect statistics
    const indexStats = await getIndexStatistics();
    const tableStats = await getTableStatistics();
    
    // Analyze queries
    let queryAnalysis = [];
    if (config.analyzeQueries) {
      log('info', 'Analyzing production queries');
      
      for (const query of productionQueries) {
        const analysis = await analyzeQuery(query);
        queryAnalysis.push(analysis);
      }
    }
    
    // Get recommendations
    const recommendations = await getRecommendedIndexes();
    
    // Create indexes if requested
    let indexCreationResults = [];
    if (config.createIndexes && recommendations.length > 0) {
      log('info', 'Creating recommended indexes');
      indexCreationResults = await createRecommendedIndexes(recommendations);
    }
    
    // Generate report
    const report = {
      timestamp: new Date().toISOString(),
      configuration: {
        analyzeQueries: config.analyzeQueries,
        createIndexes: config.createIndexes,
        dryRun: config.dryRun
      },
      statistics: {
        indexes: indexStats,
        tables: tableStats
      },
      queryAnalysis: queryAnalysis,
      recommendations: recommendations,
      indexCreation: indexCreationResults,
      summary: {
        totalIndexes: indexStats.length,
        totalTables: tableStats.length,
        queriesAnalyzed: queryAnalysis.length,
        recommendationsGenerated: recommendations.length,
        indexesCreated: indexCreationResults.filter(r => r.created).length,
        indexesFailed: indexCreationResults.filter(r => !r.created && r.error).length
      }
    };
    
    // Save report
    await fs.writeFile(config.outputFile, JSON.stringify(report, null, 2));
    
    log('info', 'Index optimization report generated', {
      file: config.outputFile,
      summary: report.summary
    });
    
    return report;
    
  } catch (error) {
    log('error', 'Index optimization analysis failed', { error: error.message });
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
    } else if (arg === '--create-indexes') {
      config.createIndexes = true;
    } else if (arg === '--no-analyze') {
      config.analyzeQueries = false;
    } else if (arg.startsWith('--output=')) {
      config.outputFile = arg.split('=')[1];
    } else if (arg.startsWith('--log-level=')) {
      config.logLevel = arg.split('=')[1];
    } else if (arg === '--help') {
      console.log(`
Usage: node optimize-indexes.js [options]

Options:
  --dry-run              Run in dry-run mode (no actual index creation)
  --create-indexes       Create recommended indexes
  --no-analyze           Skip query analysis
  --output=FILE          Output file for report (default: index-optimization-report.json)
  --log-level=LEVEL      Set log level (error|warn|info|debug)
  --help                 Show this help message

Environment Variables:
  DB_HOST                Database host (default: localhost)
  DB_PORT                Database port (default: 5432)
  DB_NAME                Database name (default: payment_service)
  DB_USER                Database user (default: postgres)
  DB_PASSWORD            Database password (default: password)
  ANALYZE_QUERIES        Set to 'false' to skip query analysis
  CREATE_INDEXES         Set to 'true' to create indexes
  DRY_RUN                Set to 'true' for dry-run mode
  OUTPUT_FILE            Output file path
  LOG_LEVEL              Log level (error|warn|info|debug)
      `);
      process.exit(0);
    }
  }
  
  try {
    const report = await generateReport();
    
    log('info', 'Index optimization completed successfully');
    console.log('\n=== INDEX OPTIMIZATION SUMMARY ===');
    console.log(`Total indexes: ${report.summary.totalIndexes}`);
    console.log(`Queries analyzed: ${report.summary.queriesAnalyzed}`);
    console.log(`Recommendations: ${report.summary.recommendationsGenerated}`);
    console.log(`Indexes created: ${report.summary.indexesCreated}`);
    console.log(`Indexes failed: ${report.summary.indexesFailed}`);
    console.log(`Report saved to: ${config.outputFile}`);
    
    process.exit(0);
  } catch (error) {
    log('error', 'Index optimization failed', { error: error.message });
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { generateReport, config };
