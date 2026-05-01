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
import { buildCandidateContext } from './pipeline/extract-cv.js';
import type { CandidateContext } from './pipeline/types.js';

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
  // Capture stageMap — also validates all stage names exist (exits 1 on failure).
  const stageMap = await client.validateStages(config);
  console.error('[main] Pipeline stages validated.');

  // --- Step 4: Fetch candidates in the intake stage ---
  // Resolve intake stage ID from the stageMap — no second API call needed (WR-03).
  const intakeStageName = config.job.stages.intake;
  const intakeId = stageMap.get(intakeStageName);
  if (intakeId === undefined) {
    console.error(`[main] Intake stage "${intakeStageName}" not found in stageMap. This should not happen if validateStages passed.`);
    process.exit(1);
  }

  console.error(`[main] Fetching candidates from stage: ${intakeStageName} (id=${intakeId})`);
  const candidates = await client.fetchCandidates(
    config.job.openingId,
    String(intakeId),
  );
  console.error(`[main] Found ${candidates.length} candidate(s) in "${intakeStageName}" stage.`);

  // --- Step 5: Process each candidate ---
  // SAFE-01: Per-candidate try/catch — one failure does not abort the run.
  let processed = 0;
  let passed = 0;
  let failed = 0;
  let errors = 0;
  let needsReview = 0;

  const fieldMapValues = Object.values(config.fieldMap);
  const hasPlaceholders =
    fieldMapValues.length === 0 ||
    fieldMapValues.some((v) => v.includes('REPLACE_WITH'));

  for (const application of candidates) {
    try {
      // Fetch full detail — the list endpoint omits desiredSalary, resumeFileId,
      // questionsAndAnswers, and full address needed for hard-rule evaluation.
      const detail = await client.fetchApplicationDetails(application.id);

      // First-run discovery: log structure only so operators can configure fieldMap.
      if (hasPlaceholders && processed === 0) {
        // WR-02: Log structure only — no PII values (GDPR requirement per CLAUDE.md).
        const structure = Object.fromEntries(
          Object.keys(detail).map((k) => [k, typeof (detail as Record<string, unknown>)[k]]),
        );
        console.error('[main] fieldMap has placeholder values. Application detail structure (keys and value types):');
        console.error(JSON.stringify(structure, null, 2));
      }

      // Evaluate all hard rules (collect-all, no LLM)
      const result = evaluateHardRules(config, detail);

      if (result.outcome === 'pass') {
        // Phase 2: Download and extract CV for candidates that passed hard rules.
        // buildCandidateContext() never throws for recoverable failures — returns needsReviewReason instead.
        // Unrecoverable failures (network, auth) throw and are caught by the outer try/catch below.
        const ctx: CandidateContext = await buildCandidateContext(client, detail, result);

        if (ctx.needsReviewReason !== null) {
          // CV could not be extracted — flag for human review without calling GPT-4o.
          logDecision({
            candidateId: detail.applicant.id,
            applicationId: detail.id,
            outcome: 'needsReview',
            reasons: [ctx.needsReviewReason],
            timestamp: new Date().toISOString(),
          });
          needsReview++;
          processed++;
          continue;
        }

        // ctx.cvText is guaranteed non-null here.
        // Phase 3 will consume ctx for GPT-4o evaluation.
        // For now: log as pass with a placeholder note.
        logDecision({
          candidateId: detail.applicant.id,
          applicationId: detail.id,
          outcome: 'pass',
          reasons: ['CV extracted; pending Phase 3 agent evaluation'],
          timestamp: new Date().toISOString(),
        });
        passed++;
      } else {
        // Hard-rule failure — log immediately (same as Phase 1).
        logDecision({
          candidateId: detail.applicant.id,
          applicationId: detail.id,
          outcome: result.outcome,
          reasons: result.reasons,
          timestamp: new Date().toISOString(),
        });
        failed++;
      }

      processed++;
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
    `[main] Done. processed=${processed} pass=${passed} fail=${failed} needsReview=${needsReview} errors=${errors}`,
  );
}

// Run main and exit on unhandled error
main().catch((err) => {
  console.error('[main] Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
