import { EventEmitter } from 'events';

class DLQManager extends EventEmitter {
  constructor(connection) {
    super();
    this.connection = connection;
    this.channel = null;
    this.dlqExchange = 'payment_events_dlq';
    this.dlqQueue = 'payment_events_dead_letter';
    this.dlqRetryExchange = 'payment_events_dlq_retry';
  }

  async initialize() {
    try {
      this.channel = await this.connection.createChannel();
      
      // DLQ exchange
      await this.channel.assertExchange(this.dlqExchange, 'direct', {
        durable: true,
        autoDelete: false
      });

      //retry exchange for DLQ 
      await this.channel.assertExchange(this.dlqRetryExchange, 'direct', {
        durable: true,
        autoDelete: false
      });

      //main DLQ
      await this.channel.assertQueue(this.dlqQueue, {
        durable: true,
        autoDelete: false,
        arguments: {
          'x-message-ttl': 7 * 24 * 60 * 60 * 1000, 
          'x-max-length': 10000
        }
      });

      // Bind DLQ to exchange
      await this.channel.bindQueue(this.dlqQueue, this.dlqExchange, 'dead_letter');

      console.log('DLQ setup completed successfully');
      this.emit('ready');
    } catch (error) {
      console.error('Failed to setup DLQ:', error);
      this.emit('error', error);
      throw error;
    }
  }

  /**
   * Get DLQ statistics
   */
  async getStats() {
    try {
      const queueInfo = await this.channel.checkQueue(this.dlqQueue);
      return {
        messageCount: queueInfo.messageCount,
        consumerCount: queueInfo.consumerCount,
        queue: this.dlqQueue,
        exchange: this.dlqExchange,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Failed to get DLQ stats:', error);
      throw error;
    }
  }

  /**
   * Peek at messages in DLQ without consuming
   */
  async peekMessages(limit = 10) {
    try {
      const messages = [];
      let count = 0;

      return new Promise((resolve, reject) => {
        const consumer = this.channel.consume(this.dlqQueue, (msg) => {
          if (msg && count < limit) {
            try {
              const content = JSON.parse(msg.content.toString());
              messages.push({
                content,
                properties: {
                  headers: msg.properties.headers,
                  timestamp: msg.properties.timestamp,
                  messageId: msg.properties.messageId,
                  correlationId: msg.properties.correlationId
                },
                fields: {
                  routingKey: msg.fields.routingKey,
                  exchange: msg.fields.exchange,
                  redelivered: msg.fields.redelivered
                }
              });
              count++;
              
              // Reject without requeue to peek without consuming
              this.channel.nack(msg, false, true);
              
              if (count >= limit) {
                this.channel.cancel(consumer.consumerTag);
                resolve(messages);
              }
            } catch (parseError) {
              console.error('Failed to parse DLQ message:', parseError);
              this.channel.nack(msg, false, true);
            }
          } else if (!msg) {
            // No more messages
            this.channel.cancel(consumer.consumerTag);
            resolve(messages);
          }
        }, { noAck: false });

        setTimeout(() => {
          this.channel.cancel(consumer.consumerTag).catch(() => {});
          resolve(messages);
        }, 5000);
      });
    } catch (error) {
      console.error('Failed to peek DLQ messages:', error);
      throw error;
    }
  }

  /**
   * Reprocess messages from DLQ
   */
  async reprocessMessages(options = {}) {
    const {
      maxMessages = 100,
      filterFn = null,
      targetExchange = 'payment_events',
      dryRun = false
    } = options;

    const results = {
      processed: 0,
      requeued: 0,
      failed: 0,
      skipped: 0,
      errors: []
    };

    try {
      let processedCount = 0;

      return new Promise((resolve, reject) => {
        const consumer = this.channel.consume(this.dlqQueue, async (msg) => {
          if (!msg || processedCount >= maxMessages) {
            await this.channel.cancel(consumer.consumerTag);
            return resolve(results);
          }

          try {
            const content = JSON.parse(msg.content.toString());
            const originalRoutingKey = msg.properties.headers?.['x-original-routing-key'] || 'unknown';
            
            if (filterFn && !filterFn(content, msg)) {
              results.skipped++;
              this.channel.ack(msg);
              processedCount++;
              return;
            }

            if (!dryRun) {
              // Republish to target exchange
              const publishOptions = {
                persistent: true,
                timestamp: Date.now(),
                messageId: `reprocess-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                correlationId: msg.properties.correlationId,
                headers: {
                  ...msg.properties.headers,
                  'x-reprocessed': true,
                  'x-reprocess-timestamp': Date.now(),
                  'x-original-dlq-timestamp': msg.properties.timestamp
                }
              };

              const success = this.channel.publish(
                targetExchange,
                originalRoutingKey,
                msg.content,
                publishOptions
              );

              if (success) {
                results.requeued++;
                this.channel.ack(msg);
                console.log(`Reprocessed message: ${content.paymentId || content.eventType}`);
              } else {
                throw new Error('Failed to republish message');
              }
            } else {
              results.processed++;
              this.channel.ack(msg);
              console.log(`[DRY RUN] Would reprocess: ${content.paymentId || content.eventType}`);
            }

            processedCount++;
            results.processed++;

          } catch (error) {
            console.error('Failed to reprocess DLQ message:', error);
            results.failed++;
            results.errors.push({
              messageId: msg.properties.messageId,
              error: error.message,
              timestamp: new Date().toISOString()
            });
            
            // Reject and requeue the message
            this.channel.nack(msg, false, true);
            processedCount++;
          }
        }, { noAck: false });
        setTimeout(async () => {
          try {
            await this.channel.cancel(consumer.consumerTag);
          } catch (e) {
          }
          resolve(results);
        }, 30000);
      });

    } catch (error) {
      console.error('Failed to reprocess DLQ messages:', error);
      throw error;
    }
  }

  /**
   * remove all messages from DLQ
   */
  async purgeQueue(confirm = false) {
    if (!confirm) {
      throw new Error('Must explicitly confirm purge operation');
    }

    try {
      const result = await this.channel.purgeQueue(this.dlqQueue);
      console.log(`Purged ${result.messageCount} messages from DLQ`);
      return { purgedCount: result.messageCount };
    } catch (error) {
      console.error('Failed to purge DLQ:', error);
      throw error;
    }
  }

  /**
   * Get message count in DLQ
   */
  async getMessageCount() {
    try {
      const queueInfo = await this.channel.checkQueue(this.dlqQueue);
      return queueInfo.messageCount;
    } catch (error) {
      console.error('Failed to get DLQ message count:', error);
      throw error;
    }
  }

  /**
   * Set up monitoring for DLQ
   */
  startMonitoring(alertThreshold = 100) {
    const monitoringInterval = setInterval(async () => {
      try {
        const messageCount = await this.getMessageCount();
        
        if (messageCount >= alertThreshold) {
          this.emit('alert', {
            type: 'HIGH_DLQ_COUNT',
            messageCount,
            threshold: alertThreshold,
            timestamp: new Date().toISOString()
          });
        }

        this.emit('stats', {
          messageCount,
          timestamp: new Date().toISOString()
        });

      } catch (error) {
        this.emit('monitoring-error', error);
      }
    }, 60000); 

    this.monitoringInterval = monitoringInterval;
    return monitoringInterval;
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  /**
   * Close DLQ manager
   */
  async close() {
    this.stopMonitoring();
    
    if (this.channel) {
      await this.channel.close();
      this.channel = null;
    }
  }
}

export default DLQManager;