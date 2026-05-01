---
phase: 02-pdf-pipeline
plan: "05"
subsystem: api
tags: [bamboohr, typescript, pdf, bug-fix]

# Dependency graph
requires:
  - phase: 02-pdf-pipeline
    provides: Initial BambooHR client and extract-cv pipeline from plans 02-01 through 02-04

provides:
  - Fixed downloadPdf() with correct applicantId parameter (CR-02)
  - Fixed candidatePaths fallback — no double /v1, correct entity ID (CR-01)
  - validateStages() returns Promise<Map<string,number>> instead of Promise<void> (WR-03)
  - Runtime positive-integer validation of resumeFileId (CR-04)
  - Updated extract-cv.ts call site passing applicantId to downloadPdf()

affects:
  - 02-pdf-pipeline-06
  - 03-agent-evaluation

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Runtime type narrowing via typeof + Number.isInteger + > 0 instead of unsafe 'as T' casts"
    - "validateStages() returns stage map to avoid duplicate API calls at startup"

key-files:
  created: []
  modified:
    - src/bamboohr/client.ts
    - src/pipeline/extract-cv.ts

key-decisions:
  - "Use applicantId (not applicationId) in employee-files fallback path — the EMPLOYEES entity owns files, not the APPLICATION entity"
  - "Strip /v1 prefix from candidatePaths[1] since baseUrl already includes /api/v1"
  - "validateStages() now returns Map<string,number> to allow index.ts to reuse it without a second API call"
  - "Runtime fileId validation rejects non-integer, negative, zero, or non-number values and returns needsReview rather than crashing"

patterns-established:
  - "Positive-integer guard pattern: typeof x === 'number' && Number.isInteger(x) && x > 0"

requirements-completed:
  - BAMB-04
  - PDF-01
  - PDF-02
  - RULE-03

# Metrics
duration: 8min
completed: 2026-05-01
---

# Phase 2 Plan 05: Fix CR-01/CR-02/CR-04/WR-03 — PDF download root-cause bugs Summary

**Fixed four root-cause bugs: double /v1 in fallback PDF path, wrong entity ID (applicationId vs applicantId), unsafe fileId cast, and validateStages() returning void instead of stage Map**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-01T22:31:00Z
- **Completed:** 2026-05-01T22:39:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- CR-01 fixed: Removed spurious `/v1` prefix from `candidatePaths[1]` — `baseUrl` already ends with `/api/v1`, so the concatenated path was `.../api/v1/v1/employees/...` (404 guaranteed)
- CR-02 fixed: Added `applicantId` parameter to `downloadPdf()` and updated `candidatePaths[1]` to use `applicantId` (not `applicationId`) — files are owned by the APPLICANT entity, not the APPLICATION entity
- CR-04 fixed: Replaced unsafe `rawFileId as number` cast with runtime guard: `typeof rawFileId === 'number' && Number.isInteger(rawFileId) && rawFileId > 0`; invalid values return `needsReview('extraction-failed')` instead of silently passing a bad value to the download endpoint
- WR-03 (client side) fixed: Changed `validateStages()` return type from `Promise<void>` to `Promise<Map<string, number>>`; returns `new Map(statuses.map((s) => [s.name, s.id]))` so callers can reuse the stage map without a second API call
- TypeScript compiles cleanly (`tsc --noEmit` exits 0) after both changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix downloadPdf() and validateStages() in BambooHRClient** - `2c9032e` (fix)
2. **Task 2: Fix rawFileId validation and update downloadPdf call site in extract-cv.ts** - `87ce197` (fix)

**Plan metadata:** committed with SUMMARY.md

## Files Created/Modified

- `src/bamboohr/client.ts` — Three targeted changes: (1) `validateStages()` now returns `Promise<Map<string, number>>` and ends with `return new Map(statuses.map((s) => [s.name, s.id]))`, (2) `downloadPdf()` gains `applicantId: number` as second parameter, (3) `candidatePaths[1]` changed from `/v1/employees/${applicationId}/files/${fileId}` to `/employees/${applicantId}/files/${fileId}`
- `src/pipeline/extract-cv.ts` — Two targeted changes: (1) `rawFileId` block replaced with runtime positive-integer validation (typeof + Number.isInteger + > 0), null path returns `needsReview`; (2) `downloadPdf(applicationId, resumeFileId)` call updated to `downloadPdf(applicationId, applicantId, resumeFileId)`

## Decisions Made

- Used `applicantId` (from `detail.applicant.id`, already in scope at line 38) as the second argument to `downloadPdf()` — no new variable needed
- Initialized `let statuses: BambooHRStatus[] = []` before the try block to satisfy TypeScript's definite-assignment analysis (process.exit(1) is not typed as `never` in this context)
- Log message on invalid fileId includes both `JSON.stringify(rawFileId)` and `typeof rawFileId` to aid diagnosis when the field name assumption turns out to be wrong on first DRY_RUN

## Deviations from Plan

None — plan executed exactly as written. All four changes match the spec in the plan's `<interfaces>` and `<action>` sections precisely.

## Issues Encountered

- `npx tsc --noEmit` in the worktree failed because `node_modules` is not installed in the worktree directory (only in the main repo). Used `/path/to/project/node_modules/.bin/tsc --noEmit` instead — same binary, same `tsconfig.json`, same result (exit 0).

## User Setup Required

None — no external service configuration required. Changes are code-only bug fixes.

## Next Phase Readiness

- `downloadPdf()` is now structurally correct for both path variants — the ATS path (primary) and the employee-files fallback (fixed). First live DRY_RUN will confirm which path BambooHR actually serves.
- `validateStages()` returning `Map<string, number>` unblocks plan 02-06 (WR-03 consumer side in index.ts) which uses the map to look up stage IDs without a second API call.
- TypeScript is clean — no compile errors to carry forward.

## Self-Check

**Commits verified:**
- `2c9032e` — present (`git log --oneline` confirmed)
- `87ce197` — present (`git log --oneline` confirmed)

**Files verified (post-commit):**
- `src/bamboohr/client.ts`: `grep -c "/v1/employees" = 0`, `grep -n "applicantId: number"` at line 120, `grep -n "Promise<Map<string, number>>"` at line 61, `grep -n "new Map(statuses.map"` at line 90
- `src/pipeline/extract-cv.ts`: `grep -c "rawFileId as number" = 0`, `grep -n "Number.isInteger(rawFileId)"` at line 56, `grep -n "downloadPdf(applicationId, applicantId, resumeFileId)"` at line 79
- `tsc --noEmit` exits 0

## Self-Check: PASSED

---
*Phase: 02-pdf-pipeline*
*Completed: 2026-05-01*
