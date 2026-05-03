// src/screener/screening-pipeline.ts
// Phase 5, D-01: Top-level orchestrator.
// Replaces the body of main() in the pre-Phase-5 src/index.ts (lines 44–253).
// Drives the full pipeline:
//   1. Print mode banner (DRY_RUN vs LIVE)
//   2. validateStages() — throws StageValidationError on mismatch
//   3. fetchCandidates() for the intake stage
//   4. Per-candidate loop with SAFE-01 try/catch
//   5. Final summary on stderr + machine-readable JSON on stdout (INFRA-03)
//
// Dependencies injected via constructor (Phase-5 success criterion #3).
import type { IBambooHRClient } from '../interfaces/IBambooHRClient.js';
import type { ILogger } from '../interfaces/ILogger.js';
import type { Config } from '../config/schema.js';
import { CandidateProcessor } from '../pipeline/candidate-processor.js';
import { StageValidationError } from '../bamboohr/errors.js';

export class ScreeningPipeline {
  constructor(
    private readonly bambooHrClient: IBambooHRClient,
    private readonly candidateProcessor: CandidateProcessor,
    private readonly logger: ILogger,
    private readonly config: Config,
    private readonly dryRun: boolean,
  ) {}

  async run(): Promise<void> {
    // --- Step 1: Mode banner ---
    console.error(
      `[main] Mode: ${this.dryRun ? 'DRY_RUN (no writes)' : 'LIVE MODE — writes enabled'}`,
    );
    console.error(`[main] Job opening: ${this.config.job.openingId}`);

    // --- Step 2: Validate stages ---
    console.error('[main] Validating pipeline stages against BambooHR...');
    const stageMap = await this.bambooHrClient.validateStages(this.config);
    console.error('[main] Pipeline stages validated.');

    // --- Step 3: Fetch candidates from intake stage ---
    const intakeStageName = this.config.job.stages.intake;
    const intakeId = stageMap.get(intakeStageName);
    if (intakeId === undefined) {
      // Defensive — validateStages should have caught this. If it didn't, treat as
      // a stage-config error (D-09) so main() prints the message and exits cleanly.
      throw new StageValidationError(
        `Intake stage "${intakeStageName}" not found in stageMap. ` +
        `This indicates a stage was renamed between validateStages() and the candidate fetch.`,
      );
    }

    console.error(
      `[main] Fetching candidates from stage: ${intakeStageName} (id=${intakeId})`,
    );
    const applications = await this.bambooHrClient.fetchCandidates(
      this.config.job.openingId,
      String(intakeId),
    );
    console.error(
      `[main] Found ${applications.length} candidate(s) in "${intakeStageName}" stage.`,
    );

    // --- Step 4: Per-candidate loop ---
    // SAFE-01: per-candidate try/catch — one failure does not abort the run.
    let processed = 0;
    let passed = 0;
    let failed = 0;
    let needsReview = 0;
    let errors = 0;

    for (const application of applications) {
      try {
        const outcome = await this.candidateProcessor.process(application, stageMap);
        if (outcome === 'pass') {
          passed++;
        } else if (outcome === 'fail') {
          failed++;
        } else {
          needsReview++;
        }
        processed++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.logger.logDecision({
          candidateId: application?.applicant?.id ?? 'unknown',
          applicationId: application?.id ?? 'unknown',
          outcome: 'error',
          reasons: [message],
          timestamp: new Date().toISOString(),
        });
        errors++;
        // NOTE: do NOT re-throw — continue to next candidate (SAFE-01)
      }
    }

    // --- Step 5: Final summary ---
    // stderr: human-readable
    console.error(
      `[main] Done. processed=${processed} pass=${passed} fail=${failed} needsReview=${needsReview} errors=${errors}`,
    );
    // stdout: machine-readable JSON (INFRA-03)
    console.log(
      JSON.stringify({ processed, pass: passed, fail: failed, needsReview, errors }),
    );
  }
}
