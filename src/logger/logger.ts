// src/logger/logger.ts
// INFRA-02: Structured JSON logger.
// Each candidate decision is emitted as a single JSON line to stdout.
// Docker captures stdout — JSON lines are machine-parseable by any log aggregator.
import type { CandidateDecision } from '../rules/types.js';

export type { CandidateDecision };

/**
 * Emit a single candidate decision as a JSON line to stdout.
 * Uses process.stdout.write (not console.log) to avoid any buffering prefix.
 * INFRA-02 required fields: candidateId, applicationId, outcome, reasons, timestamp.
 */
export function logDecision(record: CandidateDecision): void {
  process.stdout.write(JSON.stringify(record) + '\n');
}
