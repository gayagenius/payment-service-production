/**
 * Comprehensive Health Monitoring System
 * Monitors all system components and provides health status
 */

import dbPoolManager from '../db/connectionPool.js';
import { redisClient } from '../cache/redisClient.js';
import { circuitBreakers } from '../utils/circuitBreaker.js';
import { getQueueStatus } from '../services/asyncPaymentProcessor.js';
import { publish } from '../messaging/queueSetup.js';

class HealthMonitor {
    constructor() {
        this.checks = new Map();
        this.lastCheckResults = new Map();
        this.checkInterval = 30000; // 30 seconds
        this.isMonitoring = false;
        this.startTime = Date.now();
        
        // Register health checks
        this.registerChecks();
    }

    registerChecks() {
        // Database health checks
        this.checks.set('database_write', {
            name: 'Database Write Pool',
            critical: true,
            check: this.checkDatabaseWrite.bind(this),
            timeout: 5000
        });
        
        this.checks.set('database_read', {
            name: 'Database Read Pool',
            critical: true,
            check: this.checkDatabaseRead.bind(this),
            timeout: 5000
        });
        
        // Redis health check
        this.checks.set('redis', {
            name: 'Redis Cache',
            critical: false,
            check: this.checkRedis.bind(this),
            timeout: 3000
        });
        
        // Circuit breaker health checks
        this.checks.set('circuit_breakers', {
            name: 'Circuit Breakers',
            critical: true,
            check: this.checkCircuitBreakers.bind(this),
            timeout: 2000
        });
        
        // Queue health check
        this.checks.set('payment_queue', {
            name: 'Payment Processing Queue',
            critical: false,
            check: this.checkPaymentQueue.bind(this),
            timeout: 3000
        });
        
        // External service health checks
        this.checks.set('paystack', {
            name: 'Paystack API',
            critical: true,
            check: this.checkPaystack.bind(this),
            timeout: 10000
        });
        
        // System resource checks
        this.checks.set('system_resources', {
            name: 'System Resources',
            critical: false,
            check: this.checkSystemResources.bind(this),
            timeout: 2000
        });
    }

    async checkDatabaseWrite() {
        try {
            const startTime = Date.now();
            const result = await dbPoolManager.executeWrite('SELECT 1 as health_check');
            const responseTime = Date.now() - startTime;
            
            const pool = dbPoolManager.writePool;
            const poolStats = {
                totalCount: pool.totalCount,
                idleCount: pool.idleCount,
                waitingCount: pool.waitingCount
            };
            
            return {
                status: 'healthy',
                responseTime,
                poolStats,
                details: 'Database write pool is healthy'
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                details: 'Database write pool is not responding'
            };
        }
    }

    async checkDatabaseRead() {
        try {
            const startTime = Date.now();
            const result = await dbPoolManager.executeRead('SELECT 1 as health_check');
            const responseTime = Date.now() - startTime;
            
            const pool = dbPoolManager.readPool;
            const poolStats = {
                totalCount: pool.totalCount,
                idleCount: pool.idleCount,
                waitingCount: pool.waitingCount
            };
            
            return {
                status: 'healthy',
                responseTime,
                poolStats,
                details: 'Database read pool is healthy'
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                details: 'Database read pool is not responding'
            };
        }
    }

    async checkRedis() {
        try {
            const startTime = Date.now();
            const isConnected = await redisClient.ping();
            const responseTime = Date.now() - startTime;
            
            if (isConnected) {
                const status = redisClient.getConnectionStatus();
                return {
                    status: 'healthy',
                    responseTime,
                    connectionStatus: status,
                    details: 'Redis cache is healthy'
                };
            } else {
                return {
                    status: 'unhealthy',
                    responseTime,
                    details: 'Redis cache is not responding'
                };
            }
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                details: 'Redis cache connection failed'
            };
        }
    }

    async checkCircuitBreakers() {
        try {
            const health = circuitBreakers.paystack.getState();
            const dbHealth = circuitBreakers.database.getState();
            const mqHealth = circuitBreakers.rabbitmq.getState();
            
            const allHealthy = health.state === 'CLOSED' && 
                             dbHealth.state === 'CLOSED' && 
                             mqHealth.state === 'CLOSED';
            
            return {
                status: allHealthy ? 'healthy' : 'degraded',
                circuitBreakers: {
                    paystack: health,
                    database: dbHealth,
                    rabbitmq: mqHealth
                },
                details: allHealthy ? 'All circuit breakers are closed' : 'Some circuit breakers are open'
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                details: 'Circuit breaker check failed'
            };
        }
    }

    async checkPaymentQueue() {
        try {
            const queueStatus = getQueueStatus();
            
            const isHealthy = queueStatus.queueSize < 1000 && !queueStatus.isProcessing;
            
            return {
                status: isHealthy ? 'healthy' : 'degraded',
                queueStatus,
                details: isHealthy ? 'Payment queue is healthy' : 'Payment queue is overloaded'
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                details: 'Payment queue check failed'
            };
        }
    }

    async checkPaystack() {
        try {
            // Simple health check by making a minimal API call
            const response = await fetch('https://api.paystack.co/transaction/totals', {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 10000
            });
            
            const responseTime = Date.now() - Date.now();
            
            if (response.ok) {
                return {
                    status: 'healthy',
                    responseTime,
                    details: 'Paystack API is responding'
                };
            } else {
                return {
                    status: 'degraded',
                    statusCode: response.status,
                    details: 'Paystack API returned non-200 status'
                };
            }
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                details: 'Paystack API is not responding'
            };
        }
    }

    async checkSystemResources() {
        try {
            const memUsage = process.memoryUsage();
            const cpuUsage = process.cpuUsage();
            
            // Calculate memory usage percentage (heap used vs heap total)
            const memoryUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
            const isMemoryHealthy = memoryUsagePercent < 90;
            
            return {
                status: isMemoryHealthy ? 'healthy' : 'degraded',
                resources: {
                    memory: {
                        used: memUsage.heapUsed,
                        total: memUsage.heapTotal,
                        percentage: memoryUsagePercent,
                        rss: memUsage.rss,
                        external: memUsage.external
                    },
                    cpu: {
                        user: cpuUsage.user,
                        system: cpuUsage.system
                    },
                    uptime: process.uptime(),
                    pid: process.pid
                },
                details: isMemoryHealthy ? 'System resources are healthy' : 'High memory usage detected'
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                details: 'System resource check failed'
            };
        }
    }

    async runAllChecks() {
        const results = new Map();
        const startTime = Date.now();
        
        // Run all checks in parallel
        const checkPromises = Array.from(this.checks.entries()).map(async ([key, check]) => {
            try {
                const timeoutPromise = new Promise((_, reject) => {
                    setTimeout(() => reject(new Error('Check timeout')), check.timeout);
                });
                
                const checkPromise = check.check();
                const result = await Promise.race([checkPromise, timeoutPromise]);
                
                results.set(key, {
                    ...result,
                    checkName: check.name,
                    critical: check.critical,
                    timestamp: new Date().toISOString()
                });
                
            } catch (error) {
                results.set(key, {
                    status: 'unhealthy',
                    error: error.message,
                    checkName: check.name,
                    critical: check.critical,
                    timestamp: new Date().toISOString()
                });
            }
        });
        
        await Promise.all(checkPromises);
        
        const totalTime = Date.now() - startTime;
        this.lastCheckResults = results;
        
        return {
            results: Object.fromEntries(results),
            totalCheckTime: totalTime,
            timestamp: new Date().toISOString()
        };
    }

    getOverallHealth() {
        if (this.lastCheckResults.size === 0) {
            return {
                status: 'unknown',
                message: 'No health checks have been run yet'
            };
        }
        
        const results = Array.from(this.lastCheckResults.values());
        const criticalChecks = results.filter(r => r.critical);
        const unhealthyCritical = criticalChecks.filter(r => r.status === 'unhealthy');
        const degradedChecks = results.filter(r => r.status === 'degraded');
        
        let overallStatus = 'healthy';
        let message = 'All systems are healthy';
        
        if (unhealthyCritical.length > 0) {
            overallStatus = 'unhealthy';
            message = `${unhealthyCritical.length} critical system(s) are unhealthy`;
        } else if (degradedChecks.length > 0) {
            overallStatus = 'degraded';
            message = `${degradedChecks.length} system(s) are degraded`;
        }
        
        return {
            status: overallStatus,
            message,
            summary: {
                total: results.length,
                healthy: results.filter(r => r.status === 'healthy').length,
                degraded: degradedChecks.length,
                unhealthy: results.filter(r => r.status === 'unhealthy').length,
                critical: criticalChecks.length,
                criticalUnhealthy: unhealthyCritical.length
            },
            uptime: Date.now() - this.startTime
        };
    }

    async startMonitoring() {
        if (this.isMonitoring) {
            console.log('Health monitoring is already running');
            return;
        }
        
        this.isMonitoring = true;
        console.log('Starting health monitoring...');
        
        const runChecks = async () => {
            try {
                const results = await this.runAllChecks();
                const overallHealth = this.getOverallHealth();
                
                console.log(`Health check completed: ${overallHealth.status} - ${overallHealth.message}`);
                
                // Publish health status event
                await publish('health_check_completed', {
                    overallHealth,
                    results: results.results,
                    timestamp: results.timestamp
                });
                
                // Alert if unhealthy
                if (overallHealth.status === 'unhealthy') {
                    console.error('CRITICAL: System health is unhealthy!');
                    // Here you would send alerts to your monitoring system
                }
                
            } catch (error) {
                console.error('Health check failed:', error);
            }
        };
        
        // Run initial check
        await runChecks();
        
        // Set up interval
        this.monitoringInterval = setInterval(runChecks, this.checkInterval);
    }

    stopMonitoring() {
        if (this.monitoringInterval) {
            clearInterval(this.monitoringInterval);
            this.monitoringInterval = null;
        }
        this.isMonitoring = false;
        console.log('Health monitoring stopped');
    }

    getHealthReport() {
        const overallHealth = this.getOverallHealth();
        const results = Object.fromEntries(this.lastCheckResults);
        
        return {
            overall: overallHealth,
            checks: results,
            timestamp: new Date().toISOString(),
            monitoring: {
                isRunning: this.isMonitoring,
                interval: this.checkInterval,
                uptime: Date.now() - this.startTime
            }
        };
    }
}

// Global health monitor instance
export const healthMonitor = new HealthMonitor();

// Health check endpoints
export const getHealthStatus = async (req, res) => {
    try {
        const report = healthMonitor.getHealthReport();
        const statusCode = report.overall.status === 'healthy' ? 200 : 
                          report.overall.status === 'degraded' ? 200 : 503;
        
        res.status(statusCode).json(report);
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

export const getDetailedHealthStatus = async (req, res) => {
    try {
        const results = await healthMonitor.runAllChecks();
        const overallHealth = healthMonitor.getOverallHealth();
        
        const statusCode = overallHealth.status === 'healthy' ? 200 : 
                          overallHealth.status === 'degraded' ? 200 : 503;
        
        res.status(statusCode).json({
            overall: overallHealth,
            checks: results.results,
            totalCheckTime: results.totalCheckTime,
            timestamp: results.timestamp
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

export const getReadinessStatus = async (req, res) => {
    try {
        const results = await healthMonitor.runAllChecks();
        const criticalChecks = Object.values(results.results).filter(r => r.critical);
        const unhealthyCritical = criticalChecks.filter(r => r.status === 'unhealthy');
        
        const isReady = unhealthyCritical.length === 0;
        const statusCode = isReady ? 200 : 503;
        
        res.status(statusCode).json({
            ready: isReady,
            criticalChecks: criticalChecks.length,
            unhealthyCritical: unhealthyCritical.length,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(503).json({
            ready: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
};

export const getLivenessStatus = async (req, res) => {
    // Simple liveness check - just return OK if the process is running
    res.status(200).json({
        alive: true,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
};

export default healthMonitor;
