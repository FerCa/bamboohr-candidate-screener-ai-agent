---
phase: 02-pdf-pipeline
plan: "02"
subsystem: api
tags: [pdf-parse, bamboohr, binary-download, buffer, fetch]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: BambooHRClient class with get<T>() and Basic Auth pattern
provides:
  - pdf-parse@1.1.4 installed as pinned dependency (pure JS, Alpine-compatible)
  - BambooHRClient.downloadPdf(applicationId, fileId) binary download method
affects:
  - 02-03 (extract-cv.ts uses client.downloadPdf())
  - 02-04 (index.ts integration wires downloadPdf into the pipeline)

# Tech tracking
tech-stack:
  added:
    - pdf-parse@1.1.4 (pure JS PDF text extraction, no native deps)
    - "@types/pdf-parse (TypeScript type declarations)"
  patterns:
    - Binary fetch without Accept header — separate method from get<T>() for non-JSON endpoints
    - Multi-path endpoint discovery with instructional 404 fallback for undocumented APIs
    - Auth header isolation — never included in console.error output (T-02-02-03 threat mitigation)

key-files:
  created: []
  modified:
    - package.json — pdf-parse@1.1.4 pinned dependency added
    - src/bamboohr/client.ts — downloadPdf() method added to BambooHRClient

key-decisions:
  - "pdf-parse pinned to exact version 1.1.4 (no caret) to prevent accidental upgrade to 2.x which has @napi-rs/canvas native dep incompatible with Alpine"
  - "downloadPdf() implemented as separate method (not via get<T>()) to avoid Accept: application/json header and res.json() on binary response"
  - "Two candidate endpoint paths tried in order; 404 produces instructional error with BambooHR Postman link for endpoint discovery on first dry run"

patterns-established:
  - "Binary download pattern: fetch without Accept header, res.arrayBuffer(), Buffer.from() — distinct from get<T>() JSON pattern"
  - "Multi-path discovery guard: try ordered candidate URLs, log all 404 attempts with discovery instructions rather than failing silently"

requirements-completed:
  - BAMB-04

# Metrics
duration: 2min
completed: 2026-05-01
---

# Phase 2 Plan 02: PDF Download Dependencies Summary

**pdf-parse@1.1.4 pinned (pure JS, Alpine-compatible) and BambooHRClient.downloadPdf() binary fetch method with multi-path 404 discovery guard**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-01T19:13:01Z
- **Completed:** 2026-05-01T19:14:31Z
- **Tasks:** 2
- **Files modified:** 2 (package.json, src/bamboohr/client.ts)

## Accomplishments

- Installed pdf-parse@1.1.4 with exact version pin (no caret) ensuring Alpine-compatible pure-JS package, never accidentally upgradeable to 2.x which requires @napi-rs/canvas native binary
- Added @types/pdf-parse to devDependencies for TypeScript type safety on pdf-parse function calls
- Implemented downloadPdf(applicationId, fileId) on BambooHRClient — uses Basic Auth without Accept: application/json, reads binary via arrayBuffer(), returns typed {buffer, contentType} result
- Built multi-path discovery guard: tries most-likely endpoint first, logs 404 with BambooHR Postman collection link for endpoint discovery on first dry run
- T-02-02-03 threat mitigation enforced: Authorization header value never appears in any console.error() call

## Task Commits

Each task was committed atomically:

1. **Task 1: Install pdf-parse@1.1.4 and @types/pdf-parse** - `9095bd9` (chore)
2. **Task 2: Add downloadPdf() method to BambooHRClient** - `e32b42c` (feat)

## Files Created/Modified

- `package.json` — pdf-parse@1.1.4 added to dependencies (exact pin), @types/pdf-parse added to devDependencies
- `src/bamboohr/client.ts` — downloadPdf(applicationId: number, fileId: number) method added after fetchApplicationDetails()

## Decisions Made

- pdf-parse version pinned to exact `1.1.4` (no `^` caret) because npm `latest` resolves to 2.4.5 which has `@napi-rs/canvas` as a hard non-optional native dependency that fails on Alpine Linux
- downloadPdf() is a separate method (not routed through get<T>()) because get<T>() always sets `Accept: application/json` and calls res.json() — both incorrect for binary PDF download
- Two candidate paths are tried in order (A2 assumption: /applicant_tracking/applications/{id}/documents/{fileId} first, /v1/employees/{id}/files/{fileId} second) because the BambooHR ATS download endpoint is not publicly documented and requires live discovery

## Deviations from Plan

None - plan executed exactly as written.

The caret removal from `"^1.1.4"` to `"1.1.4"` in package.json was anticipated by the plan which explicitly stated: "If npm installs with a ^ prefix by default, manually edit package.json to remove the caret."

## Issues Encountered

None — npm installed both packages without error. TypeScript type check (tsc --noEmit) passed on first attempt.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02-03 (extract-cv.ts) can now import BambooHRClient and call downloadPdf() with full TypeScript type safety
- Plan 02-03 can import pdf-parse using `import pdfParse from 'pdf-parse'` — @types/pdf-parse provides the default export type declaration
- The endpoint path discovery guard in downloadPdf() will surface the correct BambooHR URL on first DRY_RUN with real credentials

---
*Phase: 02-pdf-pipeline*
*Completed: 2026-05-01*
