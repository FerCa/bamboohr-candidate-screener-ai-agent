// src/interfaces/ISoftEvaluator.ts
// Structural interface for soft-rule evaluation (D-05).
// Wraps the existing free function evaluateSoftRules behind a class shape so
// CandidateProcessor can inject it as a constructor dependency and unit tests can mock it.
// SoftRulesInput is duplicated locally (not imported from agent/evaluator.ts) to keep this
// interface decoupled from the implementation file — same pattern used in evaluator.ts.
import type { CandidateContext } from '../pipeline/types.js';
import type { EvaluationResult } from '../agent/types.js';

/**
 * Local mirror of the softRules input shape used by the evaluator.
 * Mirrors Config['softRules'] structurally without depending on Zod.
 */
export interface SoftRulesInput {
  required: Array<{ label: string; description: string }>;
  optional: Array<{ label: string; description: string }>;
}

export interface ISoftEvaluator {
  evaluate(
    candidateContext: CandidateContext,
    softRules: SoftRulesInput | undefined,
  ): Promise<EvaluationResult>;
}
