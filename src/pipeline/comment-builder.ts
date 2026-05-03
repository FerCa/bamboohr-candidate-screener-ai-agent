// src/pipeline/comment-builder.ts
// Phase 5, D-03: All recruiter-comment formatting in a single module.
// Three static methods, one per outcome path. Pure functions — no side effects, no I/O.
// Behavior preserved bit-for-bit from the inline template literals in src/index.ts
// (lines 126–130 for needsReview, lines 211–215 for hardRuleFail, line 187 for softEval).
import type { EvaluationResult } from '../agent/types.js';
import type { NeedsReviewReason } from './types.js';

/**
 * Recruiter-comment factories.
 * All static — no instance state. The class form is purely a namespace for grouping.
 */
export class CommentBuilder {
  /**
   * Pass-through for soft-evaluation results — GPT-4o already produces the full
   * recruiter-ready comment in result.comment (see src/agent/types.ts line 69).
   * This method exists so all comment construction flows through one module (D-03).
   */
  static softEval(result: EvaluationResult): string {
    return result.comment;
  }

  /**
   * Hard-rule failure comment.
   * Format (3 paragraphs joined by '\n\n'):
   *   "FAIL" header + bullet list of reasons + auto-screened footer.
   *
   * Source template: src/index.ts lines 211–215 (verbatim).
   */
  static hardRuleFail(reasons: string[]): string {
    return [
      'FAIL — Hard rules',
      reasons.map((r) => `• ${r}`).join('\n'),
      '[Auto-screened by AI — final decision rests with recruiter]',
    ].join('\n\n');
  }

  /**
   * Needs-review comment for candidates whose CV could not be auto-screened.
   * Format (3 paragraphs joined by '\n\n'):
   *   "NEEDS REVIEW" header + reason + auto-screened footer.
   *
   * Source template: src/index.ts lines 126–130 (verbatim).
   */
  static needsReview(reason: NeedsReviewReason): string {
    return [
      'NEEDS REVIEW — Automated screening incomplete',
      reason,
      '[Auto-screened by AI — final decision rests with recruiter]',
    ].join('\n\n');
  }
}
