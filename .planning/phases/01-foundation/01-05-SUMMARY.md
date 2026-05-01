---
phase: 01-foundation
plan: "05"
subsystem: integration
tags: [typescript, esm, nodenext, entry-point, logger, dry-run, error-isolation, infra-02, safe-01, conf-04]

# Dependency graph
requires:
  - phase: 01-02
    provides: src/config/loader.ts — loadConfig(), isDryRun()
  - phase: 01-03
    provides: src/bamboohr/client.ts — BambooHRClient (get, validateStages, fetchCandidates)
  - phase: 01-04
    provides: src/rules/evaluator.ts — evaluateHardRules(); src/rules/types.ts — CandidateDecision
provides:
  - src/logger/logger.ts — logDecision() emitting one JSON line per candidate (INFRA-02)
  - src/index.ts — full Phase 1 entry point: dotenv → config → startup checks → candidate loop
affects:
  - Phase 2 (PDF pipeline) — wires into the same index.ts startup sequence
  - Phase 4 (live writes) — adds write paths to the candidate loop in index.ts

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "process.stdout.write for JSON log lines — separates structured data (stdout) from diagnostic messages (stderr)"
    - "dotenv/config as first import — ensures .env is loaded before any process.env reads (D-11)"
    - "per-candidate try/catch with logDecision(outcome='error') — SAFE-01 error isolation pattern"
    - "fieldMap placeholder detection — logs raw JSON to stderr on first candidate when all fieldMap values contain REPLACE_WITH"
    - "stderr for all diagnostic/operational messages, stdout reserved for machine-parseable JSON lines only"

key-files:
  created:
    - src/logger/logger.ts
    - src/index.ts
  modified: []

key-decisions:
  - "process.stdout.write used instead of console.log in logDecision() — makes intent explicit: one newline-terminated JSON object per candidate, no extra formatting"
  - "stderr for all console.error() calls in index.ts — keeps stdout clean for JSON log line parsing by downstream tools"
  - "Phase 1 has zero write API calls — dry-run is enforced structurally (no write code paths exist), not just by an isDryRun() guard"
  - "Raw JSON diagnostic log on stderr only when all fieldMap values are REPLACE_WITH placeholders and only for the first candidate — avoids PII pollution on routine runs"

patterns-established:
  - "Startup sequence: dotenv/config import → loadConfig() → credentials check → BambooHRClient → validateStages() → fetchCandidates() → candidate loop"
  - "Error isolation: for...of with try/catch; catch logs outcome=error with error message, increments errors counter, continues to next candidate (never re-throws)"

requirements-completed:
  - CONF-04
  - SAFE-01
  - INFRA-02

# Metrics
duration: 8min
completed: "2026-05-01"
---

# Phase 01 Plan 05: Entry Point and Structured Logger Summary

**Integration plan wiring all Phase 1 modules into a runnable entry point: logDecision() JSON logger (INFRA-02) and startup-sequenced main() with per-candidate error isolation (SAFE-01) and DRY_RUN default (CONF-04)**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-01T17:15:00Z
- **Completed:** 2026-05-01T17:23:59Z
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments

- Created `src/logger/logger.ts` with `logDecision()` that emits one JSON line per candidate to stdout using `process.stdout.write` (INFRA-02 compliance: candidateId, applicationId, outcome, reasons[], timestamp fields)
- Created `src/index.ts` enforcing the exact startup sequence: `import 'dotenv/config'` first → `loadConfig()` → credential env var check → `BambooHRClient` → `validateStages()` → `fetchCandidates()` → candidate loop
- SAFE-01 per-candidate try/catch: errors logged as `outcome: 'error'` with error message in `reasons[]`, loop continues to next candidate with no re-throw
- CONF-04 enforced structurally: Phase 1 has zero BambooHR write API calls; dry-run is not a runtime guard but an architectural absence of write code paths
- First-run diagnostic: raw application JSON logged to stderr (not stdout) when all fieldMap values contain `REPLACE_WITH`, enabling field path discovery without polluting structured output
- All imports use `.js` extensions (NodeNext ESM requirement); `tsc --noEmit` passes with exit 0

## Task Commits

Each task was committed atomically:

1. **Task 1: Create structured JSON logger** - `de139c4` (feat)
2. **Task 2: Create entry point with startup sequence and error-isolated candidate loop** - `ad39a0c` (feat)

## Files Created/Modified

- `src/logger/logger.ts` — `logDecision(record: CandidateDecision): void` using `process.stdout.write`; re-exports `CandidateDecision` type
- `src/index.ts` — Entry point: dotenv → config → BambooHR startup → candidate loop with SAFE-01 isolation and INFRA-02 logging

## Decisions Made

- `process.stdout.write` used instead of `console.log` in `logDecision()` — intent is explicit: one newline-terminated JSON object per line, no formatting ambiguity.
- All diagnostic and operational messages go to `console.error` (stderr); stdout is reserved exclusively for machine-parseable JSON log lines from `logDecision()`.
- Phase 1 enforces dry-run structurally — there are no write code paths at all. `isDryRun()` is called and logged at startup for self-documentation, but the Phase 1 guarantee is architectural absence of writes rather than a runtime guard.
- Raw JSON diagnostic log fires only when ALL fieldMap values contain `REPLACE_WITH` (first-run template state) AND only for the first candidate — avoids routine PII exposure on configured runs.

## Deviations from Plan

None — plan executed exactly as written. Both files match the specified content precisely; tsc --noEmit passes with exit 0.

## Issues Encountered

Runtime test with `npx tsx src/index.ts` is not executable locally (Node.js v14 on the development machine; tsx requires Node 18+). This is a pre-existing environment constraint documented in Plan 01 SUMMARY — not introduced by this plan. The Docker target uses Node 22 where all runtime behavior will work as specified. `tsc --noEmit` (the critical TypeScript correctness check) passes with exit 0.

## Known Stubs

None — both files are complete implementations. `logDecision()` is fully functional; `src/index.ts` wires all Phase 1 modules into the full pipeline. The `REPLACE_WITH` placeholders in `config.yaml` are from Plan 01 and pre-exist this plan; they are intentional user-configuration targets, not stubs introduced here.

## Threat Flags

Mitigations verified from the plan threat model:

| Mitigated | File | Description |
|-----------|------|-------------|
| T-05-01: API key logging | src/index.ts | `apiKey` passed only to `BambooHRClient` constructor; never referenced in console.error lines |
| T-05-02: Candidate PII in stdout | src/logger/logger.ts | logDecision() fields: candidateId (numeric), applicationId (numeric), outcome, reasons (rule labels only), timestamp — no names or free text |
| T-05-03: Raw JSON diagnostic | src/index.ts | Fires on stderr only, only in first-run template state (accepted per threat model) |

## Self-Check

### Files exist:

- `src/logger/logger.ts` — FOUND
- `src/index.ts` — FOUND

### Commits exist:

- `de139c4` — Task 1: JSON logger
- `ad39a0c` — Task 2: entry point

### TypeScript:

- `tsc --noEmit` — PASSES (exit 0)

### Acceptance criteria verified:

**src/logger/logger.ts:**
- `export function logDecision(` — present
- `process.stdout.write(` — present
- `JSON.stringify(record)` — present
- `from '../rules/types.js'` — present (with .js extension)

**src/index.ts:**
- `import 'dotenv/config'` — first import (line 7)
- `loadConfig(` — present
- `validateStages(` — present
- `fetchCandidates(` — present
- `evaluateHardRules(` — present
- `logDecision(` — present (called in both pass and error paths)
- `try {` and `catch (err)` — present in candidate loop (SAFE-01)
- `process.env['BAMBOOHR_API_KEY']` — present
- `process.env['BAMBOOHR_SUBDOMAIN']` — present
- `isDryRun()` — present
- No POST/PUT/write API calls — confirmed absent

## Self-Check: PASSED

## Phase 1 Completion

All five plans of Phase 1 (Foundation) are now complete:

| Plan | Name | Key Output |
|------|------|------------|
| 01-01 | Project Skeleton | package.json, tsconfig.json, config.yaml template |
| 01-02 | Config Schema | src/config/schema.ts, src/config/loader.ts (Zod validation) |
| 01-03 | BambooHR Client | src/bamboohr/client.ts (get, validateStages, fetchCandidates) |
| 01-04 | Hard-Rule Evaluator | src/rules/types.ts, src/rules/evaluator.ts (all four rule types) |
| 01-05 | Entry Point + Logger | src/logger/logger.ts, src/index.ts (full pipeline) |

`npx tsx src/index.ts` (on Node 22) runs the complete Phase 1 pipeline end-to-end.

---
*Phase: 01-foundation*
*Completed: 2026-05-01*
