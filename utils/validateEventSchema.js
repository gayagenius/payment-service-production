import Ajv from "ajv";
import addFormats from "ajv-formats";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize AJV
const ajv = new Ajv({
  allErrors: true,
  removeAdditional: true,
  useDefaults: true,
  coerceTypes: false,
  strict: true,
});
addFormats(ajv);

// Schema cache
const schemaCache = new Map();

// Load schemas
const SCHEMA_DIR = join(__dirname, "../messaging/schemas/paymentEvents");

/**
 * Load a JSON schema from file
 */
function loadSchema(schemaPath) {
  try {
    const schemaContent = readFileSync(schemaPath, "utf8");
    return JSON.parse(schemaContent);
  } catch (error) {
    throw new Error(
      `Failed to load schema from ${schemaPath}: ${error.message}`
    );
  }
}

/**
 * Load all payment event schemas
 */
function loadPaymentEventSchemas() {
  const schemas = {
    payment_initiated: loadSchema(join(SCHEMA_DIR, "paymentInitiated.json")),
    payment_succeeded: {
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: "payment-succeeded-v1",
      type: "object",
      required: ["eventType", "payload", "metadata"],
      properties: {
        eventType: { const: "payment_succeeded" },
        payload: { type: "object" },
        metadata: { type: "object" },
      },
      additionalProperties: true,
    },

    payment_completed: {
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: "payment-completed-v1",
      type: "object",
      required: [
        "eventType",
        "timestamp",
        "paymentId",
        "orderId",
        "userId",
        "amount",
        "currency",
        "status",
        "correlationId",
      ],
      properties: {
        eventType: { type: "string", const: "payment_completed" },
        timestamp: { type: "string", format: "date-time" },
        paymentId: { type: "string", pattern: "^pay_[a-zA-Z0-9]+$" },
        orderId: { type: "string", pattern: "^ord_[a-zA-Z0-9]+$" },
        userId: { type: "string", pattern: "^user_[a-zA-Z0-9]+$" },
        amount: { type: "integer", minimum: 1 },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
        status: { type: "string", const: "succeeded" },
        correlationId: { type: "string", minLength: 10 },
        gatewayResponse: {
          type: "object",
          properties: {
            transactionId: { type: "string" },
            processingTime: { type: "integer", minimum: 0 },
            authCode: { type: "string" },
          },
        },
        fees: {
          type: "object",
          properties: {
            platformFee: { type: "integer", minimum: 0 },
            gatewayFee: { type: "integer", minimum: 0 },
          },
        },
      },
      additionalProperties: false,
    },
    payment_failed: {
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: "payment-failed-v1",
      type: "object",
      required: [
        "eventType",
        "timestamp",
        "paymentId",
        "orderId",
        "userId",
        "amount",
        "currency",
        "status",
        "correlationId",
        "error",
      ],
      properties: {
        eventType: { type: "string", const: "payment_failed" },
        timestamp: { type: "string", format: "date-time" },
        paymentId: { type: "string", pattern: "^pay_[a-zA-Z0-9]+$" },
        orderId: { type: "string", pattern: "^ord_[a-zA-Z0-9]+$" },
        userId: { type: "string", pattern: "^user_[a-zA-Z0-9]+$" },
        amount: { type: "integer", minimum: 1 },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
        status: { type: "string", const: "failed" },
        correlationId: { type: "string", minLength: 10 },
        error: {
          type: "object",
          required: ["code", "message"],
          properties: {
            code: { type: "string" },
            message: { type: "string" },
            declineCode: { type: "string" },
            gatewayCode: { type: "string" },
          },
        },
        retryable: { type: "boolean" },
        attemptCount: { type: "integer", minimum: 1 },
      },
      additionalProperties: false,
    },
    refund_processed: {
      $schema: "http://json-schema.org/draft-07/schema#",
      $id: "refund-processed-v1",
      type: "object",
      required: [
        "eventType",
        "timestamp",
        "refundId",
        "paymentId",
        "orderId",
        "userId",
        "amount",
        "currency",
        "status",
        "correlationId",
      ],
      properties: {
        eventType: { type: "string", const: "refund_processed" },
        timestamp: { type: "string", format: "date-time" },
        refundId: { type: "string", pattern: "^ref_[a-zA-Z0-9]+$" },
        paymentId: { type: "string", pattern: "^pay_[a-zA-Z0-9]+$" },
        orderId: { type: "string", pattern: "^ord_[a-zA-Z0-9]+$" },
        userId: { type: "string", pattern: "^user_[a-zA-Z0-9]+$" },
        amount: { type: "integer", minimum: 1 },
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
        status: { type: "string", const: "succeeded" },
        correlationId: { type: "string", minLength: 10 },
        reason: { type: "string", maxLength: 500 },
        refundType: { type: "string", enum: ["full", "partial"] },
        gatewayResponse: {
          type: "object",
          properties: {
            refundId: { type: "string" },
            processingTime: { type: "integer", minimum: 0 },
          },
        },
        originalPayment: {
          type: "object",
          properties: {
            amount: { type: "integer", minimum: 1 },
            date: { type: "string", format: "date-time" },
          },
        },
      },
      additionalProperties: false,
    },
  };

  // Compile and cache schemas
  for (const [eventType, schema] of Object.entries(schemas)) {
    try {
      const schemaId = schema.$id || schema.id;
      if (!ajv.getSchema(schemaId)) {
        const compiledSchema = ajv.compile(schema);
        schemaCache.set(eventType, compiledSchema);
        console.log(`Loaded schema for event type: ${eventType}`);
      } else {
        schemaCache.set(eventType, ajv.getSchema(schemaId));
        console.log(`Schema already loaded for event type: ${eventType}`);
      }
    } catch (error) {
      console.error(`Failed to compile schema for ${eventType}:`, error);
      throw error;
    }
  }
}

/**
 * Validate event payload against schema
 */
export function validateEventSchema(eventType, payload) {
  const validator = schemaCache.get(eventType);

  if (!validator) {
    throw new Error(`No schema found for event type: ${eventType}`);
  }

  const isValid = validator(payload);

  if (!isValid) {
    return {
      valid: false,
      errors: validator.errors.map((error) => ({
        field: error.instancePath || error.schemaPath,
        message: error.message,
        rejectedValue: error.data,
        constraint: error.params,
      })),
    };
  }

  return { valid: true, errors: [] };
}

/**
 * Middleware to validate incoming events
 */
export function createSchemaValidationMiddleware(eventType) {
  return (req, res, next) => {
    const validation = validateEventSchema(eventType, req.body);

    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: {
          code: "SCHEMA_VALIDATION_ERROR",
          message: "Event payload does not match required schema",
          details: validation.errors,
        },
        timestamp: new Date().toISOString(),
      });
    }

    next();
  };
}

/**
 * Validate event with detailed error reporting
 */
export function validateEventWithDetails(eventType, payload) {
  const validation = validateEventSchema(eventType, payload);

  if (!validation.valid) {
    const errorDetails = {
      eventType,
      timestamp: new Date().toISOString(),
      validationErrors: validation.errors,
      payload: JSON.stringify(payload, null, 2),
    };

    console.error("Schema validation failed:", errorDetails);

    return {
      valid: false,
      errorDetails,
      summary: `${validation.errors.length} validation error(s) for ${eventType}`,
    };
  }

  return { valid: true };
}

/**
 * Get schema for an event type
 */
export function getEventSchema(eventType) {
  const validator = schemaCache.get(eventType);
  return validator ? validator.schema : null;
}

/**
 * List all available event types
 */
export function getAvailableEventTypes() {
  return Array.from(schemaCache.keys());
}

/**
 * Initialize schema validation
 */
export function initializeSchemaValidation() {
  try {
    loadPaymentEventSchemas();
    console.log(
      `Initialized schema validation for ${schemaCache.size} event types`
    );
    return true;
  } catch (error) {
    console.error("Failed to initialize schema validation:", error);
    throw error;
  }
}

/**
 * Schema migration helper
 */
export class SchemaMigrator {
  constructor() {
    this.migrations = new Map();
  }

  /**
   * Register a migration function
   */
  registerMigration(fromVersion, toVersion, migrationFn) {
    const key = `${fromVersion}->${toVersion}`;
    this.migrations.set(key, migrationFn);
  }

  /**
   * Migrate payload from one version to another
   */
  migrate(payload, fromVersion, toVersion) {
    const key = `${fromVersion}->${toVersion}`;
    const migrationFn = this.migrations.get(key);

    if (!migrationFn) {
      throw new Error(
        `No migration available from ${fromVersion} to ${toVersion}`
      );
    }

    try {
      return migrationFn(payload);
    } catch (error) {
      throw new Error(
        `Migration failed from ${fromVersion} to ${toVersion}: ${error.message}`
      );
    }
  }
}

// Initialize schemas on module load
initializeSchemaValidation();
