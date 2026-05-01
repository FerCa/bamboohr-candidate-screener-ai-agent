---
phase: 01-foundation
plan: "02"
subsystem: config
tags: [typescript, zod, js-yaml, esm, nodenext, config, validation, fail-fast]

# Dependency graph
requires:
  - phase: 01-01
    provides: ESM NodeNext TypeScript project skeleton with js-yaml, zod, dotenv installed
provides:
  - src/config/schema.ts — Zod v4 schema for all four hard-rule types plus fieldMap; exports configSchema and Config type
  - src/config/types.ts — re-exports Config and AppConfig for convenient downstream imports
  - src/config/loader.ts — loadConfig() reads YAML synchronously, validates with Zod, exits with clear error on failure; isDryRun() defaults to true
affects:
  - 01-03 (BambooHR client imports Config type for constructor args)
  - 01-04 (hard-rule evaluator imports Config type for rule evaluation)
  - 01-05 (entry point calls loadConfig() and isDryRun() at startup)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Fail-fast config: yaml.load() + configSchema.safeParse() at startup; process.exit(1) on any failure before network calls"
    - "Dry-run guard: isDryRun() returns true by default; only false when LIVE_MODE=true (not DRY_RUN — uses positive opt-in for live mode)"
    - "Zod refine on hardRules: at least one rule required — prevents misconfiguration with empty hardRules block"

key-files:
  created:
    - src/config/schema.ts
    - src/config/types.ts
    - src/config/loader.ts
  modified:
    - tsconfig.json (added types:node for @types/node ambient declarations)

key-decisions:
  - "hardRules.refine() requires at least one rule — catches the silent misconfiguration where hardRules block exists but is empty"
  - "isDryRun() checks LIVE_MODE=true (not DRY_RUN) — positive opt-in for live mode is safer; any non-'true' value defaults to dry-run"
  - "loadConfig() uses safeParse not parse — formats Zod errors with result.error.format() for human-readable startup messages before exiting"
  - "tsconfig.json types:[node] added to resolve @types/node ambient globals (console, process, node:fs) — base @tsconfig/node22 preset does not include it"

patterns-established:
  - "Config load pattern: readFileSync + yaml.load() + configSchema.safeParse() — synchronous at startup, exits on any failure"
  - "ESM import pattern: all relative imports use .js extension (src/config/loader.ts imports from './schema.js')"

requirements-completed:
  - CONF-01
  - CONF-04

# Metrics
duration: 8min
completed: "2026-05-01"
---

# Phase 01 Plan 02: Config Schema and Loader Summary

**Zod v4 schema for four hard-rule types plus fieldMap, with fail-fast YAML loader that exits before any BambooHR API call on invalid config**

## Performance

- **Duration:** 8 min
- **Started:** 2026-05-01T19:35:00Z
- **Completed:** 2026-05-01T19:43:00Z
- **Tasks:** 2
- **Files modified:** 4 (schema.ts, types.ts, loader.ts created; tsconfig.json modified)

## Accomplishments

- Created `src/config/schema.ts` with Zod v4 nested schema covering all four hard-rule types (maxSalary, requiredFields, requiredBoolean, requiredKeyword) plus fieldMap; includes a `.refine()` constraint requiring at least one rule
- Created `src/config/types.ts` re-exporting `Config` and `AppConfig` types for convenient downstream imports in plans 03–05
- Created `src/config/loader.ts` implementing `loadConfig()` (fail-fast YAML load + Zod validation, exits with human-readable error before any network call) and `isDryRun()` (CONF-04 dry-run guard)
- Fixed missing `"types": ["node"]` in tsconfig.json to resolve ambient Node.js type declarations

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Zod schema and Config types** - `173b097` (feat)
2. **Task 2: Create fail-fast config loader** - `1abe2e8` (feat)

## Files Created/Modified

- `src/config/schema.ts` - Zod v4 schema for configSchema; exports Config type via z.infer
- `src/config/types.ts` - Re-exports Config and AppConfig for downstream import convenience
- `src/config/loader.ts` - loadConfig() and isDryRun() — CONF-01 and CONF-04 implementation
- `tsconfig.json` - Added `"types": ["node"]` to include @types/node ambient declarations

## Decisions Made

- `hardRules` uses `.refine()` requiring at least one rule — an empty `hardRules:` block would silently allow all candidates through; the constraint catches this misconfiguration at startup.
- `isDryRun()` checks `LIVE_MODE !== 'true'` rather than `DRY_RUN === 'true'` — positive opt-in for live mode is safer; any absent or malformed LIVE_MODE value defaults to dry-run.
- `loadConfig()` uses `safeParse` (not `parse`) so we control the error format: Zod errors are serialized with `result.error.format()` into human-readable JSON before the `process.exit(1)`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added types:node to tsconfig.json**
- **Found during:** Task 2 (config loader implementation)
- **Issue:** `tsc --noEmit` failed with TS2591 errors: `Cannot find name 'process'`, `Cannot find name 'console'`, and `Cannot find name 'node:fs'`. The base `@tsconfig/node22` preset's `lib` only includes ES2024 entries — no Node.js ambient globals. `@types/node` was installed but not referenced in `types`.
- **Fix:** Added `"types": ["node"]` to `tsconfig.json` compilerOptions to explicitly include the @types/node declarations.
- **Files modified:** `tsconfig.json`
- **Verification:** `tsc --noEmit` exits 0 with no errors after the fix.
- **Committed in:** `1abe2e8` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Required fix — tsc would not compile without it. No scope creep; tsconfig fix is minimal and correct.

## Issues Encountered

- `tsc --noEmit` produced TS2591/TS2584 errors due to missing `types:node` in tsconfig. Fixed immediately as a Rule 3 blocking issue. The `@tsconfig/node22` base preset does not auto-include `@types/node` ambient types when only `lib` is specified.

## Known Stubs

None — all three files deliver complete, non-stub implementations. The config schema validates real config.yaml content; the loader exits cleanly on failure.

## Threat Flags

No new network endpoints or auth paths introduced. The threat model items for this plan (T-02-01, T-02-02) are both implemented:
- T-02-01: `yaml.load()` is used without custom schemas — safe in js-yaml v4
- T-02-02: `isDryRun()` checks exact string `'true'` — any other value defaults to dry-run

## Self-Check

### Files exist:
- `src/config/schema.ts` — FOUND
- `src/config/types.ts` — FOUND
- `src/config/loader.ts` — FOUND

### Commits exist:
- `173b097` — Task 1 commit
- `1abe2e8` — Task 2 commit

### TypeScript:
- `tsc --noEmit` — PASSES (exit 0)

## Self-Check: PASSED

## Next Phase Readiness

- Plan 03 (BambooHR client) can proceed immediately — imports `Config` from `src/config/types.js` for subdomain/API key extraction
- Plan 04 (hard-rule evaluator) can proceed — imports `Config` type for rule evaluation functions
- Plan 05 (entry point) can proceed — calls `loadConfig()` and `isDryRun()` at startup
- No blockers for remaining Phase 1 plans

---
*Phase: 01-foundation*
*Completed: 2026-05-01*
