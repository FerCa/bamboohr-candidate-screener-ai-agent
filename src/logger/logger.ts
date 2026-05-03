// src/logger/logger.ts
// INFRA-02: Structured JSON logger as a class for dependency injection (Phase 5, D-06).
// Each candidate decision is emitted as a single JSON line to stdout.
// Docker captures stdout — JSON lines are machine-parseable by any log aggregator.
//
// JsonLogger structurally satisfies ILogger (D-05) — no `implements` keyword needed.
// Future v2 implementations (SlackLogger) drop in by exporting a class with the same shape.
import type { CandidateDecision } from '../rules/types.js';
import type { EvaluationResult } from '../agent/types.js';

export type { CandidateDecision };
export type { EvaluationResult };

/**
 * JSON-line logger that writes one record per call to stdout.
 * Uses process.stdout.write (not the console API) to avoid any buffering prefix —
 * cron/Docker log aggregators parse one JSON object per line.
 */
export class JsonLogger {
  /**
   * Emit a single candidate decision as a JSON line to stdout.
   * INFRA-02 required fields: candidateId, applicationId, outcome, reasons, timestamp.
   */
  logDecision(record: CandidateDecision): void {
    process.stdout.write(JSON.stringify(record) + '\n');
  }

  /**
   * Emit a single GPT-4o evaluation result as a JSON line to stdout.
   * Same pattern as logDecision — process.stdout.write to avoid buffering prefix.
   *
   * D-10 (Phase 3): Used for soft-evaluated candidates (the `pass`-branch successful path).
   * D-11 (Phase 3): Phase 4 consumes EvaluationResult to drive BambooHR writes
   *                 (outcome → target stage; comment → application comment body).
   */
  logEvaluation(record: EvaluationResult): void {
    process.stdout.write(JSON.stringify(record) + '\n');
  }
}
