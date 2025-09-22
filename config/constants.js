/**
 * Application Constants
 * Non-sensitive configuration constants
 */

export const APP_CONFIG = {
  NAME: 'payment-service',
  VERSION: '1.0.0',
  DESCRIPTION: 'Scalable payment processing service with partitioning and archival',
  DEFAULT_PORT: 8080,
  DEFAULT_DOCS_PORT: 8081,
  MAX_PAGINATION_LIMIT: 100,
  DEFAULT_PAGINATION_LIMIT: 50,
  DEFAULT_PAGINATION_OFFSET: 0,
  DEFAULT_API_TIMEOUT: 30000,
  DEFAULT_DB_TIMEOUT: 2000,
  DEFAULT_HEALTH_CHECK_TIMEOUT: 5000,
};

export const DB_CONFIG = {
  WRITE_POOL: {
    MAX: 20,
    MIN: 5,
    IDLE_TIMEOUT: 30000,
    CONNECTION_TIMEOUT: 2000,
    ACQUIRE_TIMEOUT: 10000,
  },
  
  READ_POOL: {
    MAX: 50,
    MIN: 10,
    IDLE_TIMEOUT: 30000,
    CONNECTION_TIMEOUT: 2000,
    ACQUIRE_TIMEOUT: 10000,
  },
  
  HEALTH_CHECK: {
    INTERVAL: 30000,
    TIMEOUT: 5000,
    RETRIES: 3,
  },
  
  CONSISTENCY: {
    MAX_LAG_SECONDS: 5,
    READ_AFTER_WRITE_DELAY: 1000,
  },
  
  APP_NAMES: {
    WRITE: 'payment-service-write',
    READ: 'payment-service-read',
  },
};

export const ARCHIVAL_CONFIG = {
  PERFORMANCE: {
    THRESHOLD: 49999,
    ARCHIVE_COUNT: 20000,
  },
  
  RETENTION: {
    COMPLIANCE: 1,
    REPORTS: 7,
  },
  
  STATUS: {
    ENABLED: 'true',
    DISABLED: 'false',
  },
  
  CONFIG_KEYS: {
    ENABLED: 'archival_enabled',
    PERFORMANCE_THRESHOLD: 'performance_threshold',
    PERFORMANCE_ARCHIVE_COUNT: 'performance_archive_count',
    COMPLIANCE_RETENTION: 'compliance_retention_years',
    REPORTS_RETENTION: 'reports_retention_years',
    LAST_PERFORMANCE_ARCHIVAL: 'last_performance_archival',
    LAST_COMPLIANCE_ARCHIVAL: 'last_compliance_archival',
    LAST_REPORTS_GENERATION: 'last_reports_generation',
  },
};

export const PAYMENT_CONFIG = {
  STATUS: {
    PENDING: 'PENDING',
    AUTHORIZED: 'AUTHORIZED',
    SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED',
    REFUNDED: 'REFUNDED',
    PARTIALLY_REFUNDED: 'PARTIALLY_REFUNDED',
    CANCELLED: 'CANCELLED',
  },
  
  CLOSED_STATUSES: [
    'SUCCEEDED',
    'FAILED',
    'CANCELLED',
    'REFUNDED',
    'PARTIALLY_REFUNDED'
  ],
  
  CURRENCY: {
    LENGTH: 3,
    PATTERN: /^[A-Z]{3}$/,
  },
  
  AMOUNT: {
    MIN: 1,
  },
  
  IDEMPOTENCY: {
    PREFIX: 'payment',
    RETRY_PREFIX: 'retry',
    SEPARATOR: '-',
  },
};

export const REFUND_CONFIG = {
  STATUS: {
    PENDING: 'PENDING',
    SUCCEEDED: 'SUCCEEDED',
    FAILED: 'FAILED',
  },
  
  CLOSED_STATUSES: [
    'SUCCEEDED',
    'FAILED'
  ],
  
  IDEMPOTENCY: {
    PREFIX: 'refund',
    SEPARATOR: '-',
  },
};

export const API_CONFIG = {
  RESPONSE: {
    SUCCESS: 'success',
    ERROR: 'error',
  },
  
  ERROR_CODES: {
    VALIDATION_ERROR: 'VALIDATION_ERROR',
    PAYMENT_NOT_FOUND: 'PAYMENT_NOT_FOUND',
    PAYMENT_CREATION_FAILED: 'PAYMENT_CREATION_FAILED',
    PAYMENT_UPDATE_FAILED: 'PAYMENT_UPDATE_FAILED',
    REFUND_NOT_FOUND: 'REFUND_NOT_FOUND',
    REFUND_CREATION_FAILED: 'REFUND_CREATION_FAILED',
    INTERNAL_ERROR: 'INTERNAL_ERROR',
    SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  },
  
  STATUS_CODES: {
    OK: 200,
    CREATED: 201,
    BAD_REQUEST: 400,
    UNAUTHORIZED: 401,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    CONFLICT: 409,
    UNPROCESSABLE_ENTITY: 422,
    TOO_MANY_REQUESTS: 429,
    INTERNAL_SERVER_ERROR: 500,
    BAD_GATEWAY: 502,
    SERVICE_UNAVAILABLE: 503,
    GATEWAY_TIMEOUT: 504,
  },
  
  HEADERS: {
    CORRELATION_ID: 'X-Correlation-ID',
    IDEMPOTENCY_KEY: 'Idempotency-Key',
    CONTENT_TYPE: 'Content-Type',
    AUTHORIZATION: 'Authorization',
  },
};

export const TEST_CONFIG = {
  LOAD_TEST: {
    DEFAULT_REQUESTS: 50000,
    DEFAULT_BATCH_SIZE: 1000,
    DEFAULT_CONCURRENCY: 10,
    DEFAULT_TIMEOUT: 30000,
  },
  
  TEST_DATA: {
    USER_ID: '550e8400-e29b-41d4-a716-446655440000',
    ORDER_ID_PREFIX: 'test-order',
    PAYMENT_ID_PREFIX: 'test-payment',
    REFUND_ID_PREFIX: 'test-refund',
    IDEMPOTENCY_PREFIX: 'test',
  },
  
  PERFORMANCE: {
    MIN_REQUESTS_PER_SECOND: 100,
    MAX_EXECUTION_TIME: 300000,
    MIN_SUCCESS_RATE: 0.95,
  },
};

export const LOG_CONFIG = {
  LEVELS: {
    ERROR: 'error',
    WARN: 'warn',
    INFO: 'info',
    DEBUG: 'debug',
  },
  
  DEFAULTS: {
    LEVEL: 'info',
    FILE: 'payment-service.log',
  },
  
  CATEGORIES: {
    DATABASE: 'database',
    API: 'api',
    ARCHIVAL: 'archival',
    PERFORMANCE: 'performance',
    SECURITY: 'security',
  },
};

export const RABBITMQ_CONFIG = {
  DEFAULTS: {
    HOST: 'localhost',
    PORT: 5672,
    USER: 'guest',
    PASS: 'guest',
    VHOST: '/',
  },
  
  EXCHANGE: {
    NAME: 'payment_events',
    TYPE: 'topic',
    DURABLE: true,
  },
  
  TOPICS: {
    PAYMENT_INITIATED: 'payment_initiated',
    PAYMENT_COMPLETED: 'payment_completed',
    PAYMENT_FAILED: 'payment_failed',
    REFUND_PROCESSED: 'refund_processed',
  },
  
  CONNECTION: {
    RETRIES: 5,
    RETRY_DELAY: 1000,
  },
};

export const MONITORING_CONFIG = {
  METRICS: {
    DEFAULT_PORT: 9090,
    DEFAULT_INTERVAL: 30000,
  },
  
  HEALTH_CHECK: {
    DEFAULT_INTERVAL: 30000,
    DEFAULT_TIMEOUT: 5000,
  },
  
  ALERTS: {
    CRITICAL: {
      DATA_INTEGRITY_FAILURES: 0,
      STORAGE_USAGE: 90,
      QUERY_PERFORMANCE_DEGRADATION: 5,
    },
    WARNING: {
      ARCHIVAL_DURATION: 300000,
      STORAGE_GROWTH_RATE: 15,
      INDEX_USAGE: 50,
      REPLICATION_LAG: 30,
    },
  },
};

export const FEATURE_FLAGS = {
  ENABLE_ARCHIVAL: 'ENABLE_ARCHIVAL',
  ENABLE_PARTITIONING: 'ENABLE_PARTITIONING',
  ENABLE_READ_REPLICA: 'ENABLE_READ_REPLICA',
  ENABLE_RETRY_LOGIC: 'ENABLE_RETRY_LOGIC',
  ENABLE_METRICS: 'ENABLE_METRICS',
  ENABLE_HEALTH_CHECKS: 'ENABLE_HEALTH_CHECKS',
};

export const SECURITY_CONFIG = {
  UUID_PATTERN: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  
  PASSWORD: {
    MIN_LENGTH: 8,
    REQUIRE_UPPERCASE: true,
    REQUIRE_LOWERCASE: true,
    REQUIRE_NUMBERS: true,
    REQUIRE_SYMBOLS: true,
  },
  
  TOKEN: {
    DEFAULT_EXPIRY: 3600,
    REFRESH_EXPIRY: 86400,
  },
};

export default {
  APP_CONFIG,
  DB_CONFIG,
  ARCHIVAL_CONFIG,
  PAYMENT_CONFIG,
  REFUND_CONFIG,
  API_CONFIG,
  TEST_CONFIG,
  LOG_CONFIG,
  RABBITMQ_CONFIG,
  MONITORING_CONFIG,
  FEATURE_FLAGS,
  SECURITY_CONFIG,
};
