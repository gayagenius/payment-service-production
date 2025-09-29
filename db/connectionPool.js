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
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 30000, // Increased to 30 seconds
    acquireTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || 60000, // Increased to 60 seconds
    query_timeout: 30000, // Add query timeout
    statement_timeout: 30000, // Add statement timeout
  },
  read: {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: parseInt(process.env.DB_READ_POOL_MAX) || DB_CONFIG.READ_POOL.MAX,
    min: parseInt(process.env.DB_READ_POOL_MIN) || DB_CONFIG.READ_POOL.MIN,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || DB_CONFIG.READ_POOL.IDLE_TIMEOUT,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || 30000, // Increased to 30 seconds
    acquireTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || 60000, // Increased to 60 seconds
    query_timeout: 30000, // Add query timeout
    statement_timeout: 30000, // Add statement timeout
  }
} : {
  write: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    max: parseInt(process.env.DB_WRITE_POOL_MAX) || DB_CONFIG.WRITE_POOL.MAX,
    min: parseInt(process.env.DB_WRITE_POOL_MIN) || DB_CONFIG.WRITE_POOL.MIN,
    idleTimeoutMillis: parseInt(process.env.DB_IDLE_TIMEOUT) || DB_CONFIG.WRITE_POOL.IDLE_TIMEOUT,
    connectionTimeoutMillis: parseInt(process.env.DB_CONNECTION_TIMEOUT) || DB_CONFIG.WRITE_POOL.CONNECTION_TIMEOUT,
    acquireTimeoutMillis: parseInt(process.env.DB_ACQUIRE_TIMEOUT) || DB_CONFIG.WRITE_POOL.ACQUIRE_TIMEOUT,
  },
  
  read: {
    host: process.env.DB_READ_HOST || process.env.DB_HOST,
    port: process.env.DB_READ_PORT || process.env.DB_PORT,
    database: process.env.DB_READ_NAME || process.env.DB_NAME,
    user: process.env.DB_READ_USER || process.env.DB_USER,
    password: process.env.DB_READ_PASSWORD || process.env.DB_PASSWORD,
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
    this.tempReadPool = null; // Temporary read pool for fallback
    this.healthCheckInterval = null;
    this.isHealthy = { write: false, read: false };
    this.lastWriteTime = null;
    this.writeLag = 0;
    
    // Initialize pools
    this.initializePools();
  }

  /**
   * Initialize read pool separately
   */
  async initializeReadPool() {
    try {
      if (this.readPool) {
        await this.readPool.end();
      }
      
      this.readPool = new pg.Pool({
        ...config.read,
        application_name: DB_CONFIG.APP_NAMES.READ,
        ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : (process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false),
      });

      this.readPool.on('error', (err) => {
        console.error('Read pool error:', err.message);
        this.isHealthy.read = false;
        this.emit('readPoolError', err);
        // Don't let pool errors crash the application
      });

      // Add connection-level error handling
      this.readPool.on('connect', (client) => {
        client.on('error', (err) => {
          console.error('Read client error:', err.message);
          // Don't let client errors crash the application
        });
      });

      this.isHealthy.read = true;
      console.log('Read pool reinitialized successfully');
    } catch (error) {
      console.error('Failed to reinitialize read pool:', error.message);
      this.isHealthy.read = false;
      throw error;
    }
  }

  /**
   * Create a temporary read pool for fallback scenarios
   */
  async createTemporaryReadPool() {
    try {
      // Clean up existing temp pool if any
      if (this.tempReadPool) {
        await this.tempReadPool.end();
      }
      
      // Create a smaller temporary read pool
      const tempConfig = {
        ...config.read,
        max: Math.min(10, config.read.max), // Smaller pool for temporary use
        min: Math.min(2, config.read.min),
        application_name: `${DB_CONFIG.APP_NAMES.READ}_temp`,
        ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : (process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false),
      };
      
      this.tempReadPool = new pg.Pool(tempConfig);

      this.tempReadPool.on('error', (err) => {
        console.error('Temporary read pool error:', err.message);
        this.emit('tempReadPoolError', err);
        // Don't let temp pool errors crash the application
      });

      // Add connection-level error handling for temp pool
      this.tempReadPool.on('connect', (client) => {
        client.on('error', (err) => {
          console.error('Temp read client error:', err.message);
          // Don't let client errors crash the application
        });
      });

      console.log('Temporary read pool created successfully');
    } catch (error) {
      console.error('Failed to create temporary read pool:', error.message);
      throw error;
    }
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
        // Don't let pool errors crash the application
      });

      this.readPool.on('error', (err) => {
        console.error('Read pool error:', err.message);
        this.isHealthy.read = false;
        this.emit('readPoolError', err);
        // Don't let pool errors crash the application
      });

      // Add connection-level error handling
      this.writePool.on('connect', (client) => {
        client.on('error', (err) => {
          console.error('Write client error:', err.message);
          // Don't let client errors crash the application
        });
      });

      this.readPool.on('connect', (client) => {
        client.on('error', (err) => {
          console.error('Read client error:', err.message);
          // Don't let client errors crash the application
        });
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
      // Try to reconnect read pool first
      console.warn('Read pool unhealthy, attempting to reconnect...');
      try {
        await this.initializeReadPool();
        if (this.isHealthy.read) {
          console.log('Read pool reconnected successfully');
          return this.readPool.connect();
        }
      } catch (reconnectError) {
        console.error('Failed to reconnect read pool:', reconnectError.message);
      }
      
      // Try to create a temporary read pool as fallback
      console.warn('Read pool unavailable, creating temporary read pool...');
      try {
        await this.createTemporaryReadPool();
        return this.tempReadPool.connect();
      } catch (tempPoolError) {
        console.error('Failed to create temporary read pool:', tempPoolError.message);
        // Only fallback to write pool as absolute last resort
        console.warn('All read options failed, falling back to write pool');
        return this.getWriteClient();
      }
    }
    
    try {
      return await this.readPool.connect();
    } catch (error) {
      console.error('Read pool connection failed:', error.message);
      this.isHealthy.read = false;
      
      // Try to create temporary read pool before falling back to write pool
      try {
        console.warn('Creating temporary read pool after connection failure...');
        await this.createTemporaryReadPool();
        return this.tempReadPool.connect();
      } catch (tempPoolError) {
        console.error('Failed to create temporary read pool:', tempPoolError.message);
        // Fallback to write pool only as last resort
        console.warn('All read options failed, falling back to write pool');
        return this.getWriteClient();
      }
    }
  }

  /**
   * Execute a write query (INSERT, UPDATE, DELETE)
   * @param {string} query - SQL query
   * @param {Array} params - Query parameters
   * @returns {Promise<pg.QueryResult>} Query result
   */
  async executeWrite(query, params = []) {
    let client;
    try {
      client = await this.getWriteClient();
      
      // Add timeout wrapper for query execution
      const queryPromise = client.query(query, params);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Query timeout')), 30000); // 30 second timeout
      });
      
      const result = await Promise.race([queryPromise, timeoutPromise]);
      this.lastWriteTime = Date.now();
      return result;
    } catch (error) {
      console.error('Database write error:', error.message);
      
      // Handle specific timeout errors
      if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
        console.warn('Database write timeout - connection may be slow');
        this.isHealthy.write = false; // Mark write pool as unhealthy
      }
      
      throw new Error(`Database write failed: ${error.message}`);
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          console.warn('Error releasing database client:', releaseError.message);
        }
      }
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
    let client;
    try {
      client = await this.getReadClient();
      
      // Add timeout wrapper for query execution
      const queryPromise = client.query(query, params);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Query timeout')), 30000); // 30 second timeout
      });
      
      const result = await Promise.race([queryPromise, timeoutPromise]);
      
      // Log if we're using write pool for reads (fallback scenario)
      if (client.pool === this.writePool) {
        console.warn('⚠️ Using write pool for read operation - this may impact performance');
      } else if (client.pool === this.tempReadPool) {
        console.warn('⚠️ Using temporary read pool - read pool recovery in progress');
      }
      
      return result;
    } catch (error) {
      console.error('Database read error:', error.message);
      
      // Handle specific timeout errors
      if (error.code === 'ETIMEDOUT' || error.message.includes('timeout')) {
        console.warn('Database read timeout - connection may be slow');
        this.isHealthy.read = false; // Mark read pool as unhealthy
      }
      
      throw new Error(`Database read failed: ${error.message}`);
    } finally {
      if (client) {
        try {
          client.release();
        } catch (releaseError) {
          console.warn('Error releasing database client:', releaseError.message);
        }
      }
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
    
    if (this.tempReadPool) {
      await this.tempReadPool.end();
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

