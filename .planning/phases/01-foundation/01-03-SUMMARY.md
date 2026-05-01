---
phase: 01-foundation
plan: "03"
subsystem: bamboohr
tags: [typescript, bamboohr, http-client, pagination, basic-auth, stage-validation, esm, nodenext]

# Dependency graph
requires:
  - 01-01 (ESM NodeNext TypeScript project skeleton)
  - 01-02 (src/config/schema.ts — Config type for validateStages parameter)
provides:
  - src/bamboohr/types.ts — BambooHRStatus, BambooHRApplication, ApplicationsResponse interfaces
  - src/bamboohr/client.ts — BambooHRClient with get(), validateStages(), fetchCandidates()
affects:
  - 01-04 (hard-rule evaluator imports BambooHRApplication type)
  - 01-05 (entry point instantiates BambooHRClient and calls validateStages/fetchCandidates)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Basic auth via Buffer.from('apiKey:x').toString('base64') — Node built-in, no deps"
    - "Accept: application/json on every fetch call — required; BambooHR defaults to XML"
    - "Paginated fetch: loop while !paginationComplete, integer page param starting at 1"
    - "Collect-all stage validation: accumulate all mismatches before exit(1)"
    - "applicationId (application.id) vs applicantId (application.applicant.id) distinction enforced in type JSDoc"

key-files:
  created:
    - src/bamboohr/types.ts
    - src/bamboohr/client.ts
    - src/config/schema.ts
  modified:
    - tsconfig.json

key-decisions:
  - "Node built-in fetch over axios/node-fetch — Node 22 includes fetch; zero deps, Alpine-compatible"
  - "Collect-all validation in validateStages() mirrors D-03 philosophy — list all mismatched stages before exiting"
  - "src/config/schema.ts duplicated in this worktree for tsc resolution — canonical version from plan 01-02 will prevail after merge"
  - "tsconfig.json types:[node] added to resolve Buffer/process/fetch/URL globals — required for @types/node to apply"

requirements-completed:
  - BAMB-01
  - CONF-02

# Metrics
duration: 2min
completed: "2026-05-01"
---

# Phase 01 Plan 03: BambooHR HTTP Client Summary

**BambooHR ATS HTTP client with Basic auth, Accept: application/json header enforcement, collect-all stage validation (CONF-02), and full pagination loop until paginationComplete (BAMB-01)**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-01T17:09:38Z
- **Completed:** 2026-05-01T17:12:00Z
- **Tasks:** 2
- **Files modified:** 4 (types.ts created, client.ts created, schema.ts created for worktree tsc, tsconfig.json updated)

## Accomplishments

- Defined three TypeScript interfaces: `BambooHRStatus` (pipeline stage from GET /statuses), `BambooHRApplication` (application record with applicationId/applicantId JSDoc distinction), and `ApplicationsResponse` (pagination envelope with `paginationComplete: boolean`)
- Implemented `BambooHRClient` class with private readonly authHeader built via `Buffer.from('key:x').toString('base64')` for Basic auth; sets `Accept: application/json` on every request to prevent XML responses
- `validateStages()` satisfies CONF-02: fetches live pipeline stages, accumulates ALL mismatches before exiting with code 1 and listing available stage names
- `fetchCandidates()` satisfies BAMB-01: loops incrementing `page` integer until `paginationComplete === true`, returns flat array of all applications

## Task Commits

Each task was committed atomically:

1. **Task 1: Define BambooHR API response types** - `1c72457` (feat)
2. **Task 2: Implement BambooHR client with auth, stage validation, and paginated fetch** - `675c6aa` (feat)

## Files Created/Modified

- `src/bamboohr/types.ts` — BambooHRStatus, BambooHRApplication (with index signature for unknown fields), ApplicationsResponse interfaces
- `src/bamboohr/client.ts` — BambooHRClient class: constructor with Basic auth setup, get<T>(), validateStages(), fetchCandidates()
- `src/config/schema.ts` — Zod config schema (worktree copy matching plan 01-02 output exactly; for tsc resolution)
- `tsconfig.json` — Added `"types": ["node"]` to compilerOptions to resolve Node globals

## Decisions Made

- **Node built-in fetch:** Node 22's native `fetch` used throughout — no axios or node-fetch dependencies. Satisfies CLAUDE.md Alpine compatibility requirement (zero native deps).
- **Collect-all stage validation:** `validateStages()` collects all mismatched stage names before calling `process.exit(1)`, matching D-03's collect-all philosophy. Never fails fast on first mismatch.
- **applicationId vs applicantId:** Type comment in `BambooHRApplication` explicitly marks `id` as applicationId (entity for writes) and `applicant.id` as applicantId (for logging only). Satisfies T-03-05 threat mitigation.
- **Error messages:** `get()` errors include only HTTP status and path — never response bodies (satisfies T-03-01, T-03-02).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] tsconfig.json missing `types: ["node"]`**
- **Found during:** Task 2 verification — `tsc --noEmit` failed with "Cannot find name 'Buffer'", "Cannot find name 'URL'", "Cannot find name 'fetch'", "Cannot find name 'process'"
- **Issue:** The `@tsconfig/node22` preset's `lib` array (`["es2024", "ESNext.Array", "ESNext.Collection", "ESNext.Iterator"]`) does not include dom/fetch types, and TypeScript was not automatically picking up `@types/node` globals without an explicit `types` field
- **Fix:** Added `"types": ["node"]` to `tsconfig.json` compilerOptions — causes TypeScript to load `@types/node` type definitions which provide `Buffer`, `process`, `URL`, and `fetch` globals for Node 22
- **Files modified:** `tsconfig.json`
- **Commit:** `675c6aa`

**2. [Rule 3 - Blocking] src/config/schema.ts created in this worktree**
- **Found during:** Task 2 — `client.ts` imports `Config` from `../config/schema.js` but plan 01-02 runs in a parallel worktree
- **Issue:** tsc resolves imports at compile time; the file must exist in this worktree for the `types` constraint on `validateStages(config: Config)` to pass
- **Fix:** Created `src/config/schema.ts` with identical content to plan 01-02's output (same Zod schema structure). After both worktrees merge to main, the file will be unified with no conflict
- **Files modified:** `src/config/schema.ts`
- **Commit:** `675c6aa`

## Known Stubs

None — the client provides real API calls; no hardcoded empty values flow to consumers.

## Threat Flags

No new threat surface beyond what the plan's threat model covers. All T-03-0x mitigations confirmed applied:
- T-03-01: `authHeader` is `private readonly`; error messages reference path+status only
- T-03-02: `get()` error log includes only `path` and `res.status` — never response body
- T-03-05: Type JSDoc explicitly labels applicationId vs applicantId to prevent misuse

---
*Phase: 01-foundation*
*Completed: 2026-05-01*
