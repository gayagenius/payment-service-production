/**
 * Complete Paystack status to internal status mapping
 * Based on https://paystack.com/docs/api/#webhooks
 */
export const mapPaystackStatus = (paystackStatus) => {
    const statusMap = {
        // Charge events
        'pending': 'PENDING',
        'success': 'SUCCEEDED',
        'failed': 'FAILED',
        'authorized': 'AUTHORIZED',
        'reversed': 'CANCELLED', // Map reversed to cancelled
        'refunded': 'REFUNDED',
        
        // Transfer events
        'otp': 'PENDING',
        'pending_otp': 'PENDING',
        'processing': 'PENDING',
        'sent': 'SUCCEEDED',
        'declined': 'FAILED',
        
        // Refund events
        'processed': 'SUCCEEDED',
        'pending': 'PENDING',
        'failed': 'FAILED'
    };

    return statusMap[paystackStatus.toLowerCase()] || 'PENDING';
};

/**
 * Map Paystack event to internal event type
 */
export const mapPaystackEventType = (paystackEvent) => {
    const eventMap = {
        // Charge events
        'charge.success': 'payment_succeeded',
        'charge.failed': 'payment_failed',
        'charge.authorized': 'payment_authorized',
        
        // Refund events
        'refund.processed': 'refund_processed',
        'refund.failed': 'refund_failed',
        'refund.pending': 'refund_pending',
        
        // Transfer events
        'transfer.success': 'transfer_succeeded',
        'transfer.failed': 'transfer_failed',
        'transfer.reversed': 'transfer_reversed',
        
        // Subscription events
        'subscription.create': 'subscription_created',
        'subscription.disable': 'subscription_disabled',
        'subscription.not_renew': 'subscription_not_renewed'
    };

    return eventMap[paystackEvent] || 'unknown_event';
};

/**
 * Extract payment reference from various Paystack webhook formats
 */
export const extractPaymentReference = (webhookData) => {
    return webhookData.reference || 
           webhookData.data?.reference ||
           webhookData.transaction?.reference ||
           webhookData.data?.transaction?.reference;
};

/**
 * Normalize amount from Paystack (kobo to major unit)
 */
export const normalizeAmount = (amount, currency = 'NGN') => {
    // Convert to major unit
    return amount / 100;
};