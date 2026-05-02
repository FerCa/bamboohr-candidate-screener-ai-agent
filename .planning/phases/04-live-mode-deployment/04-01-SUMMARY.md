---
phase: 04-live-mode-deployment
plan: 01
subsystem: api
tags: [bamboohr, live-mode, write-path, dry-run, openai, cr-01, infra]

# Dependency graph
requires:
  - phase: 03-agent-evaluation
    provides: "EvaluationResult shape with applicationId, outcome, comment fields; evaluateSoftRules() function"
  - phase: 01-foundation
    provides: "BambooHRClient get<T>() pattern, isDryRun(), config schema with job.stages"
  - phase: 02-pdf-pipeline
    provides: "CandidateContext shape with needsReviewReason field"
provides:
  - "BambooHRClient.postComment(applicationId, comment) — POST /applicant_tracking/applications/{id}/comments"
  - "BambooHRClient.moveStage(applicationId, stageId) — POST /applicant_tracking/applications/{id}/status"
  - "Live write path in src/index.ts gated by !isDryRun() for all three outcome branches"
  - "CR-01 fix: evaluateSoftRules never called in dry-run mode"
  - "INFRA-03: final stdout JSON summary line with {processed, pass, fail, needsReview, errors}"
affects: [04-docker-deployment, 04-readme]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Comment-then-move atomicity (D-03/D-04): postComment before moveStage; if comment fails, stage move skipped"
    - "Dry-run gate pattern: if (!dryRun) wraps all external write calls"
    - "CR-01 pattern: if (dryRun) synthesize deterministic EvaluationResult else call evaluateSoftRules"

key-files:
  created: []
  modified:
    - src/bamboohr/client.ts
    - src/index.ts

key-decisions:
  - "D-03/D-04: Comment-then-move atomicity ensures no candidate lands in moved-but-uncommented state"
  - "D-01: needsReview and fail outcomes both route to config.job.stages.fail"
  - "D-05: Hard-rule fails also trigger BambooHR writes in LIVE_MODE with bulleted reasons comment"
  - "CR-01: dry-run synthesizes EvaluationResult{outcome:'pass'} instead of calling OpenAI API"
  - "INFRA-03: console.log(JSON.stringify(summary)) as final stdout line alongside human-readable console.error"

patterns-established:
  - "Post private<T> helper mirrors get<T>: sets Content-Type:application/json, throws on !res.ok with 'on POST {path}' suffix"
  - "All write blocks: stageMap.get(stageName) → throw if undefined → postComment → moveStage"

requirements-completed: [BAMB-02, BAMB-03, INFRA-03]

# Metrics
duration: 12min
completed: 2026-05-02
---

# Phase 4 Plan 01: Live Mode Write Path Summary

**BambooHR write path activated with comment-then-move atomicity for all three outcome branches (pass, fail, needsReview), CR-01 dry-run guard for OpenAI calls, and INFRA-03 JSON stdout summary**

## Performance

- **Duration:** 12 min
- **Started:** 2026-05-02T08:37:38Z
- **Completed:** 2026-05-02T08:50:00Z
- **Tasks:** 3 (Tasks 1, 2: source changes; Task 3: verification only)
- **Files modified:** 2

## Accomplishments

- Added `private post<T>()`, `public postComment()`, and `public moveStage()` to `BambooHRClient` — the two write methods implement BAMB-02 and BAMB-03 using the existing `get<T>()` auth pattern with an added `Content-Type: application/json` header
- Wired five surgical edits into `src/index.ts`: CR-01 import + dry-run branch for OpenAI calls, soft-eval write block, needsReview write block, hard-rule fail write block (D-05), and INFRA-03 stdout JSON summary line
- Confirmed via static analysis and compiled output that all six write call sites (3 × postComment + 3 × moveStage) are inside `if (!dryRun)` guards and that `evaluateSoftRules` is called exactly once (inside the CR-01 else branch)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add post<T>, postComment, moveStage to BambooHRClient** - `18816d4` (feat)
2. **Task 2: Wire write guards, CR-01 dry-run fix, INFRA-03 summary** - `d18a282` (feat)
3. **Task 3: Dry-run smoke test** - verification only, no files modified

## Files Created/Modified

- `src/bamboohr/client.ts` — Added 3 methods: `private post<T>(path, body)`, `async postComment(applicationId, comment)`, `async moveStage(applicationId, stageId)`. Methods placed between `get<T>()` and `validateStages()`. No new imports.
- `src/index.ts` — Five edits: (1) `import type { EvaluationResult }` added; (2) CR-01 `if (dryRun) { synthesize } else { evaluateSoftRules() }` block replacing unconditional call; (3) soft-eval `if (!dryRun)` write block after `logEvaluation`; (4) needsReview `if (!dryRun)` write block after its `logDecision`; (5a) hard-rule fail `if (!dryRun)` write block after its `logDecision`; (5b) `console.log(JSON.stringify(...))` INFRA-03 summary line at end of `main()`

## New Methods Added to BambooHRClient

| Method | Visibility | Endpoint | Body |
|--------|-----------|----------|------|
| `post<T>(path, body)` | private | — | generic JSON POST |
| `postComment(applicationId, comment)` | public | `POST /applicant_tracking/applications/{id}/comments` | `{ type: 'comment', comment }` |
| `moveStage(applicationId, stageId)` | public | `POST /applicant_tracking/applications/{id}/status` | `{ status: stageId }` |

Error pattern: `BambooHR API error: HTTP {status} {statusText} on POST {path}` — distinguishable from GET errors by the `on POST` suffix.

## Five Edits Applied to src/index.ts

1. **CR-01 import** (line 16): `import type { EvaluationResult } from './agent/types.js'`
2. **CR-01 dry-run branch**: Replaces `const evalResult = await evaluateSoftRules(ctx, config.softRules)` with `if (dryRun) { synthesize result with comment '[DRY_RUN] Soft evaluation skipped...' } else { evalResult = await evaluateSoftRules(...) }`
3. **Soft-eval write block**: After `logEvaluation(evalResult)` — resolves target stage name (pass→stages.pass, fail/needsReview→stages.fail), gets stageId from stageMap, postComment then moveStage using `evalResult.applicationId` and `evalResult.comment`
4. **needsReview write block**: After `logDecision()` in the `ctx.needsReviewReason !== null` branch — assembles NEEDS REVIEW comment from header + reason + footer, posts to `detail.id`
5. **Hard-rule fail write block + INFRA-03**: After `logDecision()` in the hard-rule else branch — assembles FAIL — Hard rules comment with bulleted reasons; plus `console.log(JSON.stringify({processed, pass: passed, fail: failed, needsReview, errors}))` as final stdout line

## Requirements Satisfied

| Requirement | Status | Implementation |
|-------------|--------|----------------|
| BAMB-02 — Stage transitions | Satisfied | `moveStage(applicationId, stageId)` in client.ts; called in all 3 write blocks |
| BAMB-03 — Recruiter comments | Satisfied | `postComment(applicationId, comment)` in client.ts; called before moveStage in all 3 blocks |
| INFRA-03 — JSON stdout summary | Satisfied | `console.log(JSON.stringify({processed, pass, fail, needsReview, errors}))` as final stdout line |
| CR-01 — Dry-run OpenAI guard | Satisfied | `if (dryRun) { synthesize EvaluationResult } else { evaluateSoftRules() }` |

## Decisions Made

- CR-01 fix folded into Plan 1 (not a separate gap plan) — the same `isDryRun()` guard pattern was being implemented anyway for write blocks; natural fit
- The soft-eval write block uses `evalResult.comment` verbatim (D-06: GPT-4o builds the comment); the needsReview and hard-rule fail blocks assemble their comments from fixed strings + operator-controlled data only (T-04-07 spoofing mitigation)
- `stageMap.get()` undefined check throws with a descriptive `[write]` prefix so the per-candidate error catch logs it with context

## Deviations from Plan

### Plan Criterion Discrepancy (not a code deviation)

The plan's Task 2 acceptance criteria states the footer `[Auto-screened by AI — final decision rests with recruiter]` must appear at least 3 times in `src/index.ts`. The actual implementation has it in 2 places (needsReview block and hard-rule fail block). The soft-eval block posts `evalResult.comment` verbatim — the comment string is assembled by GPT-4o (D-06), so the footer literal string does not appear inline in the source code for that branch. This is correct per the plan's behavior description and PATTERNS.md, which explicitly uses `evalResult.comment` for the soft-eval block. The criterion was slightly mis-specified — 2 inline occurrences is correct.

No code deviations — plan executed as specified in all behavior descriptions and PATTERNS.md.

## Issues Encountered

- `node_modules` was not present in the worktree at execution start (worktree is freshly created). Ran `npm install` as a Rule 3 auto-fix before the first build attempt. The package-lock.json was tracked in git so the install was deterministic.

## Threat Flags

No new security surface beyond what the plan's threat model covers. All write endpoints are on the existing `this.baseUrl` (HTTPS), use the existing `this.authHeader`, and all write blocks are gated by `!dryRun`. The plan's T-04-01 through T-04-07 mitigations are all implemented as designed.

## Next Phase Readiness

- `BambooHRClient` is fully equipped for live writes — `postComment` and `moveStage` are ready for integration testing against real BambooHR credentials when `LIVE_MODE=true`
- `src/index.ts` dry-run path makes zero external API calls (verified by static analysis of compiled dist/index.js)
- Plan 02 (Dockerfile), Plan 03 (README + cron docs), and Plan 04 (live E2E verification checkpoint) can proceed

---
*Phase: 04-live-mode-deployment*
*Completed: 2026-05-02*

## Self-Check: PASSED

- `src/bamboohr/client.ts` exists and contains `postComment`, `moveStage`, `post<T>`
- `src/index.ts` exists and contains all 5 edits including INFRA-03 summary
- `dist/index.js` exists (compiled) and contains `client.postComment`, `client.moveStage`, `JSON.stringify` summary
- Commits exist: `18816d4` (Task 1 - client.ts), `d18a282` (Task 2 - index.ts)
- No SUMMARY.md commit yet (pending final metadata commit)
