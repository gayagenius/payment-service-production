import amqp from 'amqplib';
import { setTimeout } from 'timers/promises';

const RABBITMQ_HOST = process.env.RABBITMQ_HOST || 'localhost';
const RABBITMQ_USER = process.env.RABBITMQ_USER || 'guest';
const RABBITMQ_PASS = process.env.RABBITMQ_PASS || 'guest';
const RABBITMQ_VHOST = process.env.RABBITMQ_VHOST || '/';

const EXCHANGE_NAME = 'payment_events';
const TOPICS = [
  'payment_initiated',
  'payment_completed',
  'payment_failed',
  'refund_processed'
];

let connection = null;
let channel = null;

/**
 * Connects to RabbitMQ with a backoff retry mechanism.
 * @param {number} retries - Number of retries remaining.
 */
export const connect = async (retries = 5) => {
  if (connection) return connection;

  const uri = `amqp://${RABBITMQ_USER}:${RABBITMQ_PASS}@${RABBITMQ_HOST}:${RABBITMQ_VHOST}`;
  try {
    console.log('Attempting to connect to RabbitMQ...');
    connection = await amqp.connect(uri);
    channel = await connection.createChannel();
    await channel.assertExchange(EXCHANGE_NAME, 'topic', { durable: true });
    console.log('Successfully connected to RabbitMQ and asserted exchanges.');
    return connection;
  } catch (err) {
    console.error(`Failed to connect to RabbitMQ. Retries left: ${retries}`);
    if (retries > 0) {
      const delay = Math.pow(2, 5 - retries) * 1000;
      await setTimeout(delay);
      return connect(retries - 1);
    }
    throw err;
  }
};

/**
 * Publishes a message to a RabbitMQ topic exchange.
 * @param {string} topic - The topic to publish to e.g., 'payment_completed'
 * @param {object} payload - The message payload.
 */
export const publish = (topic, payload) => {
  if (!channel) {
    throw new Error('RabbitMQ channel not available.');
  }
  const message = Buffer.from(JSON.stringify(payload));
  channel.publish(EXCHANGE_NAME, topic, message);
};