---
status: partial
phase: 03-agent-evaluation
source: [03-VERIFICATION.md]
started: 2026-05-02T07:37:47Z
updated: 2026-05-02T07:37:47Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. End-to-end dry-run with live credentials
expected: At least one EvaluationResult JSON line on stdout with all required fields (outcome, comment, required[], optional[], applicationId, applicantId, timestamp) and the audit footer `[Auto-screened by AI — final decision rests with recruiter]` in the comment field. No BambooHR writes should occur.

result: [pending]

### 2. Hard-rule fail isolation
expected: Candidates who fail hard rules produce only a `CandidateDecision` log line with `outcome: 'fail'`. No `EvaluationResult` line is emitted for them — `evaluateSoftRules` is never called.

result: [pending]

### 3. MaxTurnsExceededError recovery
expected: When the agent loop exceeds 5 turns (can be simulated by temporarily setting `maxTurns: 1`), `evaluateSoftRules` returns an `EvaluationResult` with `outcome: 'needsReview'` and the run continues to the next candidate without an unhandled exception.

result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
