// messaging/queueSetup.js
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
};

// Dead Letter Queue configuration
const DLQ_EXCHANGE = "payment_events_dlq";
const DLQ_QUEUE = "payment_events_dead_letter";

let connection = null;
let channel = null;

/**
 * Connects to RabbitMQ with exponential backoff retry mechanism
 * @param {number} retries - Number of retries remaining
 * @param {number} baseDelay - Base delay in milliseconds
 */
export const connect = async (retries = 5, baseDelay = 1000) => {
  if (connection && !connection.connection.destroyed) {
    return connection;
  }

  const uri = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@${RABBITMQ_HOST}:${RABBITMQ_PORT}${RABBITMQ_VHOST}`;

  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      console.log(
        `Attempting to connect to RabbitMQ... (${attempt + 1}/${retries})`
      );

      connection = await amqp.connect(uri);
      channel = await connection.createChannel();

      // Set up connection event handlers
      connection.on("error", (err) => {
        console.error("RabbitMQ connection error:", err);
        connection = null;
        channel = null;
      });

      connection.on("close", () => {
        console.warn("RabbitMQ connection closed");
        connection = null;
        channel = null;
      });

      // Assert main exchange for payment events
      await channel.assertExchange(EXCHANGE_NAME, "topic", {
        durable: true,
        autoDelete: false,
      });

      // Assert Dead Letter Queue setup
      await channel.assertExchange(DLQ_EXCHANGE, "direct", {
        durable: true,
        autoDelete: false,
      });

      await channel.assertQueue(DLQ_QUEUE, {
        durable: true,
        autoDelete: false,
        arguments: {
          "x-message-ttl": 7 * 24 * 60 * 60 * 1000, 
          "x-max-length": 10000,
        },
      });

      await channel.bindQueue(DLQ_QUEUE, DLQ_EXCHANGE, "dead_letter");

      // webhook processing queue with DLQ configuration
      const webhookQueue =
        process.env.RABBITMQ_QUEUE || "payment_webhooks_queue";
      await channel.assertQueue(webhookQueue, {
        durable: true,
        autoDelete: false,
        arguments: {
          "x-dead-letter-exchange": DLQ_EXCHANGE,
          "x-dead-letter-routing-key": "dead_letter",
          "x-message-ttl": 24 * 60 * 60 * 1000, 
        },
      });

      // queues for each payment topic
      for (const [key, topic] of Object.entries(PAYMENT_TOPICS)) {
        const queueName = `${topic}_queue`;
        await channel.assertQueue(queueName, {
          durable: true,
          autoDelete: false,
          arguments: {
            "x-dead-letter-exchange": DLQ_EXCHANGE,
            "x-dead-letter-routing-key": "dead_letter",
          },
        });

        // Bind queue to exchange with topic pattern
        await channel.bindQueue(queueName, EXCHANGE_NAME, topic);
        console.log(`Queue ${queueName} bound to topic ${topic}`);
      }

      console.log(
        "Successfully connected to RabbitMQ and declared all topics/exchanges"
      );
      return connection;
    } catch (err) {
      const delay = baseDelay * Math.pow(2, attempt);
      console.error(
        `Failed to connect to RabbitMQ (attempt ${attempt + 1}/${retries}):`,
        err.message
      );

      if (attempt < retries - 1) {
        console.log(`Retrying in ${delay}ms...`);
        await setTimeout(delay);
      } else {
        throw new Error(
          `Failed to connect to RabbitMQ after ${retries} attempts: ${err.message}`
        );
      }
    }
  }
};

/**
 * Publishes a message to the payment events exchange
 * @param {string} topic - The topic routing key (e.g., 'payment_initiated')
 * @param {object} payload - The message payload
 * @param {object} options - Publishing options
 */
export const publish = async (topic, payload, options = {}) => {
  if (!channel) {
    throw new Error(
      "RabbitMQ channel not available. Ensure connection is established."
    );
  }

  const messageOptions = {
    persistent: true,
    timestamp: Date.now(),
    messageId:
      options.messageId ||
      `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    correlationId: options.correlationId,
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
 * @param {string} topic - The topic to subscribe to
 * @param {function} handler - Message handler function
 * @param {object} options - Subscription options
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

  console.log(`Subscribing to topic: ${topic} (queue: ${queueName})`);

  return channel.consume(queueName, async (msg) => {
    if (msg === null) return;

    try {
      const payload = JSON.parse(msg.content.toString());
      await handler(payload, msg);
      channel.ack(msg);
    } catch (error) {
      console.error(`Error processing message from ${topic}:`, error);

      // Reject and send to DLQ after max retries
      const retryCount = msg.properties.headers["x-retry-count"] || 0;
      if (retryCount >= 3) {
        console.log(`Max retries exceeded for message, sending to DLQ`);
        channel.nack(msg, false, false); 
      } else {
        msg.properties.headers["x-retry-count"] = retryCount + 1;
        channel.nack(msg, false, true); 
      }
    }
  });
};

/**
 * Close connection gracefully
 */
export const disconnect = async () => {
  try {
    if (channel) {
      await channel.close();
      channel = null;
    }
    if (connection) {
      await connection.close();
      connection = null;
    }
    console.log("RabbitMQ connection closed gracefully");
  } catch (error) {
    console.error("Error closing RabbitMQ connection:", error);
  }
};

/**
 * Get connection and channel status
 */
export const getStatus = () => ({
  connected: connection && !connection.connection.destroyed,
  channelOpen: channel && !channel.closed,
});

export { PAYMENT_TOPICS, EXCHANGE_NAME, DLQ_EXCHANGE, DLQ_QUEUE };
