/**
 * Async Payment Processing Service
 * Handles background payment status synchronization and processing
 */

import { getLatestPaymentStatus } from '../gateways/paystack.js';
import dbPoolManager from '../db/connectionPool.js';
import { publish } from '../messaging/queueSetup.js';

// Queue for background payment processing
const paymentSyncQueue = [];
let isProcessing = false;

/**
 * Add payment to sync queue for background processing
 */
export const queuePaymentSync = async (idempotencyKey, currentStatus = 'PENDING') => {
    const syncJob = {
        idempotencyKey,
        currentStatus,
        attempts: 0,
        maxAttempts: 3,
        createdAt: new Date(),
        priority: currentStatus === 'FAILED' ? 1 : 2 // Higher priority for failed payments
    };
    
    paymentSyncQueue.push(syncJob);
    console.log(`Queued payment sync for ${idempotencyKey}, queue size: ${paymentSyncQueue.length}`);
    
    // Start processing if not already running
    if (!isProcessing) {
        processPaymentSyncQueue();
    }
};

/**
 * Process payment sync queue in background
 */
const processPaymentSyncQueue = async () => {
    if (isProcessing) return;
    
    isProcessing = true;
    console.log('Starting payment sync queue processor');
    
    while (paymentSyncQueue.length > 0) {
        // Sort by priority (failed payments first)
        paymentSyncQueue.sort((a, b) => a.priority - b.priority);
        
        const job = paymentSyncQueue.shift();
        if (!job) break;
        
        try {
            await processPaymentSyncJob(job);
        } catch (error) {
            console.error(`Error processing sync job for ${job.idempotencyKey}:`, error);
            
            // Retry if not exceeded max attempts
            if (job.attempts < job.maxAttempts) {
                job.attempts++;
                job.priority = 1; // High priority for retries
                paymentSyncQueue.push(job);
            } else {
                console.error(`Max attempts exceeded for payment sync: ${job.idempotencyKey}`);
            }
        }
        
        // Small delay between jobs to prevent overwhelming the system
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    isProcessing = false;
    console.log('Payment sync queue processor finished');
};

/**
 * Process individual payment sync job
 */
const processPaymentSyncJob = async (job) => {
    const { idempotencyKey, currentStatus } = job;
    
    try {
        console.log(`Processing payment sync for ${idempotencyKey}`);
        
        // Skip if payment is already in final state
        if (['SUCCEEDED', 'FAILED', 'REFUNDED'].includes(currentStatus)) {
            console.log(`Skipping sync for ${idempotencyKey} - already in final state: ${currentStatus}`);
            return;
        }
        
        // Get latest status from Paystack
        const statusResult = await getLatestPaymentStatus(idempotencyKey);
        
        if (!statusResult.success) {
            console.warn(`Failed to get status for ${idempotencyKey}: ${statusResult.error.message}`);
            throw new Error(`Status fetch failed: ${statusResult.error.message}`);
        }
        
        const { status: newStatus, gatewayResponse } = statusResult.data;
        
        // Check if status has changed
        if (newStatus === currentStatus) {
            console.log(`Status unchanged for ${idempotencyKey}: ${newStatus}`);
            return;
        }
        
        // Update payment in database
        const updateQuery = `
            UPDATE payments 
            SET status = $1, gateway_response = $2, updated_at = NOW()
            WHERE idempotency_key = $3
            RETURNING id, user_id, order_id, amount, currency, status, gateway_response, created_at, updated_at
        `;
        
        const updateResult = await dbPoolManager.executeWrite(updateQuery, [
            newStatus,
            JSON.stringify(gatewayResponse),
            idempotencyKey
        ]);
        
        if (updateResult.rows.length === 0) {
            console.warn(`No payment found with idempotency key: ${idempotencyKey}`);
            return;
        }
        
        const updatedPayment = updateResult.rows[0];
        
        // Publish payment status change event
        await publish('payment_status_changed', {
            paymentId: updatedPayment.id,
            idempotencyKey,
            oldStatus: currentStatus,
            newStatus,
            gatewayResponse,
            timestamp: new Date().toISOString()
        });
        
        console.log(`Successfully updated payment ${updatedPayment.id} from ${currentStatus} to ${newStatus}`);
        
    } catch (error) {
        console.error(`Error in payment sync job for ${idempotencyKey}:`, error);
        throw error;
    }
};

/**
 * Get queue status for monitoring
 */
export const getQueueStatus = () => {
    return {
        queueSize: paymentSyncQueue.length,
        isProcessing,
        jobs: paymentSyncQueue.map(job => ({
            idempotencyKey: job.idempotencyKey,
            currentStatus: job.currentStatus,
            attempts: job.attempts,
            createdAt: job.createdAt,
            priority: job.priority
        }))
    };
};

/**
 * Clear queue (for testing purposes)
 */
export const clearQueue = () => {
    paymentSyncQueue.length = 0;
    console.log('Payment sync queue cleared');
};

/**
 * Process payment creation asynchronously
 * This function creates a payment and queues status sync for background processing
 */
export const createPaymentAsync = async (paymentData) => {
    try {
        // Create payment immediately without waiting for Paystack status sync
        const createPaymentQuery = `
            INSERT INTO payments (
                user_id, order_id, amount, currency, status, 
                gateway_response, idempotency_key, metadata, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
            RETURNING id, user_id, order_id, amount, currency, status, 
                     gateway_response, idempotency_key, metadata, created_at, updated_at
        `;
        
        const result = await dbPoolManager.executeWrite(createPaymentQuery, [
            paymentData.user_id,
            paymentData.order_id,
            paymentData.amount,
            paymentData.currency,
            'PENDING', // Start with PENDING status
            JSON.stringify(paymentData.gateway_response || {}),
            paymentData.idempotency_key,
            JSON.stringify(paymentData.metadata || {})
        ]);
        
        if (result.rows.length === 0) {
            throw new Error('Failed to create payment');
        }
        
        const payment = result.rows[0];
        
        // Queue status sync for background processing
        await queuePaymentSync(payment.idempotency_key, 'PENDING');
        
        // Publish payment created event
        await publish('payment_created', {
            paymentId: payment.id,
            idempotencyKey: payment.idempotency_key,
            userId: payment.user_id,
            orderId: payment.order_id,
            amount: payment.amount,
            currency: payment.currency,
            timestamp: new Date().toISOString()
        });
        
        return {
            success: true,
            data: payment
        };
        
    } catch (error) {
        console.error('Async payment creation error:', error);
        return {
            success: false,
            error: {
                code: 'PAYMENT_CREATION_FAILED',
                message: 'Failed to create payment',
                details: error.message
            }
        };
    }
};

export default {
    queuePaymentSync,
    getQueueStatus,
    clearQueue,
    createPaymentAsync
};
