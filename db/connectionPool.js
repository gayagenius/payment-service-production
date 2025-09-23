/**
 * Database Connection Pool Manager
 * Provides separate read and write connection pools with health monitoring and automatic failover.
 */

import pg from 'pg';
import { EventEmitter } from 'events';
import { DB_CONFIG } from '../config/constants.js';

const config = process.env.DATABASE_URL ? {
  write: {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: parseInt(process.env.DB_WRITE_POOL_MAX) || DB_CONFIG.WRITE_POOL.MAX,
    min: parseInt(process.env.DB_WRITE_POOL_MIN) || DB_CONFIG.WRITE_POOL.MIN,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || DB_CONFIG.WRITE_POOL.IDLE_TIMEOUT,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || DB_CONFIG.WRITE_POOL.CONNECTION_TIMEOUT,
    acquireTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || DB_CONFIG.WRITE_POOL.ACQUIRE_TIMEOUT,
  },
  read: {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: parseInt(process.env.DB_READ_POOL_MAX) || DB_CONFIG.READ_POOL.MAX,
    min: parseInt(process.env.DB_READ_POOL_MIN) || DB_CONFIG.READ_POOL.MIN,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || DB_CONFIG.READ_POOL.IDLE_TIMEOUT,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || DB_CONFIG.READ_POOL.CONNECTION_TIMEOUT,
    acquireTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || DB_CONFIG.READ_POOL.ACQUIRE_TIMEOUT,
  }
} : {
  write: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'payment_service',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'password',
    max: parseInt(process.env.DB_WRITE_POOL_MAX) || DB_CONFIG.WRITE_POOL.MAX,
    min: parseInt(process.env.DB_WRITE_POOL_MIN) || DB_CONFIG.WRITE_POOL.MIN,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || DB_CONFIG.WRITE_POOL.IDLE_TIMEOUT,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || DB_CONFIG.WRITE_POOL.CONNECTION_TIMEOUT,
    acquireTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || DB_CONFIG.WRITE_POOL.ACQUIRE_TIMEOUT,
  },
  
  read: {
    host: process.env.DB_READ_HOST || process.env.DB_HOST || 'localhost',
    port: process.env.DB_READ_PORT || process.env.DB_PORT || 5432,
    database: process.env.DB_READ_NAME || process.env.DB_NAME || 'payment_service',
    user: process.env.DB_READ_USER || process.env.DB_USER || 'postgres',
    password: process.env.DB_READ_PASSWORD || process.env.DB_PASSWORD || 'password',
    max: parseInt(process.env.DB_READ_POOL_MAX) || DB_CONFIG.READ_POOL.MAX,
    min: parseInt(process.env.DB_READ_POOL_MIN) || DB_CONFIG.READ_POOL.MIN,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || DB_CONFIG.READ_POOL.IDLE_TIMEOUT,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || DB_CONFIG.READ_POOL.CONNECTION_TIMEOUT,
    acquireTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || DB_CONFIG.READ_POOL.ACQUIRE_TIMEOUT,
  }
};

const healthCheckConfig = {
  interval: parseInt(process.env.DB_HEALTH_CHECK_INTERVAL) || DB_CONFIG.HEALTH_CHECK.INTERVAL,
  timeout: parseInt(process.env.DB_HEALTH_CHECK_TIMEOUT) || DB_CONFIG.HEALTH_CHECK.TIMEOUT,
  retries: parseInt(process.env.DB_HEALTH_CHECK_RETRIES) || DB_CONFIG.HEALTH_CHECK.RETRIES,
};

const consistencyConfig = {
  maxLagSeconds: parseInt(process.env.DB_MAX_LAG_SECONDS) || DB_CONFIG.CONSISTENCY.MAX_LAG_SECONDS,
  readAfterWriteDelay: parseInt(process.env.DB_READ_AFTER_WRITE_DELAY) || DB_CONFIG.CONSISTENCY.READ_AFTER_WRITE_DELAY,
};

/**
 * Database Connection Pool Manager Class
 */
class DatabasePoolManager extends EventEmitter {
  constructor() {
    super();
    
    this.writePool = null;
    this.readPool = null;
    this.healthCheckInterval = null;
    this.isHealthy = { write: false, read: false };
    this.lastWriteTime = null;
    this.writeLag = 0;
    
    // Initialize pools
    this.initializePools();
  }

  /**
   * Initialize read and write connection pools
   */
  initializePools() {
    try {
      this.writePool = new pg.Pool({
        ...config.write,
        application_name: DB_CONFIG.APP_NAMES.WRITE,
        ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : (process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false),
      });

      this.readPool = new pg.Pool({
        ...config.read,
        application_name: DB_CONFIG.APP_NAMES.READ,
        ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : (process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false),
      });

      this.writePool.on('error', (err) => {
        console.error('Write pool error:', err.message);
        this.isHealthy.write = false;
        this.emit('writePoolError', err);
      });

      this.readPool.on('error', (err) => {
        console.error('Read pool error:', err.message);
        this.isHealthy.read = false;
        this.emit('readPoolError', err);
      });

      this.startHealthMonitoring();

      console.log('Database connection pools initialized');
      if (process.env.DATABASE_URL) {
        console.log(`Write pool: ${process.env.DATABASE_URL.split('@')[1]}`);
        console.log(`Read pool: ${process.env.DATABASE_URL.split('@')[1]}`);
      } else {
        console.log(`Write pool: ${config.write.host}:${config.write.port}/${config.write.database}`);
        console.log(`Read pool: ${config.read.host}:${config.read.port}/${config.read.database}`);
      }

    } catch (error) {
      console.error('Failed to initialize database pools:', error.message);
      throw error;
    }
  }

  /**
   * Start health monitoring for both pools
   */
  startHealthMonitoring() {
    this.healthCheckInterval = setInterval(async () => {
      await this.performHealthCheck();
    }, healthCheckConfig.interval);

    this.performHealthCheck();
  }

  /**
   * Perform health check on both pools
   */
  async performHealthCheck() {
    await this.checkPoolHealth('write', this.writePool);
    await this.checkPoolHealth('read', this.readPool);
    
    if (this.isHealthy.write && this.isHealthy.read) {
      await this.checkReplicationLag();
    }
  }

  /**
   * Check health of a specific pool
   */
  async checkPoolHealth(poolType, pool) {
    try {
      const client = await pool.connect();
      const startTime = Date.now();
      const result = await client.query('SELECT NOW() as current_time, pg_is_in_recovery() as is_replica');
      const duration = Date.now() - startTime;
      
      client.release();
      
      this.isHealthy[poolType] = true;
      this.emit('poolHealthCheck', {
        poolType,
        healthy: true,
        duration,
        isReplica: result.rows[0].is_replica,
        currentTime: result.rows[0].current_time
      });
      
    } catch (error) {
      this.isHealthy[poolType] = false;
      this.emit('poolHealthCheck', {
        poolType,
        healthy: false,
        error: error.message
      });
    }
  }

  /**
   * Check replication lag between write and read pools
   */
  async checkReplicationLag() {
    try {
      const writeClient = await this.writePool.connect();
      const readClient = await this.readPool.connect();
      
      const writeResult = await writeClient.query('SELECT NOW() as current_time');
      const readResult = await readClient.query('SELECT NOW() as current_time');
      
      writeClient.release();
      readClient.release();
      
      const writeTime = new Date(writeResult.rows[0].current_time);
      const readTime = new Date(readResult.rows[0].current_time);
      this.writeLag = Math.abs(writeTime - readTime) / 1000;
      
      this.emit('replicationLagCheck', {
        lagSeconds: this.writeLag,
        withinThreshold: this.writeLag <= consistencyConfig.maxLagSeconds
      });
      
    } catch (error) {
      console.error('Replication lag check failed:', error.message);
    }
  }

  /**
   * Get a client from the write pool
   * @returns {Promise<pg.Client>} Write client
   */
  async getWriteClient() {
    // Try to connect even if health check failed
    try {
      const client = await this.writePool.connect();
      this.lastWriteTime = Date.now();
      this.isHealthy.write = true; // Mark as healthy on successful connection
      return client;
    } catch (error) {
      this.isHealthy.write = false;
      throw new Error(`Write pool connection failed: ${error.message}`);
    }
  }

  /**
   * Get a client from the read pool
   * @returns {Promise<pg.Client>} Read client
   */
  async getReadClient() {
    if (!this.isHealthy.read) {
      // Fallback to write pool if read pool is unhealthy
      console.warn('Read pool unhealthy, falling back to write pool');
      return this.getWriteClient();
    }
    
    return this.readPool.connect();
  }

  /**
   * Execute a write query (INSERT, UPDATE, DELETE)
   * @param {string} query - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<pg.QueryResult>} Query result
   */
  async executeWrite(query, params = []) {
    const client = await this.getWriteClient();
    try {
      const result = await client.query(query, params);
      this.lastWriteTime = Date.now();
      return result;
    } finally {
      client.release();
    }
  }

  /**
   * Execute a read query (SELECT)
   * @param {string} query - SQL query
   * @param {Array} params - Query parameters
   * @param {Object} options - Query options
   * @param {boolean} options.forceWrite - Force use of write pool
   * @param {boolean} options.allowStale - Allow stale reads
   * @returns {Promise<pg.QueryResult>} Query result
   */
  async executeRead(query, params = [], options = {}) {
    const { forceWrite = false, allowStale = true } = options;
    
    // Force write pool if requested
    if (forceWrite) {
      return this.executeWrite(query, params);
    }
    
    // Check if we need to wait for write consistency
    if (!allowStale && this.lastWriteTime) {
      const timeSinceWrite = Date.now() - this.lastWriteTime;
      if (timeSinceWrite < consistencyConfig.readAfterWriteDelay) {
        // Use write pool for consistency
        return this.executeWrite(query, params);
      }
    }
    
    // Use read pool
    const client = await this.getReadClient();
    try {
      return await client.query(query, params);
    } finally {
      client.release();
    }
  }

  /**
   * Execute a transaction on the write pool
   * @param {Function} callback - Transaction callback function
   * @returns {Promise<any>} Transaction result
   */
  async executeTransaction(callback) {
    const client = await this.getWriteClient();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      this.lastWriteTime = Date.now();
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Execute a read-only transaction
   * @param {Function} callback - Transaction callback function
   * @returns {Promise<any>} Transaction result
   */
  async executeReadOnlyTransaction(callback) {
    const client = await this.getReadClient();
    try {
      await client.query('SET TRANSACTION READ ONLY');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get pool statistics
   * @returns {Object} Pool statistics
   */
  getPoolStats() {
    return {
      write: {
        totalCount: this.writePool.totalCount,
        idleCount: this.writePool.idleCount,
        waitingCount: this.writePool.waitingCount,
        healthy: this.isHealthy.write
      },
      read: {
        totalCount: this.readPool.totalCount,
        idleCount: this.readPool.idleCount,
        waitingCount: this.readPool.waitingCount,
        healthy: this.isHealthy.read
      },
      replication: {
        lagSeconds: this.writeLag,
        lastWriteTime: this.lastWriteTime,
        withinThreshold: this.writeLag <= consistencyConfig.maxLagSeconds
      }
    };
  }

  /**
   * Get health status
   * @returns {Object} Health status
   */
  getHealthStatus() {
    return {
      write: this.isHealthy.write,
      read: this.isHealthy.read,
      overall: this.isHealthy.write && this.isHealthy.read,
      lagSeconds: this.writeLag,
      lastCheck: new Date().toISOString()
    };
  }

  /**
   * Close all connection pools
   */
  async close() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }
    
    if (this.writePool) {
      await this.writePool.end();
    }
    
    if (this.readPool) {
      await this.readPool.end();
    }
    
    console.log('Database connection pools closed');
  }
}

// Create singleton instance
const dbPoolManager = new DatabasePoolManager();

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('Shutting down database pools...');
  await dbPoolManager.close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('Shutting down database pools...');
  await dbPoolManager.close();
  process.exit(0);
});

export default dbPoolManager;

