// src/screener/multi-job-orchestrator.ts
// Phase 6, D-04: Top-level multi-job batch orchestrator.
// Loops over config.jobs[], instantiates one JobRunner per job, runs sequentially,
// catches per-job failures (D-09), aggregates results, emits D-08 JSON summary.
//
// MULTI-01: All jobs processed in a single container run.
// MULTI-02: Per-job failure isolation — StageValidationError or any throw caught here.
// MULTI-03: Final stdout JSON includes per-job counts and aggregate totals.
// D-10: run() always resolves — never rejects — process.exit handled in index.ts only.
import type { IBambooHRClient } from '../interfaces/IBambooHRClient.js';
import type { ISoftEvaluator } from '../interfaces/ISoftEvaluator.js';
import type { ILogger } from '../interfaces/ILogger.js';
import type { Config } from '../config/schema.js';
import { CandidateProcessor } from '../pipeline/candidate-processor.js';
import { LiveModeWriter } from '../pipeline/live-mode-writer.js';
import { JobRunner } from './job-runner.js';
import type { JobResult, SuccessJobResult } from './job-runner.js';

export class MultiJobOrchestrator {
  constructor(
    private readonly bambooHrClient: IBambooHRClient,
    private readonly softEvaluator: ISoftEvaluator,
    private readonly logger: ILogger,
    private readonly liveWriter: LiveModeWriter,
    private readonly config: Config,
    private readonly dryRun: boolean,
  ) {}

  async run(): Promise<void> {
    const jobResults: JobResult[] = [];

    for (const job of this.config.jobs) {
      try {
        const candidateProcessor = new CandidateProcessor(
          this.bambooHrClient,
          this.softEvaluator,
          this.logger,
          this.liveWriter,
          job,
          this.dryRun,
        );
        const runner = new JobRunner(
          this.bambooHrClient,
          candidateProcessor,
          this.logger,
          job,
          this.dryRun,
        );
        const result = await runner.run();
        jobResults.push(result);
      } catch (err) {
        // D-09: per-job error isolation — any throw (StageValidationError, network error, etc.)
        // is caught here; remaining jobs continue processing.
        const errorReason = err instanceof Error ? err.message : String(err);
        jobResults.push({ openingId: job.openingId, error: true, errorReason });
      }
    }

    // D-08/D-09: aggregate totals — exclude error jobs from counts
    const successJobs = jobResults.filter(
      (r): r is SuccessJobResult => !('error' in r),
    );

    const totals = {
      processed:   successJobs.reduce((sum, r) => sum + r.processed, 0),
      pass:        successJobs.reduce((sum, r) => sum + r.pass, 0),
      fail:        successJobs.reduce((sum, r) => sum + r.fail, 0),
      needsReview: successJobs.reduce((sum, r) => sum + r.needsReview, 0),
      errors:      successJobs.reduce((sum, r) => sum + r.errors, 0),
    };

    // stderr: human-readable summary
    console.error(
      `[main] Done. jobs=${jobResults.length} totals=${JSON.stringify(totals)}`,
    );
    // stdout: machine-readable JSON (INFRA-03, MULTI-03, D-08)
    console.log(JSON.stringify({ jobs: jobResults, totals }));
    // D-10: run() resolves here — never rejects; index.ts main().catch handles unexpected throws
  }
}
