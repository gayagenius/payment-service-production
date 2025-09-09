// workers/webhookProcessor.js

import 'dotenv/config';
import { retryWithBackoff } from './retryWithBackoff.js';
import { connect } from '../messaging/queueSetup.js';


const QUEUE_NAME = process.env.RABBITMQ_QUEUE;
const DEAD_LETTER_EXCHANGE = 'dead_letter_exchange';
const DEAD_LETTER_QUEUE = 'dead_letter_queue';

const processWebhook = async (msg) => {
  try {
    const payload = JSON.parse(msg.content.toString());
    console.log('Processing webhook task:', payload);

    // Simulate a transient failure
    if (Math.random() < 0.2) {
      throw new Error('Transient gateway/DB failure!');
    }
    console.log('Webhook successfully processed.');
    // Acknowledge the message
    return true; 
  } catch (err) {
    console.error(`Failed to process webhook: ${err.message}`);
    // enable retry
    return false; 
  }
};

const startWorker = async () => {
  try {
    const connection = await connect();
    const channel = await connection.createChannel();

    // Assert dead-letter exchange and queue
    await channel.assertExchange(DEAD_LETTER_EXCHANGE, 'direct', { durable: true });
    await channel.assertQueue(DEAD_LETTER_QUEUE, { durable: true });
    await channel.bindQueue(DEAD_LETTER_QUEUE, DEAD_LETTER_EXCHANGE, 'dead_letter_key');

    // Assert the main queue with dead-lettering configuration
    const q = await channel.assertQueue(QUEUE_NAME, {
      durable: true,
      deadLetterExchange: DEAD_LETTER_EXCHANGE,
      deadLetterRoutingKey: 'dead_letter_key'
    });
    
    console.log(`Worker is listening for messages on ${QUEUE_NAME}...`);

    channel.consume(QUEUE_NAME, async (msg) => {
      if (msg === null) return;

      try {
        await retryWithBackoff(async () => {
          const success = await processWebhook(msg);
          if (!success) {
            throw new Error('Task processing failed, will retry.');
          }
        }, 5, 1000, 2, true);

        channel.ack(msg);
        console.log('Task acknowledged.');
      } catch (err) {
        console.error('Task failed after all retries. Sending to dead-letter queue.');
        channel.nack(msg, false, false);
      }
    });

  } catch (err) {
    console.error('Worker failed to start:', err);
    process.exit(1);
  }
};

startWorker();