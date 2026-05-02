// src/agent/types.ts
// GPT-4o soft-evaluation type contracts.
// The same Zod schema (EvaluationOutputSchema) drives BOTH:
//   1. The SDK's `outputType` parameter on Agent — forces GPT-4o to return JSON matching this shape
//   2. The TypeScript types for the evaluator's return value via z.infer<>
// This dual-purpose pattern (RESEARCH.md Pattern 3) prevents drift between the schema sent
// to the model and the types consumed by the rest of the codebase.
//
// D-09: EvaluationResult shape is locked.
// D-04: Per-criterion rationale is GPT-4o-generated (one-line, grounded in candidate content).
// D-05: optional criteria evaluations are included in output and recruiter comment.
// D-06: comment is a fully formatted recruiter-ready string (built by GPT-4o, not assembled in code).
import { z } from 'zod';

/**
 * Per-criterion evaluation result returned by GPT-4o for a single soft rule.
 * label is copied verbatim from the config rule's `label` field (D-08 says rationale is
 * GPT-4o-generated, NOT the rule description; label is the human-readable rule name).
 */
export const CriterionResultSchema = z.object({
  label: z.string(),
  met: z.boolean(),
  rationale: z.string(),
});

/**
 * The structured-output schema GPT-4o must produce.
 * Passed as `outputType` to the Agent constructor in src/agent/evaluator.ts.
 * SDK uses OpenAI structured outputs to enforce this shape — parse failure becomes a hard error
 * caught by evaluator.ts and mapped to needsReview (D-03 / Pitfall #3 in RESEARCH.md).
 *
 * Field semantics:
 *   - required: results for each `softRules.required[*]` from config (in same order as config)
 *   - optional: results for each `softRules.optional[*]` from config (in same order as config)
 *   - comment: complete recruiter comment as a single ready-to-post string (D-06 format)
 *   - outcome: GPT-4o computes this from the rules in the system prompt — 'pass' iff all
 *     required.met === true; otherwise 'fail'. needsReview is reserved for evaluator.ts to
 *     override on parse / maxTurns failure (RESEARCH.md Pitfall #4 + Open Question #2).
 */
export const EvaluationOutputSchema = z.object({
  required: z.array(CriterionResultSchema),
  optional: z.array(CriterionResultSchema),
  comment: z.string(),
  outcome: z.enum(['pass', 'fail', 'needsReview']),
});

/**
 * Full per-candidate log record emitted by logEvaluation() in src/logger/logger.ts.
 * GPT-4o output (required/optional/comment/outcome) plus IDs and timestamp added by
 * src/agent/evaluator.ts (these are NOT in EvaluationOutputSchema — GPT-4o never sees them).
 *
 * D-10: This object replaces the Phase 2 `pass`-branch CandidateDecision log line.
 * D-11: Phase 4 will consume EvaluationResult to drive BambooHR writes —
 *       outcome → target stage (pass = "Schedule Phone Screen", fail/needsReview = "Reviewed");
 *       comment → posted verbatim on the application (BAMB-02 / BAMB-03).
 */
export interface EvaluationResult {
  /** applicationId — the BambooHR write entity (NOT applicantId). */
  applicationId: number;
  /** applicantId — for reference/logging only. */
  applicantId: number;
  /** Final outcome — drives Phase 4 stage transition (D-11 / BAMB-02). */
  outcome: 'pass' | 'fail' | 'needsReview';
  /** Required criteria results (D-02: dealbreakers; all must pass for outcome=pass). */
  required: z.infer<typeof CriterionResultSchema>[];
  /** Optional criteria results (D-05: included for context, never block the outcome). */
  optional: z.infer<typeof CriterionResultSchema>[];
  /** Recruiter-ready formatted comment (D-06 format with header/met/unmet/optional/footer). */
  comment: string;
  /** ISO 8601 timestamp set at log time. */
  timestamp: string;
}
