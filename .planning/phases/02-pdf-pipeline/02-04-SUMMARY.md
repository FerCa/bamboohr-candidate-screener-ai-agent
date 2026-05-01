---
phase: 02-pdf-pipeline
plan: "04"
subsystem: pipeline
tags: [typescript, pdf-parse, bamboohr, candidate-context, dry-run]

# Dependency graph
requires:
  - phase: 02-pdf-pipeline plan 01
    provides: CandidateContext interface, NeedsReviewReason type, CandidateDecision.outcome extended with needsReview
  - phase: 02-pdf-pipeline plan 02
    provides: BambooHRClient.downloadPdf() binary download method
  - phase: 02-pdf-pipeline plan 03
    provides: buildCandidateContext() orchestrator function in src/pipeline/extract-cv.ts
provides:
  - PDF pipeline wired into main candidate loop in src/index.ts
  - needsReview counter tracked alongside pass/fail/errors
  - Passing candidates run through buildCandidateContext() before logDecision()
  - needsReview outcome routed with its own logDecision() + counter + continue
  - Summary line includes needsReview=${needsReview} field (D-08)
affects:
  - 03-agent-evaluation (Phase 3 consumes CandidateContext from the pass branch)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pipeline slot: async pipeline step inserted between evaluateHardRules() and logDecision() inside per-candidate try/catch"
    - "Counter extension: new counter (needsReview) added alongside existing pass/fail/errors"
    - "Early-continue pattern: needsReview branch uses processed++ + continue before fall-through processed++"

key-files:
  created: []
  modified:
    - src/index.ts

key-decisions:
  - "ctx.cvText is never passed to logDecision() — GDPR compliance: CV PII stays in memory only (T-02-04-01)"
  - "continue statement in needsReview branch skips fall-through processed++ — processed++ called explicitly inside the branch"
  - "Unrecoverable buildCandidateContext() throws (network, auth) fall to existing outer catch, logged as outcome: error"
  - "Pass placeholder reasons string 'CV extracted; pending Phase 3 agent evaluation' used until Phase 3 adds real agent evaluation"

patterns-established:
  - "Pipeline wiring: async processing steps slot into the pass branch of the candidate loop before the counter update"
  - "GDPR: log reasons[] from pipeline metadata only; never log raw CV content to stdout JSON stream"

requirements-completed:
  - BAMB-04
  - PDF-01
  - PDF-02
  - RULE-03

# Metrics
duration: 15min
completed: 2026-05-01
---

# Phase 2 Plan 04: Wire PDF Pipeline Summary

**PDF pipeline wired into src/index.ts candidate loop: pass candidates call buildCandidateContext(), needsReview counter added to summary**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-01T00:00:00Z
- **Completed:** 2026-05-01T00:15:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Imported `buildCandidateContext` and `CandidateContext` type into `src/index.ts`
- Added `let needsReview = 0` counter alongside `pass`, `fail`, `errors`
- Replaced the pass branch of the candidate loop: passing candidates now run through `buildCandidateContext()` before `logDecision()`
- `needsReview` branch logs `outcome: 'needsReview'` with `ctx.needsReviewReason` as the reason, increments counter, and uses `continue` to skip fall-through `processed++`
- Updated summary `console.error` line to include `needsReview=${needsReview}` (D-08)
- CV text (`ctx.cvText`) is never passed to `logDecision()` — GDPR compliance (T-02-04-01)

## Task Commits

1. **Task 1: Wire buildCandidateContext() into src/index.ts candidate loop** - `cc8da16` (feat)

**Plan metadata:** (see final commit below)

## Files Created/Modified

- `src/index.ts` — Wired PDF pipeline into candidate loop; added needsReview counter and updated summary line

## Decisions Made

- `ctx.cvText` is intentionally excluded from all `logDecision()` calls — CV PII must not flow to the stdout JSON log stream per GDPR requirements (T-02-04-01)
- The `continue` statement in the needsReview branch requires `processed++` to be called inside that branch explicitly, before `continue`, so the fall-through `processed++` is not reached
- Unrecoverable `buildCandidateContext()` errors (network timeout, auth) propagate to the existing outer `catch (err)` block unchanged — they become `outcome: 'error'` records, consistent with Phase 1 SAFE-01 pattern

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

The pass branch logs `reasons: ['CV extracted; pending Phase 3 agent evaluation']` — this is an intentional placeholder. Phase 3 will replace this with real GPT-4o soft-rule evaluation. The placeholder does not prevent Phase 2's goal from being achieved (PDF pipeline wired and needsReview routing working).

## Threat Flags

No new threat surface introduced. The wiring connects existing functions; no new network endpoints, auth paths, or schema changes.

| Flag | File | Description |
|------|------|-------------|
| mitigated: T-02-04-01 | src/index.ts | ctx.cvText not logged to stdout; only ctx.needsReviewReason (typed string literal) logged in reasons[] |

## Issues Encountered

TypeScript compiler (`tsc --noEmit`) could not be invoked from the sandbox environment (node_modules/.bin/tsc blocked by sandbox policy). Type correctness was verified by manual type analysis:
- `buildCandidateContext()` signature matches call site exactly
- `CandidateContext.needsReviewReason: NeedsReviewReason | null` — the `!== null` guard is valid
- `NeedsReviewReason` (string literal union) is assignable to `string` in `reasons[]`
- `CandidateDecision.outcome` includes `'needsReview'` (added in Plan 01)

## Next Phase Readiness

- Phase 3 (Agent Evaluation) can now consume `CandidateContext` from the pass branch of the candidate loop
- The `ctx` variable is in scope after the `needsReviewReason !== null` guard — Phase 3 inserts evaluation logic after that guard
- All 4 Phase 2 requirements completed: BAMB-04, PDF-01, PDF-02, RULE-03

---
*Phase: 02-pdf-pipeline*
*Completed: 2026-05-01*
