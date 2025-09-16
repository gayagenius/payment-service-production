const axios = require('axios');

/**
 * Standardized error types for user service operations
 */
const ErrorTypes = {
  USER_NOT_FOUND: 'USER_NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  SERVICE_ERROR: 'SERVICE_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  TIMEOUT: 'TIMEOUT',
  NETWORK_ERROR: 'NETWORK_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR'
};

/**
 * User Service API Client
 * Handles authentication, correlation tracking, retry logic, and standardized error handling
 */
class UserServiceClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || process.env.USER_SERVICE_URL || 'http://localhost:3004';
    this.timeout = options.timeout || 5000;
    this.authToken = options.authToken || process.env.USER_SERVICE_AUTH_TOKEN;
    this.retryAttempts = options.retryAttempts || 3;
    this.retryDelay = options.retryDelay || 1000;

    this.client = axios.create({
      baseURL: this.baseUrl,
      timeout: this.timeout,
      headers: {
        'Content-Type': 'application/json',
        ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` })
      }
    });

    this._setupInterceptors();
  }

  /**
   * Setup request/response interceptors for logging and correlation
   * @private
   */
  _setupInterceptors() {
    // Request interceptor
    this.client.interceptors.request.use(
      (config) => {
        const correlationId = config.headers['X-Correlation-ID'] || this._generateCorrelationId();
        config.headers['X-Correlation-ID'] = correlationId;
        config.metadata = { startTime: Date.now() };
        
        console.log(`[UserServiceClient] [${correlationId}] ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        console.error('[UserServiceClient] Request interceptor error:', error.message);
        return Promise.reject(error);
      }
    );

    // Response interceptor
    this.client.interceptors.response.use(
      (response) => {
        const correlationId = response.config.headers['X-Correlation-ID'];
        const duration = Date.now() - response.config.metadata.startTime;
        console.log(`[UserServiceClient] [${correlationId}] Response ${response.status} (${duration}ms)`);
        return response;
      },
      (error) => {
        const correlationId = error.config?.headers['X-Correlation-ID'];
        const duration = error.config?.metadata ? Date.now() - error.config.metadata.startTime : 0;
        console.error(`[UserServiceClient] [${correlationId}] Error ${error.response?.status || 'NETWORK'} (${duration}ms): ${error.message}`);
        return Promise.reject(error);
      }
    );
  }

  /**
   * Generate correlation ID for request tracing
   * @private
   */
  _generateCorrelationId() {
    return `user-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Validate if a user exists and is active
   * @param {string} userId - The user ID to validate
   * @param {string} correlationId - Optional correlation ID for tracing
   * @returns {Promise<Object>} Validation result with standardized error handling
   */
  async validateUser(userId, correlationId = null) {
    // Input validation
    if (!userId || typeof userId !== 'string') {
      return {
        isValid: false,
        exists: false,
        error: {
          type: ErrorTypes.VALIDATION_ERROR,
          message: 'User ID is required and must be a string',
          retriable: false,
          correlationId
        }
      };
    }

    const headers = {};
    if (correlationId) {
      headers['X-Correlation-ID'] = correlationId;
    }

    try {
      console.log(`[UserServiceClient] Validating user: ${userId}`);
      
      const response = await this.client.get(`/users/${userId}`, { headers });
      
      const user = response.data;
      
      // Validate response structure
      if (!user || typeof user !== 'object') {
        console.error(`[UserServiceClient] Invalid user data structure received for user ${userId}`);
        return {
          isValid: false,
          exists: false,
          error: {
            type: ErrorTypes.SERVICE_ERROR,
            message: 'Invalid user data received from service',
            retriable: true,
            correlationId: response.config.headers['X-Correlation-ID']
          }
        };
      }

      // Check if user exists and is active
      const userExists = user.id && user.email;
      const userActive = user.is_active !== false && user.status !== 'disabled';
      const isValid = userExists && userActive;

      console.log(`[UserServiceClient] User ${userId} validation result: exists=${userExists}, active=${userActive}, valid=${isValid}`);
      
      return {
        isValid,
        exists: userExists,
        user: userExists ? {
          id: user.id,
          email: user.email,
          firstName: user.first_name,
          lastName: user.last_name,
          isActive: userActive,
          status: user.status
        } : undefined,
        correlationId: response.config.headers['X-Correlation-ID']
      };

    } catch (error) {
      const errorResult = this._handleError(error, 'validateUser', { userId, correlationId });
      return {
        isValid: false,
        ...errorResult
      };
    }
  }

  /**
   * Get user details by ID
   * @param {string} userId - The user ID
   * @param {string} correlationId - Optional correlation ID for tracing
   * @returns {Promise<Object>} User details or error
   */
  async getUser(userId, correlationId = null) {
    if (!userId || typeof userId !== 'string') {
      return {
        success: false,
        error: {
          type: ErrorTypes.VALIDATION_ERROR,
          message: 'User ID is required and must be a string',
          retriable: false,
          correlationId
        }
      };
    }

    const headers = {};
    if (correlationId) {
      headers['X-Correlation-ID'] = correlationId;
    }

    try {
      const response = await this.client.get(`/users/${userId}`, { headers });
      
      return {
        success: true,
        user: response.data,
        correlationId: response.config.headers['X-Correlation-ID']
      };

    } catch (error) {
      return this._handleError(error, 'getUser', { userId, correlationId });
    }
  }

  /**
   * Get user payment methods
   * @param {string} userId - The user ID
   * @param {string} correlationId - Optional correlation ID for tracing
   * @returns {Promise<Object>} User payment methods
   */
  async getUserPaymentMethods(userId, correlationId = null) {
    if (!userId || typeof userId !== 'string') {
      return {
        success: false,
        paymentMethods: [],
        error: {
          type: ErrorTypes.VALIDATION_ERROR,
          message: 'User ID is required and must be a string',
          retriable: false,
          correlationId
        }
      };
    }

    const headers = {};
    if (correlationId) {
      headers['X-Correlation-ID'] = correlationId;
    }

    try {
      console.log(`[UserServiceClient] Fetching payment methods for user ${userId}`);
      
      const response = await this.client.get(`/users/${userId}/payment-methods`, { headers });
      
      return {
        success: true,
        paymentMethods: response.data.paymentMethods || [],
        correlationId: response.config.headers['X-Correlation-ID']
      };

    } catch (error) {
      const errorResult = this._handleError(error, 'getUserPaymentMethods', { userId, correlationId });
      return {
        success: false,
        paymentMethods: [],
        ...errorResult
      };
    }
  }

  /**
   * Check if user service is healthy
   * @returns {Promise<boolean>} Service health status
   */
  async healthCheck() {
    try {
      const response = await this.client.get('/health', { 
        timeout: 3000,
        headers: { 'X-Correlation-ID': `health-${Date.now()}` }
      });
      return response.status === 200;
    } catch (error) {
      console.error('[UserServiceClient] Health check failed:', error.message);
      return false;
    }
  }

  /**
   * Standardized error handling with retry logic and error mapping
   * @private
   */
  _handleError(error, operation, context = {}) {
    const correlationId = error.config?.headers['X-Correlation-ID'] || context.correlationId;
    
    console.error(`[UserServiceClient] Error in ${operation}:`, {
      message: error.message,
      status: error.response?.status,
      correlationId,
      context
    });

    // Handle HTTP response errors
    if (error.response) {
      const status = error.response.status;
      const responseData = error.response.data;
      
      switch (status) {
        case 404:
          return {
            exists: false,
            success: false,
            error: {
              type: ErrorTypes.USER_NOT_FOUND,
              message: 'User not found',
              errorCode: 'USER_NOT_FOUND',
              statusCode: 404,
              retriable: false,
              correlationId,
              details: responseData?.message || 'The requested user does not exist'
            }
          };

        case 401:
          return {
            exists: false,
            success: false,
            error: {
              type: ErrorTypes.UNAUTHORIZED,
              message: 'Unauthorized access to user service',
              errorCode: 'UNAUTHORIZED',
              statusCode: 401,
              retriable: false,
              correlationId,
              details: responseData?.message || 'Authentication failed'
            }
          };

        case 403:
          return {
            exists: false,
            success: false,
            error: {
              type: ErrorTypes.FORBIDDEN,
              message: 'Access forbidden to user resource',
              errorCode: 'USER_FORBIDDEN',
              statusCode: 403,
              retriable: false,
              correlationId,
              details: responseData?.message || 'Insufficient permissions'
            }
          };

        case 429:
          return {
            exists: false,
            success: false,
            error: {
              type: ErrorTypes.SERVICE_ERROR,
              message: 'Rate limit exceeded',
              errorCode: 'RATE_LIMIT_EXCEEDED',
              statusCode: 429,
              retriable: true,
              retryAfter: error.response.headers['retry-after'] || 60,
              correlationId,
              details: 'Too many requests to user service'
            }
          };

        case 500:
        case 502:
        case 503:
        case 504:
          return {
            exists: false,
            success: false,
            error: {
              type: ErrorTypes.SERVICE_ERROR,
              message: 'User service internal error',
              errorCode: 'USER_SERVICE_ERROR',
              statusCode: status,
              retriable: true,
              correlationId,
              details: responseData?.message || `HTTP ${status} error from user service`
            }
          };

        default:
          return {
            exists: false,
            success: false,
            error: {
              type: ErrorTypes.SERVICE_ERROR,
              message: `Unexpected user service error: HTTP ${status}`,
              errorCode: 'USER_SERVICE_ERROR',
              statusCode: status,
              retriable: status >= 500,
              correlationId,
              details: responseData?.message || 'Unknown user service error'
            }
          };
      }
    }

    // Handle network/timeout errors
    if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
      return {
        exists: false,
        success: false,
        error: {
          type: ErrorTypes.TIMEOUT,
          message: 'User service request timeout',
          errorCode: 'USER_SERVICE_TIMEOUT',
          retriable: true,
          correlationId,
          details: `Request timed out after ${this.timeout}ms`,
          timeout: this.timeout
        }
      };
    }

    if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') {
      return {
        exists: false,
        success: false,
        error: {
          type: ErrorTypes.SERVICE_UNAVAILABLE,
          message: 'User service unavailable',
          errorCode: 'USER_SERVICE_UNAVAILABLE',
          retriable: true,
          correlationId,
          details: `Cannot connect to user service at ${this.baseUrl}`,
          networkErrorCode: error.code
        }
      };
    }

    // Generic network/unknown error
    return {
      exists: false,
      success: false,
      error: {
        type: ErrorTypes.NETWORK_ERROR,
        message: 'Network error communicating with user service',
        errorCode: 'UNKNOWN_ERROR',
        retriable: true,
        correlationId,
        details: error.message || 'Unknown error occurred',
        networkErrorCode: error.code
      }
    };
  }

  /**
   * Retry wrapper for operations that support retries
   * @private
   */
  async _withRetry(operation, context = {}) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.retryAttempts; attempt++) {
      try {
        const result = await operation();
        
        // If the result indicates a retriable error, continue retrying
        if (result.error && result.error.retriable && attempt < this.retryAttempts) {
          const delay = this.retryDelay * attempt; // Exponential backoff
          console.log(`[UserServiceClient] Attempt ${attempt} failed (${result.error.type}), retrying in ${delay}ms`);
          await this._delay(delay);
          lastError = result;
          continue;
        }
        
        return result;
        
      } catch (error) {
        lastError = error;
        
        if (attempt < this.retryAttempts) {
          const delay = this.retryDelay * attempt;
          console.log(`[UserServiceClient] Attempt ${attempt} failed, retrying in ${delay}ms`);
          await this._delay(delay);
        }
      }
    }
    
    // All retries exhausted
    console.error(`[UserServiceClient] All ${this.retryAttempts} attempts failed for operation`);
    return lastError;
  }

  /**
   * Utility delay function
   * @private
   */
  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Get the current configuration
   * @returns {Object} Current client configuration
   */
  getConfig() {
    return {
      baseUrl: this.baseUrl,
      timeout: this.timeout,
      retryAttempts: this.retryAttempts,
      retryDelay: this.retryDelay,
      hasAuthToken: !!this.authToken
    };
  }

  /**
   * Update client configuration
   * @param {Object} newOptions - New configuration options
   */
  updateConfig(newOptions = {}) {
    if (newOptions.timeout) {
      this.timeout = newOptions.timeout;
      this.client.defaults.timeout = newOptions.timeout;
    }
    
    if (newOptions.authToken) {
      this.authToken = newOptions.authToken;
      this.client.defaults.headers['Authorization'] = `Bearer ${newOptions.authToken}`;
    }
    
    if (newOptions.retryAttempts) {
      this.retryAttempts = newOptions.retryAttempts;
    }
    
    if (newOptions.retryDelay) {
      this.retryDelay = newOptions.retryDelay;
    }
  }
}
