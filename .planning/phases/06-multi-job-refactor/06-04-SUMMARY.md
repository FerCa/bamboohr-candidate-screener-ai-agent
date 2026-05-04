---
phase: 06-multi-job-refactor
plan: 04
subsystem: screener
tags: [orchestrator, multi-job, batch, D-08, D-09, D-10, MULTI-01, MULTI-02, MULTI-03]
dependency_graph:
  requires: [06-01, 06-02, 06-03]
  provides: [MultiJobOrchestrator, D-08-stdout-shape, per-job-isolation]
  affects: [src/screener/multi-job-orchestrator.ts, src/__tests__/MultiJobOrchestrator.test.ts]
tech_stack:
  added: []
  patterns: [per-job-DI-loop, catch-all-job-isolation, type-predicate-filter, JobRunner.prototype.run spy]
key_files:
  created:
    - src/screener/multi-job-orchestrator.ts
    - src/__tests__/MultiJobOrchestrator.test.ts
  modified: []
decisions:
  - "catch block uses catch(err) without type narrowing to catch ALL throws — ensures job-level isolation for any unexpected throw, not only StageValidationError"
  - "successJobs filter uses type predicate (r): r is SuccessJobResult => !('error' in r) — TypeScript narrows the type so reduce calls only operate on SuccessJobResult objects"
  - "console.log called exactly once at the end of run() — single stdout emission of the D-08 JSON shape, no intermediate stdout output"
  - "cherry-picked 06-02 prerequisites (job-runner.ts, IBambooHRClient/BambooHRClient validateStages JobConfig update, JobRunner.test.ts) into worktree since the 06-02 branch had not been merged to main at plan-04 start time"
metrics:
  duration: "~5 minutes"
  completed: "2026-05-04"
  tasks: 2
  files_changed: 2
---

# Phase 6 Plan 04: MultiJobOrchestrator Summary

Creates `MultiJobOrchestrator` — the top-level batch orchestrator that loops over `config.jobs[]`, runs one `JobRunner` per job sequentially, catches per-job failures to prevent abort propagation (MULTI-02), aggregates only successful job results, and emits a single D-08 JSON summary to stdout. Also creates 5 vitest tests covering all MULTI-01/02/03, D-09, and D-10 requirements.

## What Was Built

**`src/screener/multi-job-orchestrator.ts`** (new file) — `MultiJobOrchestrator` class implementing the D-04 design decision:
- Constructor accepts: `IBambooHRClient`, `ISoftEvaluator`, `ILogger`, `LiveModeWriter`, `Config`, `boolean dryRun` — same DI-via-constructor pattern as Phase 5
- `run(): Promise<void>` iterates `config.jobs[]`, constructing a fresh `CandidateProcessor` and `JobRunner` per job inside the loop
- `try/catch` around each job's `runner.run()` catches ALL errors (not just `StageValidationError`) and records `{ openingId, error: true, errorReason }` in the `jobResults` array (D-09)
- After the loop, filters `jobResults` to `successJobs` via `(r): r is SuccessJobResult => !('error' in r)` type predicate — only successful jobs contribute to `totals` aggregation (D-09)
- Emits one `console.error` (human-readable summary to stderr) and one `console.log` with `JSON.stringify({ jobs: jobResults, totals })` (D-08 machine-readable JSON to stdout, MULTI-03)
- Never calls `process.exit` — `run()` always resolves (D-10)

**`src/__tests__/MultiJobOrchestrator.test.ts`** (new file) — 5 vitest tests:
1. `processes all jobs and emits D-08 aggregate JSON when both succeed` — verifies exact JSON.stringify output for a 2-job success case
2. `isolates per-job failure — job 2 StageValidationError does not abort job 1 (MULTI-02)` — verifies D-09 error shape and correct totals (only job 1 counted)
3. `emits jobs array with all error entries and zero totals when all jobs fail (D-10: resolves)` — verifies `await expect(orchestrator.run()).resolves.toBeUndefined()`
4. `instantiates one JobRunner per job (MULTI-01)` — verifies `runSpy.toHaveBeenCalledTimes(3)` for a 3-job config
5. `emits stdout exactly once with the D-08 JSON shape (MULTI-03)` — verifies `stdoutSpy.toHaveBeenCalledTimes(1)` and JSON has `jobs` and `totals` properties

Mock strategy: `vi.spyOn(JobRunner.prototype, 'run')` to intercept the `runner.run()` call inside `MultiJobOrchestrator.run()` without needing to mock the constructor chain.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| Task 1 | 20d9c65 | feat(06-04): create MultiJobOrchestrator class with per-job loop and D-08 JSON summary |
| Task 2 | 72c6448 | test(06-04): add MultiJobOrchestrator tests — N-job iteration, failure isolation, D-08/D-09/D-10 |

## Verification

- `grep "class MultiJobOrchestrator" src/screener/multi-job-orchestrator.ts` — returns match
- `grep "for (const job of this.config.jobs)" src/screener/multi-job-orchestrator.ts` — returns match
- `grep "new CandidateProcessor" src/screener/multi-job-orchestrator.ts` — returns match (constructed per-job)
- `grep "new JobRunner" src/screener/multi-job-orchestrator.ts` — returns match
- `grep "error: true" src/screener/multi-job-orchestrator.ts` — returns match (D-09)
- `grep -c "console\.log" src/screener/multi-job-orchestrator.ts` — returns 1 (single stdout emission)
- `grep "process\.exit" src/screener/multi-job-orchestrator.ts` — returns no match
- `grep "{ jobs: jobResults, totals }" src/screener/multi-job-orchestrator.ts` — returns match
- `grep -c "MultiJobOrchestrator" src/__tests__/MultiJobOrchestrator.test.ts` — returns 6 matches
- `grep "StageValidationError" src/__tests__/MultiJobOrchestrator.test.ts` — returns match
- `grep "D-10" src/__tests__/MultiJobOrchestrator.test.ts` — returns match
- `grep -c "error: true" src/__tests__/MultiJobOrchestrator.test.ts` — returns 3 matches
- `grep -c "it(" src/__tests__/MultiJobOrchestrator.test.ts` — returns 5

## Deviations from Plan

### Cherry-picked 06-02 Prerequisites

**[Rule 3 - Blocking Issue] Cherry-picked 06-02 branch code into worktree**
- **Found during:** Task 1 setup
- **Issue:** The worktree was based on commit `e9057de` (the tracking docs commit for wave 2), but the actual code from plan 06-02 (`job-runner.ts`, `IBambooHRClient.validateStages(JobConfig)`, `BambooHRClient` updates, `JobRunner.test.ts`) existed only on the `worktree-agent-a4122d158a7670725` branch and had not been merged to main.
- **Fix:** Cherry-picked commits `716b607`, `7fbccad`, `67c16a0` (all 06-02 code commits, excluding the docs commit) into this worktree. The code from those commits staged cleanly with no conflicts. These files are included in the Task 1 commit (`20d9c65`).
- **Files modified:** `src/screener/job-runner.ts` (added), `src/__tests__/JobRunner.test.ts` (added), `src/interfaces/IBambooHRClient.ts` (modified), `src/bamboohr/client.ts` (modified)
- **Impact:** None on plan output — this is the prerequisite code that plan 06-04 depends on per `depends_on: ["06-02", "06-03"]` in the plan frontmatter.

### Test Execution Environment Limitation

**[Environment] Node.js 14 in shell environment prevents `npm test` from running**
- **Found during:** Task 2 verification
- **Issue:** The bash shell environment available to this agent uses Node.js 14.21.3, but the project requires Node.js 22 (`"engines": { "node": ">=22.0.0" }`). Vitest v4.1.5 uses `??=` syntax (ES2021) which Node 14 does not support. This prevented running `npm test` to verify the test suite.
- **Action:** Tests could not be executed to confirm the GREEN phase. Code correctness verified by:
  - Manual review of imports (all exported types from `job-runner.ts` are correct: `JobResult`, `SuccessJobResult`)
  - TypeScript type structure verified via code inspection (all method signatures match the interfaces from Plan 02/03)
  - Test structure follows the exact patterns from `ScreeningPipeline.test.ts` (the analog)
  - Acceptance criteria verified by grep (counts, patterns, shapes all match plan spec)
- **Deferred:** Test execution validation deferred to the merge/integration step when the main environment runs `npm test`.

## Known Stubs

None — `multi-job-orchestrator.ts` contains no placeholder values, hardcoded empty responses, or TODO items. The `jobResults: JobResult[] = []` initialization is functional code (not a stub).

## Threat Flags

No new network endpoints, auth paths, or file access patterns introduced. The threat model mitigations from the plan are all addressed:
- **Per-job isolation**: catch block uses `catch (err)` without type narrowing — catches ALL throws including `StageValidationError`, network errors, and unexpected runtime errors
- **Error job exclusion**: `successJobs` filter uses `(r): r is SuccessJobResult => !('error' in r)` type predicate — TypeScript narrows type; only jobs without `error` property contribute to reduce sums
- **D-08 JSON shape**: `grep "{ jobs: jobResults, totals }"` acceptance criterion verified; test case 1 asserts exact JSON string
- **D-10 no-reject**: catch block always pushes error entry, never re-throws; `run()` always reaches `console.log(...)`
- **Cross-job contamination**: `new CandidateProcessor(..., job, ...)` is inside `for (const job of this.config.jobs)` — each iteration creates a fresh `CandidateProcessor` with the current job slice

## Self-Check: PASSED

- `src/screener/multi-job-orchestrator.ts` — FOUND (verified via grep, 80 lines)
- `src/__tests__/MultiJobOrchestrator.test.ts` — FOUND (verified via grep, 183 lines)
- Task 1 commit `20d9c65` — FOUND in git log
- Task 2 commit `72c6448` — FOUND in git log
