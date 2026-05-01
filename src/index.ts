// src/index.ts
// Entry point for the BambooHR Candidate Screener.
// Startup sequence: dotenv → loadConfig → BambooHR startup checks → candidate loop.
// DRY_RUN=true is default (CONF-04); no writes in Phase 1.

// D-11: dotenv/config MUST be the first import — loads .env before any env var reads
import 'dotenv/config';

import { loadConfig, isDryRun } from './config/loader.js';
import { BambooHRClient } from './bamboohr/client.js';
import { evaluateHardRules } from './rules/evaluator.js';
import { logDecision } from './logger/logger.js';

async function main(): Promise<void> {
  // --- Step 1: Load and validate config ---
  // CONF-01: loadConfig() exits with code 1 if config is invalid.
  // Credentials are NOT in config — they come from env vars below.
  const configPath = process.env['CONFIG_PATH'] ?? './config.yaml';
  const config = loadConfig(configPath);

  // --- Step 2: Read credentials from env vars ---
  // CONF-03: Credentials via env vars only — never in config or code.
  const apiKey = process.env['BAMBOOHR_API_KEY'];
  const subdomain = process.env['BAMBOOHR_SUBDOMAIN'];

  if (!apiKey || !subdomain) {
    console.error('[main] Missing required environment variables: BAMBOOHR_API_KEY, BAMBOOHR_SUBDOMAIN');
    console.error('[main] Copy .env.example to .env and fill in your credentials.');
    process.exit(1);
  }

  // CONF-04: Dry-run mode logged at startup so every run is self-documenting.
  const dryRun = isDryRun();
  console.error(`[main] Mode: ${dryRun ? 'DRY_RUN (no writes)' : 'LIVE MODE — writes enabled'}`);
  console.error(`[main] Config: ${configPath}`);
  console.error(`[main] Job opening: ${config.job.openingId}`);

  // --- Step 3: Connect to BambooHR and run startup checks ---
  const client = new BambooHRClient(subdomain, apiKey);

  // CONF-02: Validate that configured stage names exist in the live API.
  // validateStages() exits with code 1 if any stage name is not found.
  console.error('[main] Validating pipeline stages against BambooHR...');
  await client.validateStages(config);
  console.error('[main] Pipeline stages validated.');

  // --- Step 4: Fetch candidates in the "New" stage ---
  // The statusId for "New" must be resolved by matching the configured stage name
  // against the live statuses. For Phase 1, we fetch the statuses again to get the ID.
  // (In production, validateStages could return the resolved IDs — Phase 4 optimization.)
  const statuses = await client.get<Array<{ id: number; name: string }>>(
    '/applicant_tracking/statuses',
  );
  const newStatus = statuses.find((s) => s.name === 'New');
  if (!newStatus) {
    console.error('[main] No "New" pipeline stage found in BambooHR. Cannot fetch candidates.');
    process.exit(1);
  }

  console.error(`[main] Fetching candidates from stage: New (id=${newStatus.id})`);
  const candidates = await client.fetchCandidates(
    config.job.openingId,
    String(newStatus.id),
  );
  console.error(`[main] Found ${candidates.length} candidate(s) in "New" stage.`);

  // --- Step 5: Process each candidate ---
  // SAFE-01: Per-candidate try/catch — one failure does not abort the run.
  let processed = 0;
  let passed = 0;
  let failed = 0;
  let errors = 0;

  const fieldMapValues = Object.values(config.fieldMap);
  const hasPlaceholders = fieldMapValues.every((v) => v.includes('REPLACE_WITH'));

  for (const application of candidates) {
    try {
      // Fetch full detail — the list endpoint omits desiredSalary, resumeFileId,
      // questionsAndAnswers, and full address needed for hard-rule evaluation.
      const detail = await client.fetchApplicationDetails(application.id);

      // First-run discovery: log the detail JSON once so operators can configure fieldMap.
      if (hasPlaceholders && processed === 0) {
        console.error('[main] fieldMap has placeholder values. Logging application detail JSON for field discovery:');
        console.error(JSON.stringify(detail, null, 2));
      }

      // Evaluate all hard rules (collect-all, no LLM)
      const result = evaluateHardRules(config, detail);

      logDecision({
        candidateId: detail.applicant.id,
        applicationId: detail.id,
        outcome: result.outcome,
        reasons: result.reasons,
        timestamp: new Date().toISOString(),
      });

      processed++;
      if (result.outcome === 'pass') passed++;
      else failed++;
    } catch (err) {
      // SAFE-01: Log error record and continue to next candidate.
      const message = err instanceof Error ? err.message : String(err);
      logDecision({
        candidateId: application?.applicant?.id ?? 'unknown',
        applicationId: application?.id ?? 'unknown',
        outcome: 'error',
        reasons: [message],
        timestamp: new Date().toISOString(),
      });
      errors++;
      // NOTE: Do NOT re-throw — continue to next candidate.
    }
  }

  // Final summary to stderr (not stdout — stdout is reserved for JSON log lines)
  console.error(
    `[main] Done. processed=${processed} pass=${passed} fail=${failed} errors=${errors}`,
  );
}

// Run main and exit on unhandled error
main().catch((err) => {
  console.error('[main] Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
