// src/screener/job-runner.ts
// Phase 6, D-04: Per-job orchestrator (renamed from ScreeningPipeline).
// Drives the full pipeline for a single job:
//   1. Print mode banner
//   2. validateStages() — throws StageValidationError on mismatch (caught by MultiJobOrchestrator)
//   3. fetchCandidates() for the intake stage
//   4. Per-candidate loop with SAFE-01 try/catch
//   5. Returns JobResult (no stdout emission — MultiJobOrchestrator aggregates)
//
// D-05: validateStages() called here per-job — not once globally.
// D-10: Only src/index.ts is the allowed exit point — this class never exits.
import type { IBambooHRClient } from '../interfaces/IBambooHRClient.js';
import type { ILogger } from '../interfaces/ILogger.js';
import type { JobConfig } from '../config/schema.js';
import { CandidateProcessor } from '../pipeline/candidate-processor.js';
import { StageValidationError } from '../bamboohr/errors.js';

export type SuccessJobResult = {
  openingId: string;
  processed: number;
  pass: number;
  fail: number;
  needsReview: number;
  errors: number;
};

export type ErrorJobResult = {
  openingId: string;
  error: true;
  errorReason: string;
};

export type JobResult = SuccessJobResult | ErrorJobResult;

export class JobRunner {
  constructor(
    private readonly bambooHrClient: IBambooHRClient,
    private readonly candidateProcessor: CandidateProcessor,
    private readonly logger: ILogger,
    private readonly job: JobConfig,
    private readonly dryRun: boolean,
  ) {}

  async run(): Promise<JobResult> {
    // Step 1: Mode banner
    console.error(
      `[main] Mode: ${this.dryRun ? 'DRY_RUN (no writes)' : 'LIVE MODE — writes enabled'}`,
    );
    console.error(`[main] Job opening: ${this.job.openingId}`);

    // Step 2: Validate stages — D-05: called per-job here (not once globally)
    console.error('[main] Validating pipeline stages against BambooHR...');
    const stageMap = await this.bambooHrClient.validateStages(this.job);
    console.error('[main] Pipeline stages validated.');

    // Step 3: Fetch candidates from intake stage
    const intakeStageName = this.job.stages.intake;
    const intakeId = stageMap.get(intakeStageName);
    if (intakeId === undefined) {
      throw new StageValidationError(
        `Intake stage "${intakeStageName}" not found in stageMap. ` +
        `This indicates a stage was renamed between validateStages() and the candidate fetch.`,
      );
    }

    console.error(
      `[main] Fetching candidates from stage: ${intakeStageName} (id=${intakeId})`,
    );
    const applications = await this.bambooHrClient.fetchCandidates(
      this.job.openingId,
      String(intakeId),
    );
    console.error(
      `[main] Found ${applications.length} candidate(s) in "${intakeStageName}" stage.`,
    );

    // Step 4: Per-candidate loop — SAFE-01: one failure does not abort the run
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

    // Step 5: Return result — stdout emission is MultiJobOrchestrator's responsibility
    console.error(
      `[main] Job ${this.job.openingId} done. processed=${processed} pass=${passed} fail=${failed} needsReview=${needsReview} errors=${errors}`,
    );

    return {
      openingId: this.job.openingId,
      processed,
      pass: passed,
      fail: failed,
      needsReview,
      errors,
    };
  }
}
