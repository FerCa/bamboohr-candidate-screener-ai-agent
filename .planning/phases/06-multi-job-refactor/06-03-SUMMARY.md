---
phase: 06-multi-job-refactor
plan: 03
subsystem: pipeline
tags: [pipeline, evaluator, candidate-processor, JobConfig, multi-job, refactor]
dependency_graph:
  requires: [06-01]
  provides: [evaluateHardRules-JobConfig, CandidateProcessor-JobConfig]
  affects: [src/rules/evaluator.ts, src/pipeline/candidate-processor.ts]
tech_stack:
  added: []
  patterns: [per-job slice DI, JobConfig type narrowing]
key_files:
  modified:
    - src/rules/evaluator.ts
    - src/pipeline/candidate-processor.ts
  created: []
decisions:
  - "evaluateHardRules parameter narrowed from full Config to JobConfig — both hardRules and fieldMap exist at top level of JobConfig, so no path changes needed inside the function body"
  - "CandidateProcessor private field renamed config → job; all this.config.job.* accesses become this.job.* and this.config.softRules becomes this.job.softRules"
metrics:
  duration: "~5 minutes"
  completed: "2026-05-04"
  tasks: 2
  files_changed: 2
---

# Phase 6 Plan 03: CandidateProcessor and evaluateHardRules JobConfig Migration Summary

Updates `evaluateHardRules` and `CandidateProcessor` to accept a `JobConfig` slice instead of the full `Config` object. Both files previously accessed `config.job.*`, `config.hardRules`, and `config.fieldMap` — all of which moved inside the per-job `JobConfig` entry after Plan 01's schema change. After this plan, both files are fully decoupled from the multi-job `Config` type.

## What Was Built

**`src/rules/evaluator.ts`** — Changed import from `Config` to `JobConfig`. Updated `evaluateHardRules` parameter from `config: Config` to `job: JobConfig`. Updated destructure from `const { hardRules, fieldMap } = config` to `const { hardRules, fieldMap } = job`. All four rule evaluation paths (`maxSalary`, `requiredFields`, `requiredBoolean`, `requiredKeyword`) and the `resolveField` helper are unchanged — both `hardRules` and `fieldMap` exist at the top level of `JobConfig`, so no access path changes were needed inside the function body.

**`src/pipeline/candidate-processor.ts`** — Changed import from `Config` to `JobConfig`. Renamed constructor private field from `config: Config` to `job: JobConfig`. Updated all 6 internal references:
- `evaluateHardRules(this.config, ...)` → `evaluateHardRules(this.job, ...)`
- `this.config.job.stages.fail` → `this.job.stages.fail` (2 occurrences: hard-rule fail path and needsReview path)
- `this.config.job.stages.pass` / `.fail` → `this.job.stages.pass` / `this.job.stages.fail` (soft-eval live path)
- `this.config.softRules` → `this.job.softRules` (soft evaluator call site)

## Commits

| Task | Commit | Message |
|------|--------|---------|
| Task 1 | 537de80 | feat(06-03): update evaluateHardRules signature from Config to JobConfig |
| Task 2 | acafa49 | feat(06-03): update CandidateProcessor constructor from Config to JobConfig |

## Verification

- `grep "JobConfig" src/rules/evaluator.ts` — 2 matches (import + parameter)
- `grep "JobConfig" src/pipeline/candidate-processor.ts` — 2 matches (import + field)
- `grep "config\.job\." src/rules/evaluator.ts` — 0 matches
- `grep "config\.job\." src/pipeline/candidate-processor.ts` — 0 matches
- `grep "this\.config" src/pipeline/candidate-processor.ts` — 0 matches
- `grep "this\.job\." src/pipeline/candidate-processor.ts` — 5 matches (stages.fail x2, stages.pass, stages.fail, softRules)

## Deviations from Plan

None — plan executed exactly as written. Both files required only mechanical substitutions; no logic was touched.

## Known Stubs

None — these files contain no UI rendering, placeholder text, or hardcoded empty values. The changes are pure type signature updates with equivalent runtime behavior.

## Threat Flags

No new network endpoints, auth paths, or file access patterns introduced. The threat mitigations from the plan's threat model are satisfied:
- `evaluateHardRules` receives `this.job` (fixed at `CandidateProcessor` construction time) — no cross-job hardRules contamination possible
- `grep "this\.config"` acceptance criterion guards against partial refactor leaving stale references

## Self-Check: PASSED

- `src/rules/evaluator.ts` — file exists and contains `JobConfig`
- `src/pipeline/candidate-processor.ts` — file exists and contains `JobConfig`
- Task 1 commit `537de80` present in git log
- Task 2 commit `acafa49` present in git log
