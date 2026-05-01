// src/rules/types.ts
// Types for the hard-rule evaluation engine and candidate decision logging.

/**
 * Result of evaluating all hard rules against one candidate.
 * D-03: collect-all — ALL rules are evaluated; reasons[] accumulates ALL unmet labels.
 */
export interface RuleResult {
  /** 'pass' if all rules pass; 'fail' if one or more rules fail */
  outcome: 'pass' | 'fail';
  /**
   * Labels (verbatim from config rule.label) of every unmet rule.
   * Empty array when outcome is 'pass'.
   * D-02: labels are used verbatim — do not transform or rewrite them.
   */
  reasons: string[];
}

/**
 * Structured log record emitted per candidate per INFRA-02.
 * Written to stdout as a single JSON line via logDecision() in src/logger/logger.ts.
 */
export interface CandidateDecision {
  candidateId: number | string;    // applicant.id — for reference/logging
  applicationId: number | string;  // application.id — the BambooHR write entity
  outcome: 'pass' | 'fail' | 'needsReview' | 'error';  // D-07: needsReview added in Phase 2
  reasons: string[];
  timestamp: string;               // ISO 8601
}
