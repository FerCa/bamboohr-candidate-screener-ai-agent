// src/pipeline/types.ts
// In-flight candidate pipeline state types.
// CandidateContext is produced by Phase 2 (PDF pipeline) and consumed by Phase 3 (agent evaluation).
// These are internal pipeline state objects — NOT BambooHR API response shapes.
// D-01: CandidateContext is separate from CandidateDecision (which is the log record only).
// D-02: applicationAnswers is Record<string, unknown> — raw pass-through, no normalization.
// D-03: cvText is string | null — null when needsReviewReason !== null.
// D-04: needsReviewReason uses this union type (not bare string) for type safety.
import type { RuleResult } from '../rules/types.js';

/**
 * The three reasons a candidate CV cannot be auto-screened.
 * String literal union (not enum) for JSON serialization safety.
 * D-04: values are 'non-pdf-content-type' | 'extraction-failed' | 'image-only-pdf'
 */
export type NeedsReviewReason =
  | 'non-pdf-content-type'
  | 'extraction-failed'
  | 'image-only-pdf';

/**
 * In-flight candidate state produced by the Phase 2 PDF pipeline.
 * Consumed by Phase 3 agent evaluation as the single input object.
 * NOT a BambooHR API type — constructed by buildCandidateContext() in extract-cv.ts.
 */
export interface CandidateContext {
  /** applicationId — the BambooHR write entity (NOT applicantId). */
  applicationId: number;
  /** applicantId — for reference/logging only. */
  applicantId: number;
  /** Result of hard-rule pre-filter. Always 'pass' when CandidateContext is created. */
  hardRuleResult: RuleResult;
  /**
   * Extracted and truncated CV text (max 8000 chars).
   * null when needsReviewReason !== null (D-03).
   */
  cvText: string | null;
  /**
   * Reason the candidate was flagged for human review, or null if extraction succeeded.
   * D-04: one of 'non-pdf-content-type' | 'extraction-failed' | 'image-only-pdf' | null
   */
  needsReviewReason: NeedsReviewReason | null;
  /**
   * Raw application answers from BambooHR — no normalization (D-02).
   * Field path is account-specific; discovered on first DRY_RUN.
   */
  applicationAnswers: Record<string, unknown>;
}
