---
phase: 05-clean-code-solid-refactor
plan: "04"
subsystem: pipeline, screener, index
tags: [keystone, solid, di, behavioral-preservation, tdd, compile-fix, D-01, D-02, SAFE-01, INFRA-03]
dependency_graph:
  requires: [05-01, 05-02, 05-03]
  provides: [CandidateProcessor, ScreeningPipeline, thin-index-wiring, full-test-suite]
  affects: [src/pipeline/candidate-processor.ts, src/screener/screening-pipeline.ts, src/index.ts, src/__tests__/CandidateProcessor.test.ts, src/__tests__/ScreeningPipeline.test.ts]
tech_stack:
  added: []
  patterns: [constructor-injection, tdd-red-green, structural-typing, module-mocking-vi-mock, safe-01-try-catch]
key_files:
  created:
    - src/pipeline/candidate-processor.ts
    - src/screener/screening-pipeline.ts
    - src/__tests__/CandidateProcessor.test.ts
    - src/__tests__/ScreeningPipeline.test.ts
  modified:
    - src/index.ts
decisions:
  - "Used vi.mock('../pipeline/extract-cv.js') at module level to avoid real pdf-parse calls in CandidateProcessor tests — cleanest isolation without brittle buffer construction"
  - "CandidateProcessor uses 'as Parameters<typeof buildCandidateContext>[0]' cast when passing IBambooHRClient to extract-cv.ts (which imports concrete BambooHRClient type) — structurally safe since IBambooHRClient declares all methods used by buildCandidateContext"
  - "ScreeningPipeline test mocks proc.process = vi.fn(impl) directly on a real CandidateProcessor instance — proves ScreeningPipeline only depends on the public method shape"
metrics:
  duration: "~20 minutes"
  completed: "2026-05-03"
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 1
---

# Phase 05 Plan 04: Wire Everything Together — CandidateProcessor, ScreeningPipeline, Thin Index Summary

Extracted `CandidateProcessor` (per-candidate pipeline) and `ScreeningPipeline` (top-level orchestrator) from `src/index.ts`, rewrote `src/index.ts` as a 85-line thin wiring script, and locked all 5 outcome paths and counter aggregation with 13 new tests (4 test files, 37 total). This is the keystone plan that restores a clean TypeScript compile after Plan 02's intentional breakage.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create CandidateProcessor with all five outcome paths (TDD) | 9977a82 | src/pipeline/candidate-processor.ts, src/__tests__/CandidateProcessor.test.ts |
| 2 | Create ScreeningPipeline orchestrator + integration tests (TDD) | 7c80ef3 | src/screener/screening-pipeline.ts, src/__tests__/ScreeningPipeline.test.ts |
| 3 | Rewrite src/index.ts as thin wiring + named-error catch | 19e5599 | src/index.ts |

## What Was Built

### CandidateProcessor (`src/pipeline/candidate-processor.ts`)
Per-candidate pipeline class (143 lines) that replaces the `for`-loop body in the pre-Phase-5 `src/index.ts`. Implements all five outcome paths via constructor-injected dependencies:
- **Path E** (hard-rule fail): `evaluateHardRules` → `logger.logDecision` → optional `liveWriter.write` with `CommentBuilder.hardRuleFail`
- **Path D** (CV needsReview): `buildCandidateContext` returns `needsReviewReason !== null` → `logger.logDecision` → optional `liveWriter.write` with `CommentBuilder.needsReview`
- **Paths A/B/C** (soft-eval pass/fail/needsReview): dry-run synthesizes `EvaluationResult` (CR-01); live mode calls `softEvaluator.evaluate` → `logger.logEvaluation` → optional `liveWriter.write` with `CommentBuilder.softEval`

### ScreeningPipeline (`src/screener/screening-pipeline.ts`)
Top-level orchestrator (111 lines) that replaces `main()` in the pre-Phase-5 `src/index.ts`. Five-step sequence:
1. Mode banner on stderr
2. `bambooHrClient.validateStages(config)` — throws `StageValidationError` on stage mismatch
3. Fetch candidates from intake stage via `bambooHrClient.fetchCandidates`
4. Per-candidate SAFE-01 loop — calls `candidateProcessor.process`, logs errors, never aborts
5. Human-readable stderr summary + INFRA-03 machine-readable JSON on stdout

### src/index.ts (rewritten)
Reduced from 260 lines to 85 lines. Constructs all dependencies in dependency order (leaf → orchestrator) and calls `pipeline.run()`. Named-error catch: `ConfigError` and `StageValidationError` get clean `.message` output; other errors fall through to the generic fatal path. Two `process.exit` calls are the only allowed sites (D-08).

### Test suite (4 files, 37 tests)
| File | Tests | Coverage |
|------|-------|---------|
| evaluateHardRules.test.ts | 15 | All 4 hard-rule types + collect-all invariant |
| CommentBuilder.test.ts | 9 | All 3 static methods, format structure, em-dash regression locks |
| CandidateProcessor.test.ts | 8 | All 5 outcome paths + dry-run invariant (CR-01) |
| ScreeningPipeline.test.ts | 5 | Counter aggregation, SAFE-01 isolation, INFRA-03 JSON, validateStages/fetchCandidates call counts, StageValidationError |

## Phase-5 Success Criteria Checklist

- [x] **SRP**: Each module has one job — `CommentBuilder` (comment formatting), `LiveModeWriter` (atomicity), `CandidateProcessor` (per-candidate flow), `ScreeningPipeline` (orchestration), `src/index.ts` (wiring only)
- [x] **OCP**: New rules/output channels addable without touching business logic — `ILogger` interface (SlackLogger v2 drop-in), `IBambooHRClient` (RetryingBambooHRClient decorator)
- [x] **DI**: `CandidateProcessor` and `ScreeningPipeline` accept all dependencies via constructor; no concrete-class imports in business logic (only interfaces + static utilities)
- [x] **Behavior preserved**: All 37 tests pass; `tsc --noEmit` exits 0; exact comment strings preserved (CommentBuilder.test.ts locks them with em-dash regression tests)
- [x] **TypeScript strict + no any**: `tsc --noEmit` exits 0; `grep -rn ": any" src/ --include="*.ts" | grep -v "__tests__"` returns zero matches

## Final Verification Results

- `tsc --noEmit` → exits 0 (PASS — Plan 02 intentional breakage resolved)
- `vitest run` → 4 test files, 37 tests, all passing
- `wc -l src/index.ts` → 85 lines (target: ≤ 90)
- `grep -c "evaluateHardRules|evaluateSoftRules|buildCandidateContext" src/index.ts` → 0
- `grep -rn ": any" src/ --include="*.ts" | grep -v "__tests__"` → 0 matches
- `grep -rn "^[^/]*process\.exit" src/ | grep -v "src/index.ts"` → 0 actual calls (two comment-only occurrences in error class files from Plan 02 describe what was replaced — not actual calls)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Type compatibility] Used type cast for IBambooHRClient → buildCandidateContext parameter**
- **Found during:** Task 1 implementation
- **Issue:** `extract-cv.ts` imports `BambooHRClient` (the concrete class) as the type for its `client` parameter, not `IBambooHRClient`. Passing `this.bambooHrClient: IBambooHRClient` to `buildCandidateContext` causes a TypeScript assignment error because the interface is not assignable to the concrete class type.
- **Fix:** Used `as Parameters<typeof buildCandidateContext>[0]` cast. This is structurally safe because `IBambooHRClient` declares all methods that `buildCandidateContext` actually calls (`downloadPdf`), so the runtime behavior is identical.
- **Alternative considered:** Changing `extract-cv.ts` to accept `IBambooHRClient` instead of `BambooHRClient`. Deferred as out of scope for this plan — Plan 05-04 only creates new files and rewrites index.ts.
- **Files modified:** src/pipeline/candidate-processor.ts

**2. [Rule 2 - Test architecture] Used vi.mock at module level instead of downloadPdf stub**
- **Found during:** Task 1 test design
- **Issue:** The plan initially suggested stubbing `downloadPdf` to test Path A (soft-eval pass). However, `buildCandidateContext` calls `pdfParse` on the downloaded buffer — stubbing `downloadPdf` to return fake buffer bytes would cause `pdfParse` to fail with corrupt PDF data, making the test brittle.
- **Fix:** Added `vi.mock('../pipeline/extract-cv.js', () => ({ buildCandidateContext: vi.fn() }))` at module level. Each test sets up the return value it needs (null needsReviewReason for happy paths, non-null for Path D).
- **Files modified:** src/__tests__/CandidateProcessor.test.ts

## Known Stubs

None — all outcome paths are fully wired to real implementations. No placeholder data, no hardcoded empty responses.

## Threat Flags

No new network endpoints, auth paths, or file access patterns introduced. This plan is a pure refactor — all I/O was already present in `src/index.ts`. The CandidateProcessor and ScreeningPipeline introduce no new external interactions.

## Self-Check

### Files Exist
- src/pipeline/candidate-processor.ts — FOUND
- src/screener/screening-pipeline.ts — FOUND
- src/__tests__/CandidateProcessor.test.ts — FOUND
- src/__tests__/ScreeningPipeline.test.ts — FOUND
- src/index.ts — FOUND (modified)
- .planning/phases/05-clean-code-solid-refactor/05-04-SUMMARY.md — FOUND

### Commits Exist
- 9977a82 — Task 1 (CandidateProcessor + tests)
- 7c80ef3 — Task 2 (ScreeningPipeline + tests)
- 19e5599 — Task 3 (thin index.ts)

## Self-Check: PASSED

All 3 task commits found. All created/modified files verified. `tsc --noEmit` exits 0. All 37 tests pass.
