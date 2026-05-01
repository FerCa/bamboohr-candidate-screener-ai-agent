---
phase: 02-pdf-pipeline
plan: "01"
subsystem: pipeline
tags: [typescript, types, pipeline, candidate-context, pdf-pipeline]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: RuleResult interface in src/rules/types.ts used as hardRuleResult field type in CandidateContext

provides:
  - CandidateContext interface with 6 fields (applicationId, applicantId, hardRuleResult, cvText, needsReviewReason, applicationAnswers)
  - NeedsReviewReason union type ('non-pdf-content-type' | 'extraction-failed' | 'image-only-pdf')
  - Extended CandidateDecision.outcome with 'needsReview' value (D-07)

affects:
  - 02-02 (CV download — produces CandidateContext)
  - 02-03 (text extraction — populates cvText and needsReviewReason)
  - 02-04 (pipeline wiring — orchestrates CandidateContext construction)
  - 03-agent-evaluation (consumes CandidateContext as agent input)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "String literal union (not enum) for reason values — JSON serialization safe, no import needed at call site"
    - "import type for cross-module type-only imports — eliminates runtime dependency on ../rules/types.js"
    - "NodeNext ESM .js import extensions on all local imports"

key-files:
  created:
    - src/pipeline/types.ts
  modified:
    - src/rules/types.ts

key-decisions:
  - "D-01: CandidateContext is separate from CandidateDecision — context is in-flight pipeline state; decision is the log record only"
  - "D-02: applicationAnswers typed as Record<string, unknown> — raw pass-through, no normalization before live API data is seen"
  - "D-03: cvText is string | null — null when needsReviewReason !== null"
  - "D-04: NeedsReviewReason is a string literal union type (not bare string) for type safety and JSON serialization"
  - "D-07: CandidateDecision.outcome extended to 'pass' | 'fail' | 'needsReview' | 'error' — required for Phase 2 needsReview log lines"

patterns-established:
  - "String literal union for reason categories: NeedsReviewReason = 'non-pdf-content-type' | 'extraction-failed' | 'image-only-pdf'"
  - "import type (not import) for cross-module type imports — zero runtime side effects"
  - "Union extension pattern: existing call sites pass 'pass'/'fail'/'error' and remain valid when union gains 'needsReview'"

requirements-completed:
  - RULE-03

# Metrics
duration: 2min
completed: 2026-05-01
---

# Phase 2 Plan 01: Type Contracts Summary

**CandidateContext interface and NeedsReviewReason union type defining the Phase 2 pipeline contract, with CandidateDecision extended to include 'needsReview' outcome**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-01T19:12:52Z
- **Completed:** 2026-05-01T19:14:05Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `src/pipeline/types.ts` with `CandidateContext` interface (6 fields exactly matching D-01 through D-04) and `NeedsReviewReason` union type (3 string literals)
- Extended `CandidateDecision.outcome` in `src/rules/types.ts` from 3 values to 4 by adding `'needsReview'` per D-07, with existing call sites unaffected
- TypeScript compiler passes `tsc --noEmit` with zero errors after both changes

## Task Commits

Each task was committed atomically:

1. **Task 1: Create src/pipeline/types.ts with CandidateContext and NeedsReviewReason** - `33edee8` (feat)
2. **Task 2: Extend CandidateDecision.outcome with 'needsReview' in src/rules/types.ts** - `93bf91b` (feat)

## Files Created/Modified

- `src/pipeline/types.ts` — NEW: CandidateContext interface (6 fields) and NeedsReviewReason union type (3 literals); imports RuleResult from ../rules/types.js
- `src/rules/types.ts` — MODIFIED: CandidateDecision.outcome extended from `'pass' | 'fail' | 'error'` to `'pass' | 'fail' | 'needsReview' | 'error'`

## Decisions Made

- Used string literal union type for NeedsReviewReason (not an enum) — enables JSON serialization without import at call sites, as noted in the plan type strategy
- Used `import type` (not `import`) for the RuleResult cross-module import — eliminates any runtime circular dependency risk since types.ts has no runtime code

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

`npx tsc --noEmit` failed because the worktree's `node_modules/` is empty (packages are installed in the main project root). Resolved by using `node_modules/.bin/tsc` from the main project directory. All type checks passed correctly.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Type contracts are locked. Plans 02-02, 02-03, and 02-04 can safely import from `src/pipeline/types.ts`
- `CandidateDecision.outcome` is fully extended — logger and index.ts can emit `needsReview` outcomes without type errors
- No blockers for downstream plans in this wave

---
*Phase: 02-pdf-pipeline*
*Completed: 2026-05-01*
