// src/index.ts
// Entry point for the BambooHR Candidate Screener (post-Phase-6 thin wiring).
// Responsibilities (D-01):
//   1. Load .env (dotenv MUST be the first import — loads before any env var read).
//   2. Load + validate config (throws ConfigError on failure — D-08, D-09).
//   3. Read credentials from env vars (CONF-03 — never from config).
//   4. Construct injected dependencies (Phase-5 success criterion #3).
//   5. Hand off to MultiJobOrchestrator.run().
//   6. Catch named errors at the top level — single allowed process.exit point (D-08).

// dotenv/config MUST be the first import — it loads .env BEFORE any env var reads
import 'dotenv/config';

import { loadConfig, isDryRun } from './config/loader.js';
import { ConfigError } from './config/errors.js';
import { BambooHRClient } from './bamboohr/client.js';
import { StageValidationError } from './bamboohr/errors.js';
import { JsonLogger } from './logger/logger.js';
import { SoftEvaluator } from './agent/evaluator.js';
import { LiveModeWriter } from './pipeline/live-mode-writer.js';
import { MultiJobOrchestrator } from './screener/multi-job-orchestrator.js';

async function main(): Promise<void> {
  // CONF-01: loadConfig throws ConfigError on YAML or schema failure (D-08)
  const configPath = process.env['CONFIG_PATH'] ?? './config.yaml';
  const config = loadConfig(configPath);
  console.error(`[main] Config: ${configPath}`);

  // CONF-03: credentials via env vars only — never in config or code
  const apiKey = process.env['BAMBOOHR_API_KEY'];
  const subdomain = process.env['BAMBOOHR_SUBDOMAIN'];
  const openaiApiKey = process.env['OPENAI_API_KEY'];

  const missingVars = [
    !apiKey && 'BAMBOOHR_API_KEY',
    !subdomain && 'BAMBOOHR_SUBDOMAIN',
    !openaiApiKey && 'OPENAI_API_KEY',
  ].filter(Boolean);

  if (missingVars.length > 0) {
    console.error(
      `[main] Missing required environment variables: ${missingVars.join(', ')}`,
    );
    console.error('[main] Copy .env.example to .env and fill in your credentials.');
    process.exit(1);
  }

  // Construct dependencies — order matters: leaf first, orchestrator last.
  const bambooHrClient = new BambooHRClient(subdomain!, apiKey!);
  const softEvaluator = new SoftEvaluator();
  const jsonLogger = new JsonLogger();
  const liveWriter = new LiveModeWriter(bambooHrClient);
  const dryRun = isDryRun();
  const orchestrator = new MultiJobOrchestrator(
    bambooHrClient,
    softEvaluator,
    jsonLogger,
    liveWriter,
    config,
    dryRun,
  );

  await orchestrator.run();
}

main().catch((err) => {
  // D-08, D-09: Named errors get a clean message; everything else falls through.
  if (err instanceof ConfigError || err instanceof StageValidationError) {
    console.error(`[main] ${err.message}`);
  } else {
    console.error(
      '[main] Fatal error:',
      err instanceof Error ? err.message : String(err),
    );
  }
  process.exit(1);
});
