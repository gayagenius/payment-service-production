import dotenv from "dotenv";
dotenv.config();

import amqp from "amqplib";
import { setTimeout } from "timers/promises";

const RABBITMQ_HOST = process.env.RABBITMQ_HOST || "localhost";
const RABBITMQ_USER = process.env.RABBITMQ_USER || "guest";
const RABBITMQ_PASS = process.env.RABBITMQ_PASS || "guest";
const RABBITMQ_VHOST = process.env.RABBITMQ_VHOST || "/";
const RABBITMQ_PORT = process.env.RABBITMQ_PORT || "5672";

// Payment event topics
const EXCHANGE_NAME = "payment_events";
const PAYMENT_TOPICS = {
    PAYMENT_INITIATED: "payment_initiated",
    PAYMENT_COMPLETED: "payment_completed",
    PAYMENT_FAILED: "payment_failed",
    REFUND_PROCESSED: "refund_processed",
    PAYSTACK_WEBHOOK_RECEIVED: "paystack.webhook.received",
    PAYSTACK_CHARGE_SUCCESS: "paystack.charge.success",
    PAYSTACK_CHARGE_FAILED: "paystack.charge.failed"
};

// Dead Letter Queue configuration
const DLQ_EXCHANGE = "payment_events_dlq";
const DLQ_QUEUE = "payment_events_dead_letter";

let connection = null;
let channel = null;

/**
 * Setup queues and exchanges with proper error handling
 */
async function setupQueuesAndExchanges() {
    try {
        console.log('Setting up exchanges and queues...');
        
        // 1. Create exchanges first (order matters)
        await channel.assertExchange(EXCHANGE_NAME, "topic", {
            durable: true,
            autoDelete: false,
        });
        console.log(`Main exchange '${EXCHANGE_NAME}' created`);

        await channel.assertExchange(DLQ_EXCHANGE, "direct", {
            durable: true,
            autoDelete: false,
        });
        console.log(`DLQ exchange '${DLQ_EXCHANGE}' created`);

        // 2. Create Dead Letter Queue first (must exist before other queues reference it)
        await channel.assertQueue(DLQ_QUEUE, {
            durable: true,
            autoDelete: false,
            arguments: {
                "x-message-ttl": 7 * 24 * 60 * 60 * 1000, // 7 days
                "x-max-length": 10000,
            },
        });
        console.log(`Dead Letter Queue '${DLQ_QUEUE}' created`);

        // 3. Bind DLQ to its exchange
        await channel.bindQueue(DLQ_QUEUE, DLQ_EXCHANGE, "dead_letter");
        console.log(`DLQ bound to exchange`);

        // 4. Create webhook processing queue
        const webhookQueue = process.env.RABBITMQ_QUEUE || "payment_webhooks_queue";
        await channel.assertQueue(webhookQueue, {
            durable: true,
            autoDelete: false,
            arguments: {
                "x-dead-letter-exchange": DLQ_EXCHANGE,
                "x-dead-letter-routing-key": "dead_letter",
                "x-message-ttl": 24 * 60 * 60 * 1000, // 24 hours
            },
        });
        await channel.bindQueue(webhookQueue, EXCHANGE_NAME, "paystack.webhook.*");
        console.log(`Webhook queue '${webhookQueue}' created and bound`);

        // 5. Create specific webhook received queue
        const webhookReceivedQueue = "paystack.webhook.received_queue";
        await channel.assertQueue(webhookReceivedQueue, {
            durable: true,
            autoDelete: false,
            arguments: {
                "x-dead-letter-exchange": DLQ_EXCHANGE,
                "x-dead-letter-routing-key": "dead_letter",
                "x-message-ttl": 24 * 60 * 60 * 1000, // 24 hours
            },
        });
        await channel.bindQueue(webhookReceivedQueue, EXCHANGE_NAME, "paystack.webhook.received");
        console.log(`✅ Webhook received queue '${webhookReceivedQueue}' created and bound`);

        // 6. Create payment topic queues
        for (const [key, topic] of Object.entries(PAYMENT_TOPICS)) {
            const queueName = `${topic}_queue`;
            await channel.assertQueue(queueName, {
                durable: true,
                autoDelete: false,
                arguments: {
                    "x-dead-letter-exchange": DLQ_EXCHANGE,
                    "x-dead-letter-routing-key": "dead_letter",
                    "x-message-ttl": 24 * 60 * 60 * 1000, // 24 hours
                },
            });
            await channel.bindQueue(queueName, EXCHANGE_NAME, topic);
            console.log(`Queue '${queueName}' bound to topic '${topic}'`);
        }

        console.log('All queues and exchanges setup completed');
        
    } catch (error) {
        console.error('Failed to setup queues and exchanges:', error);
        throw error;
    }
}

/**
 * Connects to RabbitMQ with exponential backoff retry
 */
export const connect = async (retries = 10, baseDelay = 2000) => {
    if (connection && !connection.connection.destroyed) {
        return connection;
    }

    const connectionUris = [
        `amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@rabbitmq:${RABBITMQ_PORT}${RABBITMQ_VHOST}`,
        `amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@localhost:${RABBITMQ_PORT}${RABBITMQ_VHOST}`
    ];

    for (let attempt = 0; attempt < retries; attempt++) {
        for (const uri of connectionUris) {
            try {
                console.log(`Attempting RabbitMQ connection (attempt ${attempt + 1}/${retries}): ${uri.replace(/:[^:]*@/, ':***@')}`);
                
                connection = await amqp.connect(uri, {
                    heartbeat: 30,
                    connectionTimeout: 10000,
                });

                // Add connection error handlers
                connection.on('error', (err) => {
                    console.error('RabbitMQ connection error:', err);
                });

                connection.on('close', () => {
                    console.warn('RabbitMQ connection closed');
                    connection = null;
                    channel = null;
                });

                channel = await connection.createChannel();
                
                // Add channel error handlers
                channel.on('error', (err) => {
                    console.error('RabbitMQ channel error:', err);
                });

                channel.on('close', () => {
                    console.warn('RabbitMQ channel closed');
                    channel = null;
                });

                // Test connectivity with a simple operation
                await channel.checkExchange('amq.direct'); // This exchange always exists
                
                console.log(`Successfully connected to RabbitMQ: ${uri.replace(/:[^:]*@/, ':***@')}`);
                
                // Setup queues and exchanges
                await setupQueuesAndExchanges();
                
                return connection;
                
            } catch (err) {
                console.warn(`Connection failed for ${uri.replace(/:[^:]*@/, ':***@')}: ${err.message}`);
                // Continue to next URI
            }
        }
        
        if (attempt < retries - 1) {
            const delay = baseDelay * Math.pow(2, attempt);
            console.log(`All connection attempts failed, retrying in ${delay}ms...`);
            await setTimeout(delay);
        }
    }

    throw new Error(`Failed to connect to RabbitMQ after ${retries} attempts`);
};

/**
 * Publishes a message to the payment events exchange
 */
export const publish = async (topic, payload, options = {}) => {
    if (!channel) {
        throw new Error("RabbitMQ channel not available. Ensure connection is established.");
    }

    const messageOptions = {
        persistent: true,
        timestamp: Date.now(),
        messageId: options.messageId || `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        correlationId: options.correlationId,
        headers: options.headers || {},
        ...options,
    };

    try {
        const message = Buffer.from(JSON.stringify(payload));
        const published = channel.publish(
            EXCHANGE_NAME,
            topic,
            message,
            messageOptions
        );

        if (!published) {
            throw new Error("Failed to publish message - channel buffer full");
        }

        console.log(`Published message to topic: ${topic}`, {
            messageId: messageOptions.messageId,
            correlationId: messageOptions.correlationId,
        });

        return messageOptions.messageId;
    } catch (error) {
        console.error(`Failed to publish to topic ${topic}:`, error);
        throw error;
    }
};

/**
 * Subscribe to a specific payment topic
 */
export const subscribe = async (topic, handler, options = {}) => {
    if (!channel) {
        throw new Error("RabbitMQ channel not available");
    }

    const queueName = `${topic}_queue`;
    const consumerOptions = {
        noAck: false,
        prefetch: options.prefetch || 10,
        ...options,
    };

    // Set prefetch count for back-pressure
    await channel.prefetch(consumerOptions.prefetch);
    
    console.log(`📥 Subscribing to topic: ${topic} (queue: ${queueName})`);

    return channel.consume(queueName, async (msg) => {
        if (msg === null) return;

        try {
            const payload = JSON.parse(msg.content.toString());
            console.log(`📨 Processing message from ${topic}:`, {
                messageId: msg.properties.messageId,
                correlationId: msg.properties.correlationId,
            });

            await handler(payload, msg);
            channel.ack(msg);
            
            console.log(`✅ Message processed successfully from ${topic}`);
        } catch (error) {
            console.error(`❌ Error processing message from ${topic}:`, error);
            
            // Get retry count from headers
            const retryCount = (msg.properties.headers && msg.properties.headers["x-retry-count"]) || 0;
            const maxRetries = 3;
            
            if (retryCount >= maxRetries) {
                console.log(`💀 Max retries (${maxRetries}) exceeded for message, sending to DLQ`);
                channel.nack(msg, false, false); // Send to DLQ
            } else {
                console.log(`🔄 Retrying message (attempt ${retryCount + 1}/${maxRetries})`);
                // Update retry count and requeue
                if (!msg.properties.headers) {
                    msg.properties.headers = {};
                }
                msg.properties.headers["x-retry-count"] = retryCount + 1;
                channel.nack(msg, false, true); // Requeue for retry
            }
        }
    }, consumerOptions);
};

/**
 * Close connection gracefully
 */
export const disconnect = async () => {
    try {
        if (channel) {
            await channel.close();
            channel = null;
            console.log('RabbitMQ channel closed gracefully');
        }
        if (connection) {
            await connection.close();
            connection = null;
            console.log('RabbitMQ connection closed gracefully');
        }
    } catch (error) {
        console.error('Error closing RabbitMQ connection:', error);
    }
};

/**
 * Get connection and channel status
 */
export const getStatus = () => ({
    connected: connection && !connection.connection.destroyed,
    channelOpen: channel && !channel.closed,
});

// Export constants
export { 
    PAYMENT_TOPICS, 
    EXCHANGE_NAME, 
    DLQ_EXCHANGE, 
    DLQ_QUEUE,
    connection,
    channel
};