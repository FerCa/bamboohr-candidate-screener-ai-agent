// src/config/loader.ts
// Loads config.yaml from disk, parses YAML, validates with Zod.
// Exits process with code 1 and a clear error message on any failure.
// CONF-01: Fail-fast before any BambooHR API call.
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { configSchema } from './schema.js';
import type { Config } from './schema.js';
import { ConfigError } from './errors.js';

export function loadConfig(configPath: string): Config {
  // Step 1: Read YAML from disk
  let raw: unknown;
  try {
    const fileContent = readFileSync(configPath, 'utf8');
    // yaml.load() is safe in js-yaml v4 (yaml.safeLoad was removed)
    raw = yaml.load(fileContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(
      `Failed to read or parse config file "${configPath}": ${message}`,
    );
  }

  // Step 1b: Backward-compatible normalization — legacy single-job shape → jobs array (D-02, CONF-07)
  // Detects `job:` key without `jobs:` key and silently promotes to multi-job array.
  // No warning emitted — the internal Config type always uses the normalized shape.
  if (
    raw !== null &&
    typeof raw === 'object' &&
    'job' in raw &&
    !('jobs' in raw)
  ) {
    const r = raw as Record<string, unknown>;
    raw = {
      jobs: [{
        openingId: (r['job'] as Record<string, unknown>)['openingId'],
        stages:    (r['job'] as Record<string, unknown>)['stages'],
        hardRules: r['hardRules'],
        fieldMap:  r['fieldMap'],
        softRules: r['softRules'],
      }],
    };
  }

  // Step 2: Validate schema with Zod safeParse
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const details = JSON.stringify(result.error.format(), null, 2);
    throw new ConfigError(
      `Invalid configuration in "${configPath}":\n${details}`,
    );
  }

  return result.data;
}

// CONF-04: Dry-run flag helper — used by index.ts and write paths in Phase 4.
// Returns true unless LIVE_MODE=true is explicitly set.
export function isDryRun(): boolean {
  return process.env['LIVE_MODE'] !== 'true';
}
