import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { load as yamlLoad } from 'js-yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('OpenAPI spec', () => {
  const specPath = path.resolve(__dirname, '..', 'api', 'openapi.yaml');

  it('exists, parses as YAML, and has minimal OpenAPI 3 structure', () => {
    // Exists
    expect(fs.existsSync(specPath)).toBe(true);

    // Non-empty
    const raw = fs.readFileSync(specPath, 'utf8');
    expect(raw.length).toBeGreaterThan(0);

    // Parses
    const doc = yamlLoad(raw) as any;
    expect(doc && typeof doc).toBe('object');

    // Minimal required keys
    expect(typeof doc.openapi).toBe('string');
    expect(doc.openapi.startsWith('3.')).toBe(true);

    expect(doc.info && typeof doc.info).toBe('object');
    expect(typeof doc.info.title).toBe('string');

    expect(doc.paths && typeof doc.paths).toBe('object');
  });
});
