import { create } from 'axios';

class OrderServiceClient {
  constructor(baseUrl = process.env.ORDER_SERVICE_URL || 'http://localhost:3002', timeout = 5000) {
    this.client = create({
      baseURL: baseUrl,
      timeout: timeout,
      headers: {
        'Content-Type': 'application/json'
      }
    });

    // Request interceptor to add correlation ID
    this.client.interceptors.request.use(
      (config) => {
        const correlationId = config.headers['X-Correlation-ID'] || this.generateCorrelationId();
        config.headers['X-Correlation-ID'] = correlationId;
        console.log(`[OrderServiceClient] Request to ${config.url} with correlation ID: ${correlationId}`);
        return config;
      },
      (error) => {
        console.error('[OrderServiceClient] Request interceptor error:', error);
        return Promise.reject(error);
      }
    );

    // Response interceptor for logging
    this.client.interceptors.response.use(
      (response) => {
        const correlationId = response.config.headers['X-Correlation-ID'];
        console.log(`[OrderServiceClient] Response from ${response.config.url} with correlation ID: ${correlationId}`);
        return response;
      },
      (error) => {
        const correlationId = error.config?.headers['X-Correlation-ID'];
        console.error(`[OrderServiceClient] Error response with correlation ID: ${correlationId}`, error.message);
        return Promise.reject(error);
      }
    );
  }

  generateCorrelationId() {
    return `order-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Confirm order details and validate order amount
   * @param {string} orderId - The order ID to confirm
   * @param {number} expectedAmount - Expected payment amount for validation
   * @param {string} correlationId - Optional correlation ID for tracing
   * @returns {Promise<Object>} Order confirmation result
   */
  async confirmOrder(orderId, expectedAmount, correlationId = null) {
    try {
      if (!orderId) {
        throw new Error('Order ID is required');
      }
      if (!expectedAmount || expectedAmount <= 0) {
        throw new Error('Valid expected amount is required');
      }

      const headers = {};
      if (correlationId) {
        headers['X-Correlation-ID'] = correlationId;
      }

      console.log(`[OrderServiceClient] Confirming order ${orderId} with amount ${expectedAmount}`);
      
      const response = await this.client.get(`/orders/${orderId}`, { headers });
      
      const order = response.data;
      
      // Validate order exists and has required fields
      if (!order || !order.id || !order.total_amount) {
        throw new Error('Invalid order data received');
      }

      // Validate order amount matches expected amount
      const amountMatch = Math.abs(order.total_amount - expectedAmount) < 0.01; // Allow for small floating point differences
      
      if (!amountMatch) {
        console.error(`[OrderServiceClient] Amount mismatch for order ${orderId}: expected ${expectedAmount}, got ${order.total_amount}`);
        return {
          isValid: false,
          error: 'Order amount mismatch',
          errorCode: 'AMOUNT_MISMATCH',
          expectedAmount,
          actualAmount: order.total_amount,
          correlationId: response.config.headers['X-Correlation-ID']
        };
      }

      // Check if order is in a payable state
      const payableStatuses = ['pending', 'confirmed', 'payment_pending'];
      if (!payableStatuses.includes(order.status)) {
        return {
          isValid: false,
          error: `Order status '${order.status}' is not payable`,
          errorCode: 'INVALID_ORDER_STATUS',
          orderStatus: order.status,
          correlationId: response.config.headers['X-Correlation-ID']
        };
      }

      console.log(`[OrderServiceClient] Order ${orderId} confirmed successfully`);
      
      return {
        isValid: true,
        order: {
          id: order.id,
          userId: order.user_id,
          totalAmount: order.total_amount,
          status: order.status,
          items: order.items || [],
          createdAt: order.created_at
        },
        correlationId: response.config.headers['X-Correlation-ID']
      };

    } catch (error) {
      console.error(`[OrderServiceClient] Error confirming order ${orderId}:`, error.message);
      
      if (error.response) {
        const status = error.response.status;
        const correlationId = error.config?.headers['X-Correlation-ID'];
        
        switch (status) {
          case 404:
            return {
              isValid: false,
              error: 'Order not found',
              errorCode: 'ORDER_NOT_FOUND',
              correlationId
            };
          case 403:
            return {
              isValid: false,
              error: 'Order access forbidden',
              errorCode: 'ORDER_FORBIDDEN',
              correlationId
            };
          case 500:
            return {
              isValid: false,
              error: 'Order service internal error',
              errorCode: 'ORDER_SERVICE_ERROR',
              correlationId
            };
          default:
            return {
              isValid: false,
              error: `Order service error: ${error.response.data?.message || 'Unknown error'}`,
              errorCode: 'ORDER_SERVICE_ERROR',
              correlationId
            };
        }
      }

      return this._handleNetworkError(error, 'ORDER_SERVICE');
    }
  }

  /**
   * Update order status after payment processing
   * @param {string} orderId - The order ID to update
   * @param {string} paymentId - The payment ID associated with the order
   * @param {string} status - New order status ('paid', 'payment_failed', etc.)
   * @param {Object} metadata - Additional payment metadata
   * @param {string} correlationId - Optional correlation ID for tracing
   * @returns {Promise<Object>} Update result
   */
  async updateOrderAfterPayment(orderId, paymentId, status, metadata = {}, correlationId = null) {
    try {
      if (!orderId || !paymentId || !status) {
        throw new Error('Order ID, Payment ID, and status are required');
      }

      const headers = {};
      if (correlationId) {
        headers['X-Correlation-ID'] = correlationId;
      }

      const updateData = {
        status,
        paymentId,
        paymentMetadata: {
          ...metadata,
          updatedAt: new Date().toISOString()
        }
      };

      console.log(`[OrderServiceClient] Updating order ${orderId} status to ${status} with payment ${paymentId}`);
      
      const response = await this.client.put(`/orders/${orderId}/payment-status`, updateData, { headers });
      
      console.log(`[OrderServiceClient] Order ${orderId} status updated successfully`);
      
      return {
        success: true,
        order: response.data,
        correlationId: response.config.headers['X-Correlation-ID']
      };

    } catch (error) {
      console.error(`[OrderServiceClient] Error updating order ${orderId} status:`, error.message);
      
      if (error.response) {
        const status = error.response.status;
        const correlationId = error.config?.headers['X-Correlation-ID'];
        
        return {
          success: false,
          error: error.response.data?.message || 'Failed to update order status',
          errorCode: status === 404 ? 'ORDER_NOT_FOUND' : 'UPDATE_FAILED',
          correlationId
        };
      }

      return {
        success: false,
        error: error.message || 'Network error occurred',
        errorCode: 'NETWORK_ERROR',
        correlationId: error.config?.headers['X-Correlation-ID']
      };
    }
  }

  /**
   * Notify order service of payment completion (for saga pattern)
   * @param {string} orderId - The order ID
   * @param {Object} paymentResult - Payment processing result
   * @param {string} correlationId - Optional correlation ID for tracing
   * @returns {Promise<Object>} Notification result
   */
  async notifyPaymentComplete(orderId, paymentResult, correlationId = null) {
    try {
      const headers = {};
      if (correlationId) {
        headers['X-Correlation-ID'] = correlationId;
      }

      const notificationData = {
        orderId,
        paymentId: paymentResult.paymentId,
        status: paymentResult.success ? 'payment_completed' : 'payment_failed',
        amount: paymentResult.amount,
        gatewayResponse: paymentResult.gatewayResponse,
        timestamp: new Date().toISOString(),
        ...(paymentResult.error && { error: paymentResult.error })
      };

      console.log(`[OrderServiceClient] Notifying payment completion for order ${orderId}`);
      
      const response = await this.client.post('/orders/payment-notifications', notificationData, { headers });
      
      return {
        success: true,
        acknowledgment: response.data,
        correlationId: response.config.headers['X-Correlation-ID']
      };

    } catch (error) {
      console.error(`[OrderServiceClient] Error notifying payment completion for order ${orderId}:`, error.message);
      
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        errorCode: 'NOTIFICATION_FAILED',
        correlationId: error.config?.headers['X-Correlation-ID']
      };
    }
  }

  /**
   * Get order details by ID
   * @param {string} orderId - The order ID
   * @param {string} correlationId - Optional correlation ID for tracing
   * @returns {Promise<Object>} Order details
   */
  async getOrderDetails(orderId, correlationId = null) {
    try {
      const headers = {};
      if (correlationId) {
        headers['X-Correlation-ID'] = correlationId;
      }

      const response = await this.client.get(`/orders/${orderId}`, { headers });
      
      return {
        success: true,
        order: response.data,
        correlationId: response.config.headers['X-Correlation-ID']
      };

    } catch (error) {
      console.error(`[OrderServiceClient] Error fetching order ${orderId}:`, error.message);
      
      return {
        success: false,
        error: error.response?.data?.message || error.message,
        errorCode: error.response?.status === 404 ? 'ORDER_NOT_FOUND' : 'FETCH_ERROR',
        correlationId: error.config?.headers['X-Correlation-ID']
      };
    }
  }

  /**
   * Handle network-related errors
   * @private
   */
  _handleNetworkError(error, servicePrefix) {
    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      return {
        isValid: false,
        success: false,
        error: `${servicePrefix} unavailable`,
        errorCode: `${servicePrefix}_UNAVAILABLE`,
        correlationId: error.config?.headers['X-Correlation-ID']
      };
    } else if (error.code === 'ECONNABORTED') {
      return {
        isValid: false,
        success: false,
        error: `${servicePrefix} timeout`,
        errorCode: `${servicePrefix}_TIMEOUT`,
        correlationId: error.config?.headers['X-Correlation-ID']
      };
    }

    return {
      isValid: false,
      success: false,
      error: error.message || 'Unknown error occurred',
      errorCode: 'UNKNOWN_ERROR',
      correlationId: error.config?.headers['X-Correlation-ID']
    };
  }

  /**
   * Health check for order service
   * @returns {Promise<boolean>} Service health status
   */
  async healthCheck() {
    try {
      const response = await this.client.get('/health', { timeout: 3000 });
      return response.status === 200;
    } catch (error) {
      console.error('[OrderServiceClient] Health check failed:', error.message);
      return false;
    }
  }
}

export default OrderServiceClient;