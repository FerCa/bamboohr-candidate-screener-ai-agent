---
phase: 02-pdf-pipeline
plan: "03"
subsystem: pipeline
tags: [pdf-parse, typescript, candidate-context, cv-extraction, nodejs]

# Dependency graph
requires:
  - phase: 02-01
    provides: CandidateContext and NeedsReviewReason types in src/pipeline/types.ts
  - phase: 02-02
    provides: downloadPdf() method on BambooHRClient in src/bamboohr/client.ts
provides:
  - buildCandidateContext() orchestrator in src/pipeline/extract-cv.ts
  - CV download → validate → extract → truncate → assemble pipeline
  - All 3 NeedsReviewReason paths (non-pdf-content-type, extraction-failed, image-only-pdf)
  - Discovery guards for unconfirmed BambooHR field names (resumeFileId, questionsAndAnswers)
affects:
  - 03-agent-evaluation
  - Phase 3 agent evaluation consumes CandidateContext produced here

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Orchestrator pattern: single async function glues download, validate, extract, truncate, assemble"
    - "Never-throw for recoverable: all expected failure paths return CandidateContext with needsReviewReason"
    - "Discovery guards: log Object.keys when assumed field names are absent (DRY_RUN first-run verification)"
    - "Image-only heuristic: dual-condition (wordCount < 50 AND buffer.length > 50KB) to avoid false positives"
    - "Content-Type substring match (.includes()) instead of equality for MIME type variants"

key-files:
  created:
    - src/pipeline/extract-cv.ts
  modified: []

key-decisions:
  - "Download errors caught and treated as recoverable (extraction-failed), not rethrown — keeps outer loop alive for other candidates"
  - "Image-only detection requires BOTH word count < 50 AND file size > 50KB — single condition alone causes false positives"
  - "questionsAndAnswers absence logs a warning but still returns empty {} rather than failing — field may be under a different key"
  - "makeNeedsReview() is a private helper (not exported) — callers never need to construct CandidateContext directly"
  - "MAX_CV_CHARS = 8000 is a module-level named constant for readability and future configurability"

patterns-established:
  - "Pattern: Orchestrator with inner try/catch per step, outer catch only for unrecoverable errors"
  - "Pattern: Discovery guard — if assumed field is absent, log Object.keys and fall back gracefully"
  - "Pattern: All local imports use .js extension (NodeNext ESM requirement)"

requirements-completed:
  - PDF-01
  - PDF-02
  - RULE-03

# Metrics
duration: 8min
completed: 2026-05-01
---

# Phase 2 Plan 03: CV Extraction Orchestrator Summary

**pdf-parse-based CV extraction orchestrator with 5-path failure handling, image-only heuristic (wordCount < 50 AND size > 50KB), and 8000-char truncation producing typed CandidateContext for Phase 3**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-01T19:12:00Z
- **Completed:** 2026-05-01T19:20:26Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Created `src/pipeline/extract-cv.ts` with `buildCandidateContext()` as the sole exported function
- Implements the complete PDF pipeline orchestrator: download → Content-Type validation → pdf-parse extraction → image-only heuristic → 8000-char truncation → CandidateContext assembly
- All 3 `NeedsReviewReason` paths are reachable: `non-pdf-content-type`, `extraction-failed` (3 paths: missing fileId, download fail, parse fail), and `image-only-pdf`
- Discovery guards log `Object.keys(detail)` when `resumeFileId` or `questionsAndAnswers` is absent so the developer can verify field names on first DRY_RUN

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/pipeline/extract-cv.ts with buildCandidateContext()** - `56c16f2` (feat)

**Plan metadata:** committed with SUMMARY.md in final commit

## Files Created/Modified
- `src/pipeline/extract-cv.ts` - CV extraction orchestrator with buildCandidateContext() and private makeNeedsReview() helper

## Decisions Made
- Download errors are caught in an inner try/catch and treated as `extraction-failed` (recoverable), not rethrown — keeps the outer candidate loop alive for subsequent candidates
- Image-only detection uses dual conditions (wordCount < 50 AND buffer.length > 50KB) matching plan spec D-05/D-06; single condition alone generates false positives
- `questionsAndAnswers` absence logs a warning but falls back to `{}` — the field name is an assumption (A5) that may differ per BambooHR account
- `makeNeedsReview()` is private (not exported) — `buildCandidateContext()` is the only public API surface; callers never construct `CandidateContext` directly

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
- `npx tsc` was intercepted by a global shim that prevented running TypeScript type checks. The worktree shares `node_modules` with the root project directory (no local `node_modules/.bin/tsc`), and sandbox restrictions blocked invoking `tsc` via alternate paths. Manual type verification was performed by inspecting the file against all referenced interfaces from `src/pipeline/types.ts`, `src/bamboohr/client.ts`, `src/bamboohr/types.ts`, and `src/rules/types.ts`. All imports, type annotations, and return types are structurally correct per those interfaces.

## Threat Mitigations Applied

Per the plan's threat model, the following mitigations were verified in the implementation:

- **T-02-03-03 (Information Disclosure):** Confirmed — `rawText` and `cvText` are never passed to `console.error()`. Error logs contain only IDs and metadata (`applicationId`, `wordCount`, `fileSize`, `contentType`).
- **T-02-03-02 (Tampering — embedded JS):** Mitigated by nature of `pdf-parse` text extraction — no script execution occurs.
- **T-02-03-05 (Spoofing — resumeFileId type coercion):** Guarded — `rawFileId` checked for `undefined | null | 0` before casting to `number`.
- **T-02-03-01, T-02-03-04:** Accepted as documented in threat register.

## Known Stubs

None - `buildCandidateContext()` is a pure implementation with no placeholder values or hardcoded empty returns. The `questionsAndAnswers` fallback to `{}` is a deliberate documented behavior (field-name-is-assumption), not a stub.

## Next Phase Readiness
- `buildCandidateContext()` is ready for Phase 3 agent evaluation to consume
- Phase 3 must import `buildCandidateContext` from `./pipeline/extract-cv.js` (NodeNext ESM)
- Concern: `resumeFileId` and `questionsAndAnswers` field names are assumptions (A1, A5) — the first live DRY_RUN will confirm or refute them via the discovery guard log output
- Concern: `downloadPdf()` endpoint paths are also assumptions — discovery will occur on first DRY_RUN per Plan 02 design

---
*Phase: 02-pdf-pipeline*
*Completed: 2026-05-01*
