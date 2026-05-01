---
status: partial
phase: 01-foundation
source: [01-VERIFICATION.md]
started: 2026-05-01T01:00:00Z
updated: 2026-05-01T01:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Full pipeline with real BambooHR credentials
expected: stderr shows `[main] Mode: DRY_RUN (no writes)`, stages validated, candidates fetched; stdout contains one JSON line per candidate with `candidateId`, `applicationId`, `outcome`, `reasons`, `timestamp` fields populated from real data
result: [pending]

### 2. Stage name mismatch exits cleanly
expected: Script prints `[bamboohr] Stage "Fake Stage" (config.job.stages.pass) not found in BambooHR.` and lists available stages, exits code 1 before processing any candidates
result: [pending]

### 3. Salary rule gates a real candidate
expected: JSON log line with `outcome: "fail"`, `reasons: ["Salary above ceiling"]` (or configured label), `candidateId`, `applicationId`, `timestamp`
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
