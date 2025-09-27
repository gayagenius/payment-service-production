/**
 * Redis Client with Connection Pooling and Resilience
 * Provides caching layer for high-performance data access
 */

import Redis from 'ioredis';
import { circuitBreakers } from '../utils/circuitBreaker.js';

class RedisClient {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.connectionAttempts = 0;
        this.maxRetries = 5;
        this.retryDelay = 1000;
        
        this.config = {
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD || null,
            db: process.env.REDIS_DB || 0,
            retryDelayOnFailover: 100,
            maxRetriesPerRequest: 3,
            lazyConnect: true,
            keepAlive: 30000,
            connectTimeout: 10000,
            commandTimeout: 5000
        };
    }

    async connect() {
        try {
            this.client = new Redis(this.config);
            
            this.client.on('connect', () => {
                console.log('Redis connected successfully');
                this.isConnected = true;
                this.connectionAttempts = 0;
            });
            
            this.client.on('error', (error) => {
                console.error('Redis connection error:', error);
                this.isConnected = false;
                this.handleConnectionError();
            });
            
            this.client.on('close', () => {
                console.log('Redis connection closed');
                this.isConnected = false;
            });
            
            this.client.on('reconnecting', () => {
                console.log('Redis reconnecting...');
            });
            
            await this.client.connect();
            return true;
            
        } catch (error) {
            console.error('Failed to connect to Redis:', error);
            this.isConnected = false;
            return false;
        }
    }

    async handleConnectionError() {
        this.connectionAttempts++;
        
        if (this.connectionAttempts < this.maxRetries) {
            console.log(`Retrying Redis connection (attempt ${this.connectionAttempts}/${this.maxRetries})`);
            setTimeout(() => {
                this.connect();
            }, this.retryDelay * this.connectionAttempts);
        } else {
            console.error('Max Redis connection attempts reached');
        }
    }

    async get(key) {
        if (!this.isConnected) {
            console.warn('Redis not connected, skipping cache get');
            return null;
        }
        
        try {
            const value = await this.client.get(key);
            return value ? JSON.parse(value) : null;
        } catch (error) {
            console.error('Redis get error:', error);
            return null;
        }
    }

    async set(key, value, ttlSeconds = 300) {
        if (!this.isConnected) {
            console.warn('Redis not connected, skipping cache set');
            return false;
        }
        
        try {
            const serializedValue = JSON.stringify(value);
            await this.client.setex(key, ttlSeconds, serializedValue);
            return true;
        } catch (error) {
            console.error('Redis set error:', error);
            return false;
        }
    }

    async del(key) {
        if (!this.isConnected) {
            return false;
        }
        
        try {
            await this.client.del(key);
            return true;
        } catch (error) {
            console.error('Redis delete error:', error);
            return false;
        }
    }

    async exists(key) {
        if (!this.isConnected) {
            return false;
        }
        
        try {
            const result = await this.client.exists(key);
            return result === 1;
        } catch (error) {
            console.error('Redis exists error:', error);
            return false;
        }
    }

    async mget(keys) {
        if (!this.isConnected) {
            return [];
        }
        
        try {
            const values = await this.client.mget(keys);
            return values.map(value => value ? JSON.parse(value) : null);
        } catch (error) {
            console.error('Redis mget error:', error);
            return [];
        }
    }

    async mset(keyValuePairs, ttlSeconds = 300) {
        if (!this.isConnected) {
            return false;
        }
        
        try {
            const pipeline = this.client.pipeline();
            
            Object.entries(keyValuePairs).forEach(([key, value]) => {
                pipeline.setex(key, ttlSeconds, JSON.stringify(value));
            });
            
            await pipeline.exec();
            return true;
        } catch (error) {
            console.error('Redis mset error:', error);
            return false;
        }
    }

    async flushdb() {
        if (!this.isConnected) {
            return false;
        }
        
        try {
            await this.client.flushdb();
            return true;
        } catch (error) {
            console.error('Redis flushdb error:', error);
            return false;
        }
    }

    async ping() {
        if (!this.isConnected) {
            return false;
        }
        
        try {
            const result = await this.client.ping();
            return result === 'PONG';
        } catch (error) {
            console.error('Redis ping error:', error);
            return false;
        }
    }

    getConnectionStatus() {
        return {
            connected: this.isConnected,
            attempts: this.connectionAttempts,
            config: {
                host: this.config.host,
                port: this.config.port,
                db: this.config.db
            }
        };
    }

    async disconnect() {
        if (this.client) {
            await this.client.disconnect();
            this.isConnected = false;
        }
    }
}

// Global Redis client instance
export const redisClient = new RedisClient();

// Cache utility functions
export const cache = {
    // Payment caching
    async getPayment(paymentId) {
        return await redisClient.get(`payment:${paymentId}`);
    },
    
    async setPayment(paymentId, paymentData, ttl = 300) {
        return await redisClient.set(`payment:${paymentId}`, paymentData, ttl);
    },
    
    async deletePayment(paymentId) {
        return await redisClient.del(`payment:${paymentId}`);
    },
    
    // User payments caching
    async getUserPayments(userId, limit, offset) {
        const key = `user_payments:${userId}:${limit}:${offset}`;
        return await redisClient.get(key);
    },
    
    async setUserPayments(userId, limit, offset, payments, ttl = 60) {
        const key = `user_payments:${userId}:${limit}:${offset}`;
        return await redisClient.set(key, payments, ttl);
    },
    
    // Payment list caching
    async getPaymentList(limit, offset) {
        const key = `payment_list:${limit}:${offset}`;
        return await redisClient.get(key);
    },
    
    async setPaymentList(limit, offset, payments, ttl = 30) {
        const key = `payment_list:${limit}:${offset}`;
        return await redisClient.set(key, payments, ttl);
    },
    
    // Payment history caching
    async getPaymentHistory(limit, offset) {
        const key = `payment_history:${limit}:${offset}`;
        return await redisClient.get(key);
    },
    
    async setPaymentHistory(limit, offset, history, ttl = 60) {
        const key = `payment_history:${limit}:${offset}`;
        return await redisClient.set(key, history, ttl);
    },
    
    // Session caching
    async getSession(sessionId) {
        return await redisClient.get(`session:${sessionId}`);
    },
    
    async setSession(sessionId, sessionData, ttl = 3600) {
        return await redisClient.set(`session:${sessionId}`, sessionData, ttl);
    },
    
    async deleteSession(sessionId) {
        return await redisClient.del(`session:${sessionId}`);
    },
    
    // Rate limiting
    async getRateLimit(key) {
        return await redisClient.get(`rate_limit:${key}`);
    },
    
    async setRateLimit(key, count, ttl) {
        return await redisClient.set(`rate_limit:${key}`, count, ttl);
    },
    
    // Cache invalidation
    async invalidateUserCache(userId) {
        // Delete all user-related cache entries
        const patterns = [
            `user_payments:${userId}:*`,
            `payment:${userId}:*`
        ];
        
        for (const pattern of patterns) {
            try {
                const keys = await redisClient.client.keys(pattern);
                if (keys.length > 0) {
                    await redisClient.client.del(...keys);
                }
            } catch (error) {
                console.error(`Error invalidating cache pattern ${pattern}:`, error);
            }
        }
    }
};

// Initialize Redis connection
export const initializeRedis = async () => {
    const connected = await redisClient.connect();
    if (connected) {
        console.log('Redis cache layer initialized successfully');
    } else {
        console.warn('Redis cache layer initialization failed - running without cache');
    }
    return connected;
};

export default redisClient;
