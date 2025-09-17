import { Command } from 'commander';
import { connect } from '../messaging/queueSetup.js';
import DLQManager from '../messaging/dlqSetUp.js';
import { validateEventSchema } from '../utils/validateEventSchema.js';
import { writeFileSync } from 'fs';
import { join } from 'path';

const program = new Command();

// Audit log file
const AUDIT_LOG_FILE = join(process.cwd(), 'logs', 'dlq-redrive-audit.log');

/**
 * Write audit log entry
 */
function writeAuditLog(entry) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    ...entry
  };
  
  try {
    const logLine = JSON.stringify(logEntry) + '\n';
    writeFileSync(AUDIT_LOG_FILE, logLine, { flag: 'a' });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

/**
 * Safety checks before redriving
 */
async function performSafetyChecks(dlqManager, options) {
  const checks = {
    queueDepth: false,
    timeWindow: false,
    userConfirmation: false
  };

  // Check queue depth
  const stats = await dlqManager.getStats();
  if (stats.messageCount > options.maxMessages) {
    console.error(`Queue depth (${stats.messageCount}) exceeds safety limit (${options.maxMessages})`);
    return false;
  }
  checks.queueDepth = true;

  // Check time window to prevent accidental redrives 
  const currentHour = new Date().getHours();
  if (options.restrictHours && !options.restrictHours.includes(currentHour)) {
    console.error(`Current time (${currentHour}:00) is outside allowed hours: ${options.restrictHours}`);
    return false;
  }
  checks.timeWindow = true;

  // User confirmation for production
  if (process.env.NODE_ENV === 'production' && !options.force) {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    });

    const answer = await new Promise(resolve => {
      readline.question(`Are you sure you want to redrive ${stats.messageCount} messages in PRODUCTION? (yes/no): `, resolve);
    });
    readline.close();

    if (answer.toLowerCase() !== 'yes') {
      console.log('Operation cancelled by user');
      return false;
    }
  }
  checks.userConfirmation = true;

  writeAuditLog({
    action: 'safety_checks_passed',
    checks,
    queueStats: stats,
    options
  });

  return true;
}

/**
 * Peek command - view messages without consuming
 */
program
  .command('peek')
  .description('Peek at messages in the DLQ without consuming them')
  .option('-l, --limit <number>', 'Number of messages to peek at', '10')
  .option('-o, --output <file>', 'Output file for messages (JSON)')
  .action(async (options) => {
    try {
      console.log('Connecting to RabbitMQ...');
      const connection = await connect();
      const dlqManager = new DLQManager(connection);
      await dlqManager.initialize();

      console.log(`Peeking at ${options.limit} messages...`);
      const messages = await dlqManager.peekMessages(parseInt(options.limit));

      console.log(`Found ${messages.length} messages:`);
      
      messages.forEach((msg, index) => {
        console.log(`\n--- Message ${index + 1} ---`);
        console.log(`Event Type: ${msg.content.eventType || 'unknown'}`);
        console.log(`Timestamp: ${msg.properties.timestamp}`);
        console.log(`Correlation ID: ${msg.properties.correlationId}`);
        console.log(`Content: ${JSON.stringify(msg.content, null, 2)}`);
      });

      if (options.output) {
        writeFileSync(options.output, JSON.stringify(messages, null, 2));
        console.log(`\nMessages saved to: ${options.output}`);
      }

      writeAuditLog({
        action: 'peek_dlq',
        messagesFound: messages.length,
        limit: options.limit,
        outputFile: options.output
      });

      await dlqManager.close();
      process.exit(0);

    } catch (error) {
      console.error('Failed to peek DLQ:', error);
      process.exit(1);
    }
  });

/**
 * Stats command - get DLQ statistics
 */
program
  .command('stats')
  .description('Get DLQ statistics')
  .action(async () => {
    try {
      console.log('Connecting to RabbitMQ...');
      const connection = await connect();
      const dlqManager = new DLQManager(connection);
      await dlqManager.initialize();

      const stats = await dlqManager.getStats();
      
      console.log('\n=== DLQ Statistics ===');
      console.log(`Queue Name: ${stats.queue}`);
      console.log(`Message Count: ${stats.messageCount}`);
      console.log(`Consumer Count: ${stats.consumerCount}`);
      console.log(`Exchange: ${stats.exchange}`);
      console.log(`Timestamp: ${stats.timestamp}`);

      await dlqManager.close();
      process.exit(0);

    } catch (error) {
      console.error('Failed to get DLQ stats:', error);
      process.exit(1);
    }
  });

/**
 * Redrive command - reprocess messages from DLQ
 */
program
  .command('redrive')
  .description('Redrive messages from the DLQ back to original queues')
  .option('-l, --limit <number>', 'Maximum number of messages to redrive', '100')
  .option('-d, --dry-run', 'Perform a dry run without actually redriving messages')
  .option('-f, --filter <filter>', 'JSON filter criteria for messages to redrive')
  .option('-t, --target-exchange <exchange>', 'Target exchange for redriven messages', 'payment_events')
  .option('--max-messages <number>', 'Safety limit for max messages', '1000')
  .option('--restrict-hours <hours>', 'Comma-separated list of allowed hours (0-23)')
  .option('--force', 'Skip confirmation prompts (dangerous in production)')
  .action(async (options) => {
    try {
      console.log('Starting DLQ redrive operation...');
      
      // Parse options
      const limit = parseInt(options.limit);
      const maxMessages = parseInt(options.maxMessages);
      const restrictHours = options.restrictHours ? 
        options.restrictHours.split(',').map(h => parseInt(h)) : null;
      
      let filterFn = null;
      if (options.filter) {
        try {
          const filterCriteria = JSON.parse(options.filter);
          filterFn = (content, msg) => {
            // Simple filter implementation - can be extended
            for (const [key, value] of Object.entries(filterCriteria)) {
              if (content[key] !== value) return false;
            }
            return true;
          };
        } catch (error) {
          console.error('Invalid filter JSON:', error);
          process.exit(1);
        }
      }

      console.log('Connecting to RabbitMQ...');
      const connection = await connect();
      const dlqManager = new DLQManager(connection);
      await dlqManager.initialize();

      // Perform safety checks
      const safetyOptions = {
        maxMessages,
        restrictHours,
        force: options.force
      };
      
      const safetyPassed = await performSafetyChecks(dlqManager, safetyOptions);
      if (!safetyPassed) {
        console.error('Safety checks failed. Aborting operation.');
        process.exit(1);
      }

      console.log(`${options.dryRun ? '[DRY RUN] ' : ''}Redriving up to ${limit} messages...`);
      
      const redriveOptions = {
        maxMessages: limit,
        filterFn,
        targetExchange: options.targetExchange,
        dryRun: options.dryRun
      };

      const results = await dlqManager.reprocessMessages(redriveOptions);

      console.log('\n=== Redrive Results ===');
      console.log(`Processed: ${results.processed}`);
      console.log(`Successfully Requeued: ${results.requeued}`);
      console.log(`Failed: ${results.failed}`);
      console.log(`Skipped: ${results.skipped}`);

      if (results.errors.length > 0) {
        console.log('\nErrors encountered:');
        results.errors.forEach((error, index) => {
          console.log(`${index + 1}. ${error.messageId}: ${error.error}`);
        });
      }

      // Write detailed audit log
      writeAuditLog({
        action: 'redrive_dlq',
        results,
        options: redriveOptions,
        safetyOptions,
        environment: process.env.NODE_ENV || 'development'
      });

      await dlqManager.close();
      
      if (results.failed > 0) {
        console.error(`Operation completed with ${results.failed} failures`);
        process.exit(1);
      }
      
      console.log('Redrive operation completed successfully');
      process.exit(0);

    } catch (error) {
      console.error('Redrive operation failed:', error);
      
      writeAuditLog({
        action: 'redrive_dlq_failed',
        error: error.message,
        stack: error.stack
      });
      
      process.exit(1);
    }
  });

/**
 * Validate command - validate messages in DLQ against schemas
 */
program
  .command('validate')
  .description('Validate messages in DLQ against event schemas')
  .option('-l, --limit <number>', 'Number of messages to validate', '50')
  .option('-r, --report <file>', 'Generate validation report file')
  .action(async (options) => {
    try {
      console.log('Connecting to RabbitMQ...');
      const connection = await connect();
      const dlqManager = new DLQManager(connection);
      await dlqManager.initialize();

      console.log(`Validating ${options.limit} messages...`);
      const messages = await dlqManager.peekMessages(parseInt(options.limit));

      const validationResults = {
        total: messages.length,
        valid: 0,
        invalid: 0,
        errors: []
      };

      for (const [index, msg] of messages.entries()) {
        try {
          const eventType = msg.content.eventType;
          if (!eventType) {
            validationResults.invalid++;
            validationResults.errors.push({
              messageIndex: index,
              error: 'Missing eventType field'
            });
            continue;
          }

          const validation = validateEventSchema(eventType, msg.content);
          
          if (validation.valid) {
            validationResults.valid++;
          } else {
            validationResults.invalid++;
            validationResults.errors.push({
              messageIndex: index,
              eventType,
              messageId: msg.properties.messageId,
              validationErrors: validation.errors
            });
          }
          
        } catch (error) {
          validationResults.invalid++;
          validationResults.errors.push({
            messageIndex: index,
            error: error.message
          });
        }
      }

      console.log('\n=== Validation Results ===');
      console.log(`Total Messages: ${validationResults.total}`);
      console.log(`Valid: ${validationResults.valid}`);
      console.log(`Invalid: ${validationResults.invalid}`);
      console.log(`Success Rate: ${((validationResults.valid / validationResults.total) * 100).toFixed(2)}%`);

      if (validationResults.invalid > 0) {
        console.log('\nValidation Errors:');
        validationResults.errors.slice(0, 10).forEach((error, index) => {
          console.log(`${index + 1}. Message ${error.messageIndex}: ${error.error || 'Schema validation failed'}`);
        });
        
        if (validationResults.errors.length > 10) {
          console.log(`... and ${validationResults.errors.length - 10} more errors`);
        }
      }

      if (options.report) {
        writeFileSync(options.report, JSON.stringify(validationResults, null, 2));
        console.log(`\nDetailed validation report saved to: ${options.report}`);
      }

      writeAuditLog({
        action: 'validate_dlq',
        results: validationResults,
        limit: options.limit,
        reportFile: options.report
      });

      await dlqManager.close();
      process.exit(0);

    } catch (error) {
      console.error('Validation failed:', error);
      process.exit(1);
    }
  });

/**
 * remove all messages from DLQ 
 */
program
  .command('purge')
  .description('DANGER: Remove all messages from the DLQ')
  .option('--confirm', 'Required confirmation flag')
  .action(async (options) => {
    try {
      if (!options.confirm) {
        console.error('This operation will permanently delete all messages in the DLQ!');
        console.error('Use --confirm flag if you are absolutely sure.');
        process.exit(1);
      }

      if (process.env.NODE_ENV === 'production') {
        const readline = require('readline').createInterface({
          input: process.stdin,
          output: process.stdout
        });

        const answer = await new Promise(resolve => {
          readline.question('THIS WILL PERMANENTLY DELETE ALL DLQ MESSAGES IN PRODUCTION! Type "DELETE ALL" to confirm: ', resolve);
        });
        readline.close();

        if (answer !== 'DELETE ALL') {
          console.log('Operation cancelled');
          process.exit(0);
        }
      }

      console.log('Connecting to RabbitMQ...');
      const connection = await connect();
      const dlqManager = new DLQManager(connection);
      await dlqManager.initialize();

      const result = await dlqManager.purgeQueue(true);
      
      console.log(`Purged ${result.purgedCount} messages from DLQ`);
      
      writeAuditLog({
        action: 'purge_dlq',
        purgedCount: result.purgedCount,
        environment: process.env.NODE_ENV || 'development',
        dangerous: true
      });

      await dlqManager.close();
      process.exit(0);

    } catch (error) {
      console.error('Purge operation failed:', error);
      process.exit(1);
    }
  });

program
  .version('1.0.0')
  .description('DLQ Management Tool for Payment Service');

program.parse(process.argv);

if (program.args.length === 0) {
  program.help();
}