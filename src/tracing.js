// src/tracing.js
import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { trace } from '@opentelemetry/api';  // 👈 missing import added

// Configure OTLP exporter → Grafana Tempo (or OTLP endpoint)
const traceExporter = new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4322/v1/traces',
  headers: {}, // optional → add auth headers if needed
});

// Create the OpenTelemetry SDK
const sdk = new NodeSDK({
  traceExporter,
  instrumentations: [
    new HttpInstrumentation(),
    new ExpressInstrumentation(),
  ],
});

// Start the SDK (synchronous in v2.x)
sdk.start();
console.log('✅ OpenTelemetry tracing initialized (v2.x, OTLP → Tempo)');

// Graceful shutdown when process exits
process.on('SIGTERM', async () => {
  try {
    await sdk.shutdown();
    console.log('Tracing terminated');
  } catch (err) {
    console.error('Error terminating tracing', err);
  } finally {
    process.exit(0);
  }
});

// 👇 Export a tracer instance for manual spans
export const tracer = trace.getTracer('payment-service');
