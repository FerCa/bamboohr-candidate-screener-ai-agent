---
phase: 06-multi-job-refactor
plan: 01
subsystem: config
tags: [config, schema, zod, backward-compatibility, multi-job]
dependency_graph:
  requires: []
  provides: [JobConfig, jobEntrySchema, configSchema-jobs-array, loadConfig-normalization]
  affects: [src/config/schema.ts, src/config/loader.ts, src/config/types.ts]
tech_stack:
  added: []
  patterns: [Zod refine guard, backward-compatible normalization, per-job slice type]
key_files:
  modified:
    - src/config/schema.ts
    - src/config/loader.ts
    - src/config/types.ts
  created:
    - src/__tests__/schema.test.ts
decisions:
  - "jobEntrySchema exported from schema.ts — both the schema and JobConfig type exported for test and downstream use"
  - "Normalization block uses let raw reassignment — no ConfigError thrown on legacy shape, Zod handles validation after normalization"
  - "hardRules refine checks all four rule types (maxSalary, requiredFields, requiredBoolean, requiredKeyword)"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-04"
  tasks: 2
  files_changed: 4
---

# Phase 6 Plan 01: Config Layer Multi-Job Extension Summary

Extends the Zod config schema to support a `jobs[]` array (D-01) while staying backward-compatible with the legacy single-job `job:` YAML shape (D-02). Establishes the `JobConfig` type contract that all downstream files in Plans 02–04 depend on.

## What Was Built

**`src/config/schema.ts`** — Rewrote `configSchema` from a flat `{ job: ... }` shape to `{ jobs: z.array(jobEntrySchema).min(1) }`. Added `jobEntrySchema` containing all 5 per-job fields (openingId, stages, hardRules, fieldMap, softRules) with two security-relevant `refine` guards:
- `openingId` rejects any value starting with `REPLACE_WITH` — prevents placeholder from reaching a live run
- `hardRules` requires at least one rule — prevents empty config from passing all candidates
- Exported `JobConfig` type (inferred from `jobEntrySchema`) for downstream consumers

**`src/config/loader.ts`** — Inserted Step 1b normalization block between YAML parse and Zod validation. Detects legacy `job:` key (without `jobs:`) and silently promotes it to `{ jobs: [{ openingId, stages, hardRules, fieldMap, softRules }] }`. Existing `ConfigError` throw pattern and `isDryRun()` export preserved exactly.

**`src/config/types.ts`** — Added `export type { JobConfig } from './schema.js'` alongside existing `Config` and `AppConfig` re-exports.

**`src/__tests__/schema.test.ts`** — TDD test file (6 tests): valid job entry, REPLACE_WITH guard, min(1) array, empty hardRules guard, and old `job:` shape rejection.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| RED (TDD) | 0bdd29f | test(06-01): add failing tests for jobs-array configSchema and jobEntrySchema |
| Task 1 GREEN | 0b31d57 | feat(06-01): rewrite configSchema to jobs-array shape and export JobConfig |
| Task 2 | 6f81fe4 | feat(06-01): add backward-compatible normalization to loadConfig and re-export JobConfig |

## Verification

- `npx tsc --noEmit` — zero errors in `src/config/` files; downstream errors in `screening-pipeline.ts`, `candidate-processor.ts`, `client.ts`, `evaluator.ts` are expected (fixed in Plans 02–03)
- All 43 tests pass (6 new schema tests + 37 pre-existing)
- `grep "export const jobEntrySchema" src/config/schema.ts` — match found
- `grep "export type JobConfig" src/config/schema.ts` — match found
- `grep "jobs: z.array(jobEntrySchema).min(1)" src/config/schema.ts` — match found
- `grep "'job' in raw" src/config/loader.ts` — match found
- `grep "JobConfig" src/config/types.ts` — match found

## Deviations from Plan

None — plan executed exactly as written. All sub-schemas preserved verbatim. Both tasks completed without deviations.

## Known Stubs

None — this plan only modifies config layer schema/types with no UI rendering or data sourcing.

## Threat Flags

No new network endpoints, auth paths, or file access patterns introduced. The two Zod `refine` guards implement the threat mitigations listed in the plan's threat model (REPLACE_WITH placeholder rejection, empty hardRules rejection).

## Self-Check: PASSED

All created/modified files exist on disk and all 3 task commits are present in git log.
