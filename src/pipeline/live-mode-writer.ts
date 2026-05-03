// src/pipeline/live-mode-writer.ts
// Phase 5, D-04: Single owner of the comment-then-move atomicity invariant.
// Centralizes the postComment + moveStage call pair that was previously duplicated at
// three sites in src/index.ts (lines 137–138, 187–188, 222–223 of the pre-Phase-5 code).
//
// Atomicity policy (Phase 4 D-03/D-04 invariant — preserved verbatim):
//   1. postComment runs FIRST. If it throws, moveStage is NEVER called and the candidate
//      remains in the intake stage — the next cron run will retry it cleanly.
//   2. Any throw propagates up to CandidateProcessor's per-candidate try/catch (SAFE-01).
//
// Accepts IBambooHRClient (the interface, NOT the concrete class) so unit tests can inject
// a vi.fn() mock and CandidateProcessor doesn't depend on the BambooHRClient implementation.
import type { IBambooHRClient } from '../interfaces/IBambooHRClient.js';

export class LiveModeWriter {
  constructor(private readonly bambooHrClient: IBambooHRClient) {}

  /**
   * Post comment then move stage. If postComment throws, moveStage never runs.
   * Caller (CandidateProcessor) is expected to skip this call entirely in dry-run mode.
   */
  async write(
    applicationId: number,
    comment: string,
    stageId: number,
  ): Promise<void> {
    await this.bambooHrClient.postComment(applicationId, comment);
    await this.bambooHrClient.moveStage(applicationId, stageId);
  }
}
