import { subscribe } from '../messaging/queueSetup.js';
import { retry } from '../utils/retry.js';
import { createCircuitBreaker } from '../utils/circuitBreaker.js';
import dbPoolManager from '../db/connectionPool.js';
import { publishPaymentEvent } from '../messaging/publishPaymentEvent.js';

class WebhookConsumer {
    constructor(options = {}) {
        this.prefetchCount = options.prefetchCount || 5;
        this.concurrency = options.concurrency || 3;
        this.maxRetries = options.maxRetries || 5;
        this.deduplicationTtl = options.deduplicationTtl || 24 * 60 * 60 * 1000; // 24 hours
        
        // Circuit breaker for database operations
        this.dbCircuitBreaker = createCircuitBreaker(async (operation, ...args) => {
            return await this.executeDbOperation(operation, ...args);
        }, {
            timeout: 10000,
            errorThresholdPercentage: 40,
            resetTimeout: 60000
        });
        
        this.processedMessages = new Set(); 
    }

async initialize() {
  console.log('Initializing Webhook Consumer...');
  
  await subscribe('paystack.webhook.received', this.handleWebhookMessage.bind(this), {
    prefetch: this.prefetchCount,
    queue: 'paystack.webhook.received_queue'
  });
  
  console.log('Webhook Consumer initialized successfully');
}

   async handleWebhookMessage(message, channelMsg) {
    console.debug('[Consumer] raw message received:', JSON.stringify(message, null, 2));
    console.debug('[Consumer] channelMsg shape keys:', channelMsg && Object.keys(channelMsg));
    let payloadWrapper = message.payload ?? message; 
    let metadata = message.metadata ?? message.headers ?? {};
    if (payloadWrapper && payloadWrapper.eventType && !payloadWrapper.payload) {  
    } else if (message && message.eventType && message.payload) {
        payloadWrapper = { eventType: message.eventType, payload: message.payload };
        metadata = message.metadata ?? metadata;
    } else if (payloadWrapper && payloadWrapper.payload && payloadWrapper.payload.event) {
    }

    const correlationId = metadata.correlationId || metadata.correlation || channelMsg?.properties?.correlationId || 'unknown';
    const idempotencyKey = metadata.idempotencyKey || metadata.messageId || message.messageId || message.message_id || 'unknown';

    console.log(`[Consumer][${correlationId}] Processing message`, {
        messageId: message.messageId || message.message_id || idempotencyKey,
        correlationId,
    });

    const safeAck = () => {
        try {
            if (channelMsg && typeof channelMsg.ack === 'function') return channelMsg.ack();
            if (channelMsg && typeof channelMsg.ackMessage === 'function') return channelMsg.ackMessage();
            console.warn(`[Consumer][${correlationId}] Unable to ack: ack method not found on channelMsg`);
        } catch (err) {
            console.error(`[Consumer][${correlationId}] Error during ack():`, err);
        }
    };

    const safeNack = (requeue = false) => {
        try {
            if (channelMsg && typeof channelMsg.nack === 'function') return channelMsg.nack(false, requeue);
            if (channelMsg && typeof channelMsg.reject === 'function') return channelMsg.reject(requeue);
            if (channelMsg && typeof channelMsg.nackMessage === 'function') return channelMsg.nackMessage();
            console.warn(`[Consumer][${correlationId}] Unable to nack/reject: nack/reject method not found on channelMsg`);
        } catch (err) {
            console.error(`[Consumer][${correlationId}] Error during nack():`, err);
        }
    };

    if (this.processedMessages.has(idempotencyKey)) {
        console.log(`[Consumer][${correlationId}] Duplicate message detected, acknowledging`);
        safeAck();
        return;
    }

    try {
        await retry(
            async () => {
                return await this.processWebhookPayload(payloadWrapper, metadata);
            },
            {
                retries: this.maxRetries,
                factor: 2,
                minTimeout: 1000,
                maxTimeout: 30000,
                onRetry: (error, attempt) => {
                    console.warn(`[Consumer][${correlationId}] Retry attempt ${attempt}/${this.maxRetries}:`, error.message);
                }
            }
        );
        this.processedMessages.add(idempotencyKey);
        safeAck();
        console.log(`[Consumer][${correlationId}] Successfully processed webhook`);

    } catch (error) {
        console.error(`[Consumer][${correlationId}] Failed to process webhook after retries:`, error);
        safeNack(false);
    }
}


    async processWebhookPayload(payload, metadata) {
        const { eventType, payload: webhookData } = payload;
        const { correlationId, idempotencyKey } = metadata;

        try {
            switch (eventType) {
                case 'payment_succeeded':
                    return await this.handlePaymentSuccess(webhookData, metadata);
                case 'payment_failed':
                    return await this.handlePaymentFailure(webhookData, metadata);
                case 'payment_authorized':
                    return await this.handlePaymentAuthorized(webhookData, metadata);
                case 'refund_processed':
                    return await this.handleRefundProcessed(webhookData, metadata);
                default:
                    console.warn(`[Consumer][${correlationId}] Unhandled event type: ${eventType}`);
                    throw new Error(`Unhandled event type: ${eventType}`);
            }
        } catch (error) {
            console.error(`[Consumer][${correlationId}] Error processing ${eventType}:`, error);
            throw error;
        }
    }

    async handlePaymentSuccess(webhookData, metadata) {
        const { data } = webhookData;
        const { correlationId, idempotencyKey } = metadata;

        // Extract payment data from Paystack webhook
        const paymentData = {
            reference: data.reference,
            amount: data.amount / 100, // Convert from kobo to major unit
            currency: data.currency,
            status: 'SUCCEEDED',
            gatewayResponse: data,
            metadata: {
                paystackEventId: data.id,
                customerEmail: data.customer?.email,
                paidAt: data.paid_at
            }
        };

        const result = await this.dbCircuitBreaker.fire('updatePaymentStatus', 
            paymentData.reference, 'SUCCEEDED', paymentData.gatewayResponse, idempotencyKey);

        await publishPaymentEvent('payment_completed', {
            paymentId: result.paymentId,
            orderId: data.metadata?.order_id || data.reference,
            userId: data.metadata?.user_id || 'unknown',
            amount: paymentData.amount,
            currency: paymentData.currency,
            status: 'SUCCEEDED',
            correlationId,
            gatewayResponse: paymentData.gatewayResponse
        });

        return result;
    }

    async handlePaymentFailure(webhookData, metadata) {
        const { data } = webhookData;
        const { correlationId, idempotencyKey } = metadata;

        const paymentData = {
            reference: data.reference,
            status: 'FAILED',
            gatewayResponse: data,
            error: data.gateway_response || 'Payment failed'
        };

        const result = await this.dbCircuitBreaker.fire('updatePaymentStatus',
            paymentData.reference, 'FAILED', paymentData.gatewayResponse, idempotencyKey);

        await publishPaymentEvent('payment_failed', {
            paymentId: result.paymentId,
            orderId: data.metadata?.order_id || data.reference,
            userId: data.metadata?.user_id || 'unknown',
            amount: data.amount / 100,
            currency: data.currency,
            status: 'FAILED',
            correlationId,
            error: paymentData.error
        });

        return result;
    }

    async handlePaymentAuthorized(webhookData, metadata) {
        const { data } = webhookData;
        const { correlationId, idempotencyKey } = metadata;

        const paymentData = {
            reference: data.reference,
            status: 'AUTHORIZED',
            gatewayResponse: data
        };

        const result = await this.dbCircuitBreaker.fire('updatePaymentStatus',
            paymentData.reference, 'AUTHORIZED', paymentData.gatewayResponse, idempotencyKey);

        await publishPaymentEvent('payment_authorized', {
            paymentId: result.paymentId,
            orderId: data.metadata?.order_id || data.reference,
            userId: data.metadata?.user_id || 'unknown',
            amount: data.amount / 100,
            currency: data.currency,
            status: 'AUTHORIZED',
            correlationId
        });

        return result;
    }

    async executeDbOperation(operation, ...args) {
        const client = await dbPoolManager.getWriteClient();
        
        try {
            switch (operation) {
                case 'updatePaymentStatus':
                    return await this.updatePaymentStatus(...args);
                case 'createPayment':
                    return await this.createPayment(...args);
                default:
                    throw new Error(`Unknown DB operation: ${operation}`);
            }
        } finally {
            client.release();
        }
    }

    async updatePaymentStatus(reference, status, gatewayResponse, idempotencyKey) {
        // First, try to find payment by reference
        const findQuery = `
            SELECT id, status FROM payments 
            WHERE gateway_response->>'reference' = $1 
            OR idempotency_key = $2
        `;
        
        const findResult = await dbPoolManager.executeRead(findQuery, [reference, idempotencyKey]);
        
        if (findResult.rows.length === 0) {
            // Payment doesn't exist, create it
            return await this.createPaymentFromWebhook(reference, status, gatewayResponse, idempotencyKey);
        }

        const payment = findResult.rows[0];
        
        const updateQuery = `
            SELECT * FROM update_payment_status($1, $2, $3)
        `;
        
        const updateResult = await dbPoolManager.executeWrite(updateQuery, [
            payment.id,
            status,
            gatewayResponse
        ]);

        return {
            paymentId: payment.id,
            previousStatus: payment.status,
            newStatus: status,
            success: updateResult.rows[0].success
        };
    }

    async createPaymentFromWebhook(reference, status, gatewayResponse, idempotencyKey) {
        const metadata = gatewayResponse.metadata || {};
        const userId = metadata.user_id || metadata.user?.id || 'unknown';
        const orderId = metadata.order_id || metadata.order?.id || reference;

        const createQuery = `
            SELECT * FROM create_payment_with_history(
                $1, $2, $3, $4, $5, $6, $7, false, $8
            )
        `;

        const createResult = await dbPoolManager.executeWrite(createQuery, [
            userId,
            orderId,
            gatewayResponse.amount / 100, 
            gatewayResponse.currency,
            null, 
            gatewayResponse,
            idempotencyKey,
            { source: 'paystack_webhook', ...metadata }
        ]);

        const result = createResult.rows[0];
        
        if (!result.success) {
            throw new Error(`Failed to create payment: ${result.error_message}`);
        }

        return {
            paymentId: result.payment_id,
            status: result.status,
            success: true
        };
    }
}

export default WebhookConsumer;