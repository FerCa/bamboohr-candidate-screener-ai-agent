---
status: partial
phase: 04-live-mode-deployment
source: [04-VERIFICATION.md]
started: 2026-05-02T00:00:00Z
updated: 2026-05-02T00:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Live write-path E2E test
expected: With LIVE_MODE=true and a real BambooHR API key with ATS settings access, run the container against a test candidate in the intake stage. Confirm in the BambooHR UI that: (a) a recruiter comment appears on the application, (b) the candidate is moved to the correct pass or fail stage, and (c) the comment was posted before the stage move (i.e. comment appears with an earlier timestamp or no stage-move-without-comment inconsistency exists).
result: [pending]

### 2. Dry-run zero-calls confirmation
expected: Run the container without LIVE_MODE set (dry-run mode) against a real BambooHR job. Confirm that: (a) no BambooHR write API calls appear (no comments posted, no stage changes in BambooHR UI), (b) no OpenAI API calls are made (check OpenAI usage dashboard or run with an invalid OPENAI_API_KEY — should complete without error), and (c) the final stdout line is a valid JSON object matching {"processed":N,"pass":N,"fail":N,"needsReview":N,"errors":N}.
result: [pending]

## Summary

total: 2
passed: 0
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
