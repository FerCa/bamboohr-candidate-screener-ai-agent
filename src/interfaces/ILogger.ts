// src/interfaces/ILogger.ts
// Structural interface for per-candidate JSON-line logging (D-05, D-06).
// The current concrete implementation will be JsonLogger (Plan 02). Future v2
// implementations (SlackLogger) drop in by implementing this interface — no changes to
// CandidateProcessor or JobRunner needed.
import type { CandidateDecision } from '../rules/types.js';
import type { EvaluationResult } from '../agent/types.js';

export interface ILogger {
  logDecision(record: CandidateDecision): void;
  logEvaluation(record: EvaluationResult): void;
}
