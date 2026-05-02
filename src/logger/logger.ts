// src/logger/logger.ts
// INFRA-02: Structured JSON logger.
// Each candidate decision is emitted as a single JSON line to stdout.
// Docker captures stdout — JSON lines are machine-parseable by any log aggregator.
import type { CandidateDecision } from '../rules/types.js';
import type { EvaluationResult } from '../agent/types.js';

export type { CandidateDecision };

/**
 * Emit a single candidate decision as a JSON line to stdout.
 * Uses process.stdout.write (not console.log) to avoid any buffering prefix.
 * INFRA-02 required fields: candidateId, applicationId, outcome, reasons, timestamp.
 */
export function logDecision(record: CandidateDecision): void {
  process.stdout.write(JSON.stringify(record) + '\n');
}

export type { EvaluationResult };

/**
 * Emit a single GPT-4o evaluation result as a JSON line to stdout.
 * Same pattern as logDecision() — process.stdout.write to avoid buffering prefix.
 *
 * D-10: Used for soft-evaluated candidates (the `pass`-branch successful path in src/index.ts).
 * D-11: The same EvaluationResult will be consumed by Phase 4 for BambooHR writes
 *       (outcome → target stage; comment → application comment body).
 */
export function logEvaluation(record: EvaluationResult): void {
  process.stdout.write(JSON.stringify(record) + '\n');
}
