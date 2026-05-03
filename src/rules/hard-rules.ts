// src/rules/hard-rules.ts
// Phase 5, D-11: Public export point for the hard-rule evaluator.
// Re-exports evaluateHardRules from evaluator.ts so test files and future
// consumers can import from this stable module path.
export { evaluateHardRules } from './evaluator.js';
