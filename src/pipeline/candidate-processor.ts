// src/pipeline/candidate-processor.ts
// Phase 5, D-02: Per-candidate pipeline.
// Replaces the body of the for-of loop in the pre-Phase-5 src/index.ts (lines 89–241,
// the contents of the try block). Returns a typed CandidateOutcome on the four happy
// paths and rethrows on unrecoverable failures (SAFE-01 — JobRunner catches).
//
// Dependencies are injected via constructor — no direct imports of concrete classes
// (Phase-5 success criterion #3 — dependencies flow inward). Unit tests inject vi.fn()
// mocks for IBambooHRClient, ISoftEvaluator, ILogger, LiveModeWriter.
import type { IBambooHRClient } from '../interfaces/IBambooHRClient.js';
import type { ISoftEvaluator } from '../interfaces/ISoftEvaluator.js';
import type { ILogger } from '../interfaces/ILogger.js';
import type { JobConfig } from '../config/schema.js';
import type { BambooHRApplication } from '../bamboohr/types.js';
import type { EvaluationResult } from '../agent/types.js';
import { evaluateHardRules } from '../rules/evaluator.js';
import { buildCandidateContext } from './extract-cv.js';
import { CommentBuilder } from './comment-builder.js';
import { LiveModeWriter } from './live-mode-writer.js';

export type CandidateOutcome = 'pass' | 'fail' | 'needsReview';

export class CandidateProcessor {
  constructor(
    private readonly bambooHrClient: IBambooHRClient,
    private readonly softEvaluator: ISoftEvaluator,
    private readonly logger: ILogger,
    private readonly liveWriter: LiveModeWriter,
    private readonly job: JobConfig,
    private readonly dryRun: boolean,
  ) {}

  /**
   * Process a single application end-to-end.
   * Returns the typed outcome on success. Re-throws unrecoverable errors so the caller's
   * SAFE-01 try/catch can log + count them.
   */
  async process(
    application: BambooHRApplication,
    stageMap: Map<string, number>,
  ): Promise<CandidateOutcome> {
    const applicationDetail = await this.bambooHrClient.fetchApplicationDetails(
      application.id,
    );

    const hardRuleResult = evaluateHardRules(this.job, applicationDetail);

    if (hardRuleResult.outcome === 'fail') {
      // --- Path E: hard-rule fail ---
      this.logger.logDecision({
        candidateId: applicationDetail.applicant.id,
        applicationId: applicationDetail.id,
        outcome: 'fail',
        reasons: hardRuleResult.reasons,
        timestamp: new Date().toISOString(),
      });

      if (!this.dryRun) {
        const failStageId = this.resolveStageId(stageMap, this.job.stages.fail);
        await this.liveWriter.write(
          applicationDetail.id,
          CommentBuilder.hardRuleFail(hardRuleResult.reasons),
          failStageId,
        );
      }
      return 'fail';
    }

    // hardRuleResult.outcome === 'pass' → continue to CV extraction
    // Cast to the concrete BambooHRClient shape that extract-cv.ts expects.
    // IBambooHRClient is structurally compatible — it declares all methods that
    // buildCandidateContext uses (downloadPdf). The type assertion is safe because
    // extract-cv.ts only calls methods declared on IBambooHRClient.
    const candidateContext = await buildCandidateContext(
      this.bambooHrClient as Parameters<typeof buildCandidateContext>[0],
      applicationDetail,
      hardRuleResult,
    );

    if (candidateContext.needsReviewReason !== null) {
      // --- Path D: CV needsReview ---
      this.logger.logDecision({
        candidateId: applicationDetail.applicant.id,
        applicationId: applicationDetail.id,
        outcome: 'needsReview',
        reasons: [candidateContext.needsReviewReason],
        timestamp: new Date().toISOString(),
      });

      if (!this.dryRun) {
        const reviewedStageId = this.resolveStageId(stageMap, this.job.stages.fail);
        await this.liveWriter.write(
          applicationDetail.id,
          CommentBuilder.needsReview(candidateContext.needsReviewReason),
          reviewedStageId,
        );
      }
      return 'needsReview';
    }

    // --- Paths A/B/C: soft-eval ---
    // CR-01 (Phase 4): Dry-run must not call OpenAI. Synthesize a deterministic
    // EvaluationResult so the rest of the pipeline (logEvaluation) behaves identically.
    let evalResult: EvaluationResult;
    if (this.dryRun) {
      evalResult = {
        applicationId: candidateContext.applicationId,
        applicantId: candidateContext.applicantId,
        outcome: 'pass',
        required: [],
        optional: [],
        comment: '[DRY_RUN] Soft evaluation skipped — no API call made.',
        timestamp: new Date().toISOString(),
      };
    } else {
      evalResult = await this.softEvaluator.evaluate(
        candidateContext,
        this.job.softRules,
      );
    }

    this.logger.logEvaluation(evalResult);

    if (!this.dryRun) {
      // D-01 (Phase 4): 'fail' AND 'needsReview' both go to the fail/reviewed stage.
      const targetStageName =
        evalResult.outcome === 'pass'
          ? this.job.stages.pass
          : this.job.stages.fail;
      const targetStageId = this.resolveStageId(stageMap, targetStageName);
      await this.liveWriter.write(
        evalResult.applicationId,
        CommentBuilder.softEval(evalResult),
        targetStageId,
      );
    }

    return evalResult.outcome;
  }

  /**
   * Resolve a stage name to its numeric ID via the stageMap built by validateStages().
   * Throws if the stage was not found — should be impossible after validateStages succeeded
   * but defensive in case of config changes between startup and per-candidate processing.
   */
  private resolveStageId(stageMap: Map<string, number>, stageName: string): number {
    const stageId = stageMap.get(stageName);
    if (stageId === undefined) {
      throw new Error(
        `[candidate-processor] Stage "${stageName}" not found in stageMap`,
      );
    }
    return stageId;
  }
}
