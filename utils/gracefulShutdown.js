/**
 * Graceful Shutdown and Startup Management
 * Handles clean shutdown of all system components
 */

import { EventEmitter } from 'events';
import dbPoolManager from '../db/connectionPool.js';
import { redisClient } from '../cache/redisClient.js';
import { healthMonitor } from '../monitoring/healthMonitor.js';
import { logger, LOG_CATEGORIES } from './logger.js';
import { publish } from '../messaging/queueSetup.js';

class GracefulManager extends EventEmitter {
    constructor() {
        super();
        this.isShuttingDown = false;
        this.shutdownTimeout = parseInt(process.env.SHUTDOWN_TIMEOUT) || 30000; // 30 seconds
        this.startupTimeout = parseInt(process.env.STARTUP_TIMEOUT) || 60000; // 60 seconds
        this.components = new Map();
        this.startupOrder = [];
        this.shutdownOrder = [];
        
        this.setupSignalHandlers();
        this.registerComponents();
    }

    setupSignalHandlers() {
        // Handle graceful shutdown signals
        process.on('SIGTERM', () => this.gracefulShutdown('SIGTERM'));
        process.on('SIGINT', () => this.gracefulShutdown('SIGINT'));
        process.on('SIGHUP', () => this.gracefulShutdown('SIGHUP'));
        
        // Handle uncaught exceptions
        process.on('uncaughtException', (error) => {
            logger.error(LOG_CATEGORIES.SYSTEM, 'Uncaught exception', {
                error: error.message,
                stack: error.stack
            });
            this.gracefulShutdown('uncaughtException');
        });
        
        // Handle unhandled promise rejections
        process.on('unhandledRejection', (reason, promise) => {
            logger.error(LOG_CATEGORIES.SYSTEM, 'Unhandled promise rejection', {
                reason: reason?.message || reason,
                promise: promise.toString()
            });
            this.gracefulShutdown('unhandledRejection');
        });
    }

    registerComponents() {
        // Register components in startup order
        this.registerComponent('logger', {
            startup: () => Promise.resolve(),
            shutdown: () => logger.close()
        });
        
        this.registerComponent('database', {
            startup: () => this.startupDatabase(),
            shutdown: () => this.shutdownDatabase()
        });
        
        this.registerComponent('redis', {
            startup: () => this.startupRedis(),
            shutdown: () => this.shutdownRedis()
        });
        
        this.registerComponent('queue', {
            startup: () => this.startupQueue(),
            shutdown: () => this.shutdownQueue()
        });
        
        this.registerComponent('healthMonitor', {
            startup: () => this.startupHealthMonitor(),
            shutdown: () => this.shutdownHealthMonitor()
        });
        
        this.registerComponent('server', {
            startup: () => Promise.resolve(),
            shutdown: () => this.shutdownServer()
        });
    }

    registerComponent(name, handlers) {
        this.components.set(name, {
            name,
            startup: handlers.startup || (() => Promise.resolve()),
            shutdown: handlers.shutdown || (() => Promise.resolve()),
            started: false,
        });
        
        // Add to startup order (first registered = first started)
        if (!this.startupOrder.includes(name)) {
            this.startupOrder.push(name);
        }
        
        // Add to shutdown order (reverse of startup)
        this.shutdownOrder = [...this.startupOrder].reverse();
    }

    async startupDatabase() {
        try {
            logger.info(LOG_CATEGORIES.SYSTEM, 'Starting database connections...');
            
            // Initialize database pools
            await dbPoolManager.initialize();
            
            // Test connections
            await dbPoolManager.executeWrite('SELECT 1');
            await dbPoolManager.executeRead('SELECT 1');
            
            logger.info(LOG_CATEGORIES.SYSTEM, 'Database connections established');
            return true;
        } catch (error) {
            logger.error(LOG_CATEGORIES.SYSTEM, 'Database startup failed', {
                error: error.message
            });
            throw error;
        }
    }

    async shutdownDatabase() {
        try {
            logger.info(LOG_CATEGORIES.SYSTEM, 'Shutting down database connections...');
            
            // Close all database pools
            await dbPoolManager.close();
            
            logger.info(LOG_CATEGORIES.SYSTEM, 'Database connections closed');
            return true;
        } catch (error) {
            logger.error(LOG_CATEGORIES.SYSTEM, 'Database shutdown error', {
                error: error.message
            });
            throw error;
        }
    }

    async startupRedis() {
        try {
            logger.info(LOG_CATEGORIES.SYSTEM, 'Starting Redis connection...');
            
            const connected = await redisClient.connect();
            if (!connected) {
                logger.warn(LOG_CATEGORIES.SYSTEM, 'Redis connection failed - continuing without cache');
                return true; // Non-critical component
            }
            
            logger.info(LOG_CATEGORIES.SYSTEM, 'Redis connection established');
            return true;
        } catch (error) {
            logger.warn(LOG_CATEGORIES.SYSTEM, 'Redis startup failed - continuing without cache', {
                error: error.message
            });
            return true; // Non-critical component
        }
    }

    async shutdownRedis() {
        try {
            logger.info(LOG_CATEGORIES.SYSTEM, 'Shutting down Redis connection...');
            
            await redisClient.disconnect();
            
            logger.info(LOG_CATEGORIES.SYSTEM, 'Redis connection closed');
            return true;
        } catch (error) {
            logger.error(LOG_CATEGORIES.SYSTEM, 'Redis shutdown error', {
                error: error.message
            });
            throw error;
        }
    }

    async startupQueue() {
        try {
            logger.info(LOG_CATEGORIES.SYSTEM, 'Starting message queue...');
            
            // Initialize RabbitMQ connection
            await publish('system_startup', {
                message: 'Payment service starting up',
                timestamp: new Date().toISOString()
            });
            
            logger.info(LOG_CATEGORIES.SYSTEM, 'Message queue started');
            return true;
        } catch (error) {
            logger.warn(LOG_CATEGORIES.SYSTEM, 'Queue startup failed - continuing without messaging', {
                error: error.message
            });
            return true; // Non-critical component
        }
    }

    async shutdownQueue() {
        try {
            logger.info(LOG_CATEGORIES.SYSTEM, 'Shutting down message queue...');
            
            // Publish shutdown event
            await publish('system_shutdown', {
                message: 'Payment service shutting down',
                timestamp: new Date().toISOString()
            });
            
            logger.info(LOG_CATEGORIES.SYSTEM, 'Message queue shut down');
            return true;
        } catch (error) {
            logger.error(LOG_CATEGORIES.SYSTEM, 'Queue shutdown error', {
                error: error.message
            });
            throw error;
        }
    }

    async startupHealthMonitor() {
        try {
            logger.info(LOG_CATEGORIES.SYSTEM, 'Starting health monitoring...');
            
            await healthMonitor.startMonitoring();
            
            logger.info(LOG_CATEGORIES.SYSTEM, 'Health monitoring started');
            return true;
        } catch (error) {
            logger.warn(LOG_CATEGORIES.SYSTEM, 'Health monitor startup failed', {
                error: error.message
            });
            return true; // Non-critical component
        }
    }

    async shutdownHealthMonitor() {
        try {
            logger.info(LOG_CATEGORIES.SYSTEM, 'Shutting down health monitoring...');
            
            healthMonitor.stopMonitoring();
            
            logger.info(LOG_CATEGORIES.SYSTEM, 'Health monitoring stopped');
            return true;
        } catch (error) {
            logger.error(LOG_CATEGORIES.SYSTEM, 'Health monitor shutdown error', {
                error: error.message
            });
            throw error;
        }
    }

    async shutdownServer() {
        try {
            logger.info(LOG_CATEGORIES.SYSTEM, 'Shutting down HTTP server...');
            
            // Close HTTP server if it exists
            if (global.httpServer) {
                await new Promise((resolve) => {
                    global.httpServer.close(resolve);
                });
            }
            
            logger.info(LOG_CATEGORIES.SYSTEM, 'HTTP server closed');
            return true;
        } catch (error) {
            logger.error(LOG_CATEGORIES.SYSTEM, 'Server shutdown error', {
                error: error.message
            });
            throw error;
        }
    }

    async startup() {
        logger.info(LOG_CATEGORIES.SYSTEM, 'Starting payment service...');
        const startTime = Date.now();
        
        try {
            // Start components in order
            for (const componentName of this.startupOrder) {
                const component = this.components.get(componentName);
                if (!component) continue;
                
                logger.info(LOG_CATEGORIES.SYSTEM, `Starting ${componentName}...`);
                
                const componentStartTime = Date.now();
                await Promise.race([
                    component.startup(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error(`Startup timeout for ${componentName}`)), this.startupTimeout)
                    )
                ]);
                
                const componentDuration = Date.now() - componentStartTime;
                component.started = true;
                
                logger.info(LOG_CATEGORIES.SYSTEM, `${componentName} started successfully`, {
                    duration: `${componentDuration}ms`
                });
            }
            
            const totalDuration = Date.now() - startTime;
            logger.info(LOG_CATEGORIES.SYSTEM, 'Payment service started successfully', {
                duration: `${totalDuration}ms`,
                components: this.startupOrder.length
            });
            
            this.emit('started');
            return true;
            
        } catch (error) {
            const totalDuration = Date.now() - startTime;
            logger.error(LOG_CATEGORIES.SYSTEM, 'Payment service startup failed', {
                error: error.message,
                duration: `${totalDuration}ms`
            });
            
            // Attempt to shutdown started components
            await this.emergencyShutdown();
            throw error;
        }
    }

    async gracefulShutdown(signal) {
        if (this.isShuttingDown) {
            logger.warn(LOG_CATEGORIES.SYSTEM, 'Shutdown already in progress');
            return;
        }
        
        this.isShuttingDown = true;
        logger.info(LOG_CATEGORIES.SYSTEM, 'Initiating graceful shutdown', { signal });
        
        const startTime = Date.now();
        
        try {
            // Shutdown components in reverse order
            for (const componentName of this.shutdownOrder) {
                const component = this.components.get(componentName);
                if (!component || !component.started) continue;
                
                logger.info(LOG_CATEGORIES.SYSTEM, `Shutting down ${componentName}...`);
                
                const componentStartTime = Date.now();
                await Promise.race([
                    component.shutdown(),
                    new Promise((_, reject) => 
                        setTimeout(() => reject(new Error(`Shutdown timeout for ${componentName}`)), this.shutdownTimeout)
                    )
                ]);
                
                const componentDuration = Date.now() - componentStartTime;
                component.shutdown = true;
                
                logger.info(LOG_CATEGORIES.SYSTEM, `${componentName} shut down successfully`, {
                    duration: `${componentDuration}ms`
                });
            }
            
            const totalDuration = Date.now() - startTime;
            logger.info(LOG_CATEGORIES.SYSTEM, 'Graceful shutdown completed', {
                duration: `${totalDuration}ms`,
                signal
            });
            
            this.emit('shutdown');
            process.exit(0);
            
        } catch (error) {
            const totalDuration = Date.now() - startTime;
            logger.error(LOG_CATEGORIES.SYSTEM, 'Graceful shutdown failed', {
                error: error.message,
                duration: `${totalDuration}ms`,
                signal
            });
            
            // Force exit after timeout
            setTimeout(() => {
                logger.error(LOG_CATEGORIES.SYSTEM, 'Forcing process exit');
                process.exit(1);
            }, 5000);
        }
    }

    async emergencyShutdown() {
        logger.error(LOG_CATEGORIES.SYSTEM, 'Initiating emergency shutdown');
        
        try {
            // Shutdown only critical components
            const criticalComponents = ['database', 'server'];
            
            for (const componentName of criticalComponents) {
                const component = this.components.get(componentName);
                if (!component || !component.started) continue;
                
                try {
                    await component.shutdown();
                    component.shutdown = true;
                } catch (error) {
                    logger.error(LOG_CATEGORIES.SYSTEM, `Emergency shutdown failed for ${componentName}`, {
                        error: error.message
                    });
                }
            }
        } catch (error) {
            logger.error(LOG_CATEGORIES.SYSTEM, 'Emergency shutdown failed', {
                error: error.message
            });
        }
    }

    getStatus() {
        const status = {
            isShuttingDown: this.isShuttingDown,
            components: {},
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        };
        
        for (const [name, component] of this.components.entries()) {
            status.components[name] = {
                started: component.started,
                shutdown: component.shutdown
            };
        }
        
        return status;
    }
}

// Global graceful manager instance
export const gracefulManager = new GracefulManager();

// Utility function to register HTTP server
export const registerHttpServer = (server) => {
    global.httpServer = server;
    gracefulManager.registerComponent('httpServer', {
        startup: () => Promise.resolve(),
        shutdown: () => new Promise((resolve) => {
            server.close(resolve);
        })
    });
};

export default gracefulManager;
