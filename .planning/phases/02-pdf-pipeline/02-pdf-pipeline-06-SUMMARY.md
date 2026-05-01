---
phase: 02-pdf-pipeline
plan: "06"
subsystem: config
tags: [zod, typescript, bamboohr, gdpr, config]

# Dependency graph
requires:
  - phase: 02-pdf-pipeline
    plan: "05"
    provides: "validateStages() returning Promise<Map<string, number>> (WR-03 client side)"
provides:
  - "intake stage field in Zod config schema (CR-03)"
  - "intake: 'New' in config.yaml stages block"
  - "index.ts wires stageMap from validateStages() — single API call for stage resolution"
  - "hasPlaceholders fixed: length===0||some() guard eliminates vacuous-true bug (WR-01)"
  - "PII-free structure-only log replaces JSON.stringify(detail) (WR-02)"
affects:
  - 03-agent-evaluation

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Config-driven intake stage: stage name read from config.yaml, ID resolved via stageMap"
    - "Single API call pattern: validateStages() return value reused, no duplicate HTTP round-trip"
    - "GDPR-safe logging: typeof-based structure log instead of full JSON value dump"

key-files:
  created: []
  modified:
    - src/config/schema.ts
    - config.yaml
    - src/index.ts

key-decisions:
  - "CR-03: intake stage added to both Zod schema and config.yaml so stage name is always configurable — never hardcoded"
  - "WR-03 (index side): stageMap returned by validateStages() is captured and used for intakeId lookup, eliminating the duplicate /applicant_tracking/statuses HTTP call"
  - "WR-01: hasPlaceholders uses length===0||some() — empty fieldMap and partially-placeholder fieldMap both trigger discovery guard correctly"
  - "WR-02: full JSON.stringify(detail) replaced with typeof-based structure log per GDPR; no candidate name/email/address written to stderr"

patterns-established:
  - "Defensive impossible-state guard after stageMap lookup (intakeId undefined branch after validateStages passed)"

requirements-completed: [BAMB-04, PDF-01, PDF-02, RULE-03]

# Metrics
duration: 15min
completed: 2026-05-01
---

# Phase 2 Plan 06: Gap-Closure — Config Layer and Index.ts Bug Fixes Summary

**Config-driven intake stage via Zod schema + config.yaml, single-call stageMap wiring in index.ts, corrected hasPlaceholders guard, and GDPR-safe structure-only log replacing the PII JSON dump**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-01T00:00:00Z
- **Completed:** 2026-05-01
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Added `intake: z.string().min(1)` as the first field in the `stages` Zod schema, and `intake: "New"` as the first entry in config.yaml stages block — eliminates the hardcoded "New" string (CR-03)
- Replaced the ignored `await client.validateStages(config)` and duplicate `/applicant_tracking/statuses` fetch with a single `const stageMap = await client.validateStages(config)` call; intakeId resolved via `stageMap.get(config.job.stages.intake)` — one HTTP round-trip saved per run (WR-03)
- Fixed vacuous-truth `hasPlaceholders` from `every(...)` to `length === 0 || some(...)` so an empty fieldMap triggers the discovery path and a mixed fieldMap (some real, some REPLACE_WITH) also triggers it (WR-01)
- Replaced `JSON.stringify(detail, null, 2)` PII log with a `typeof`-based structure log that outputs only key names and value types — no candidate name, email, address, or answer logged to stderr (WR-02 / GDPR)
- `tsc --noEmit` exits 0 with no output after all changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Add intake stage to Zod schema and config.yaml** - `c49fae7` (feat)
2. **Task 2: Wire stageMap in index.ts; fix hasPlaceholders and PII log** - `751671d` (fix)

## Files Created/Modified

- `src/config/schema.ts` — added `intake: z.string().min(1)` as first field in `stages` z.object()
- `config.yaml` — added `intake: "New"` as first entry in `stages` block under `job`
- `src/index.ts` — three targeted changes: stageMap capture + intakeId lookup, hasPlaceholders fix, structure-only log

## Decisions Made

- Used `length === 0 || some()` for hasPlaceholders rather than `every()` to correctly handle both the empty-fieldMap edge case and the mixed-placeholder case
- The impossible-state guard (`intakeId === undefined`) is retained after `stageMap.get()` as a defensive check even though `validateStages()` already validated the stage name — belt-and-suspenders for program correctness
- Structure log uses `Object.keys(detail).map(k => [k, typeof detail[k]])` rather than a deep schema walk — sufficient for field discovery, zero PII risk

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- `npx tsc` invoked the wrong binary (project uses local TypeScript not a global install); used `./node_modules/.bin/tsc` via the main project `node_modules` instead. No impact on deliverable.

## Known Stubs

- `src/index.ts` line 125: `reasons: ['CV extracted; pending Phase 3 agent evaluation']` — intentional Phase 2 placeholder. Phase 3 (Agent Evaluation) will replace this with real GPT-4o evaluation reasons. Does not block this plan's goal.

## Threat Flags

None — changes are internal config/logic only. No new network endpoints, auth paths, or trust boundaries introduced. The stderr log change (WR-02) removes a threat (T-02-06-01) rather than adding one.

## Next Phase Readiness

- All four code-review bugs from the 02-pdf-pipeline review that touched config/index.ts are now fixed (CR-03, WR-01, WR-02, WR-03 index side)
- Phase 3 (Agent Evaluation) can consume `config.job.stages.intake` / `stageMap` pattern and a clean stderr log
- No blockers

---
*Phase: 02-pdf-pipeline*
*Completed: 2026-05-01*

## Self-Check: PASSED

Files exist:
- FOUND: src/config/schema.ts (intake field)
- FOUND: config.yaml (intake: "New")
- FOUND: src/index.ts (stageMap, hasPlaceholders fix, structure log)

Commits exist:
- FOUND: c49fae7 — feat(02-06): add intake stage to Zod schema and config.yaml
- FOUND: 751671d — fix(02-06): wire stageMap in index.ts; fix hasPlaceholders and PII log
