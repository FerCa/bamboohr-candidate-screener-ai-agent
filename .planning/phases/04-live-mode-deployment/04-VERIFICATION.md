---
phase: 04-live-mode-deployment
verified: 2026-05-02T10:00:00Z
status: human_needed
score: 7/7 must-haves verified
overrides_applied: 0
gaps: []
human_verification:
  - test: "Run docker build and docker run --rm against a live BambooHR instance with LIVE_MODE=true on a test candidate"
    expected: "Candidate is moved to the correct stage AND receives the recruiter comment. Comment appears before stage move. Hard-rule failures receive FAIL — Hard rules comment. needsReview candidates receive NEEDS REVIEW comment."
    why_human: "Cannot verify live BambooHR write-path behavior (postComment + moveStage) without real credentials and a live BambooHR tenant. Static analysis confirms the code structure is correct but cannot simulate the API interaction."
  - test: "In dry-run (LIVE_MODE unset), confirm zero BambooHR write API calls and zero OpenAI calls are made"
    expected: "Running `docker run --rm --env-file /etc/screener.env -v ...` with no LIVE_MODE produces the INFRA-03 JSON summary line and no BambooHR or OpenAI errors in the output."
    why_human: "Requires live credentials and a BambooHR test instance to confirm silence of external calls at the network level. Static analysis confirms the guard structure (verified programmatically), but end-to-end dry-run on real infrastructure requires a human to run and observe."
---

# Phase 4: Live Mode & Deployment Verification Report

**Phase Goal:** Production-ready container that writes real stage transitions and comments to BambooHR when `LIVE_MODE=true`, builds and runs cleanly as a `node:22-alpine` Docker image, and has a documented cron entry for daily execution.
**Verified:** 2026-05-02T10:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                          | Status     | Evidence                                                                                                                               |
|----|----------------------------------------------------------------------------------------------------------------|------------|----------------------------------------------------------------------------------------------------------------------------------------|
| 1  | When LIVE_MODE=true, a candidate that passes soft eval is moved to stages.pass and receives a recruiter comment | ✓ VERIFIED | `src/index.ts:169-182` — `if (!dryRun)` block after `logEvaluation`: resolves `stages.pass` from stageMap, calls `postComment` then `moveStage` using `evalResult.applicationId` |
| 2  | When LIVE_MODE=true, a candidate that fails soft eval is moved to stages.fail and receives a recruiter comment  | ✓ VERIFIED | Same block at lines 169-182: `evalResult.outcome !== 'pass'` routes to `stages.fail`; `evalResult.comment` (GPT-4o-assembled) posted verbatim |
| 3  | When LIVE_MODE=true, a needsReview candidate is moved to stages.fail with a NEEDS REVIEW comment              | ✓ VERIFIED | `src/index.ts:118-132` — `if (!dryRun)` in needsReviewReason branch; comment assembled with "NEEDS REVIEW — Automated screening incomplete" header + reason + footer; `client.postComment(detail.id, ...)` then `client.moveStage(detail.id, reviewedStageId)` |
| 4  | When LIVE_MODE=true, a hard-rule fail is moved to stages.fail with a FAIL — Hard rules comment                | ✓ VERIFIED | `src/index.ts:203-217` — `if (!dryRun)` block in hard-rule else branch; comment assembled with "FAIL — Hard rules" + bulleted reasons + footer; `postComment` then `moveStage` on `detail.id` |
| 5  | Comment is posted before stage move; if comment POST fails, stage move is NOT called                           | ✓ VERIFIED | All three write blocks follow `await client.postComment(...)` immediately before `await client.moveStage(...)`; `postComment` throws on non-2xx; if it throws, `moveStage` line is never reached — outer try/catch increments `errors` |
| 6  | When LIVE_MODE is unset (dry-run), no BambooHR write API calls and no OpenAI evaluateSoftRules calls           | ✓ VERIFIED | All three `client.postComment` + `client.moveStage` call sites sit inside `if (!dryRun)` guards (lines 118, 169, 203). The one `evaluateSoftRules` call is inside the `else` branch of `if (dryRun)` at line 150-162. `grep -c "await evaluateSoftRules(" src/index.ts` = 1 (inside else only). |
| 7  | Final stdout line of every run is a JSON object `{processed, pass, fail, needsReview, errors}`                 | ✓ VERIFIED | `src/index.ts:243-245` — `console.log(JSON.stringify({ processed, pass: passed, fail: failed, needsReview, errors }))` as the last statement in `main()` before `main().catch(...)` |

**Score:** 7/7 truths verified

### Deferred Items

None.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/bamboohr/client.ts` | `post<T>()` private, `postComment()`, `moveStage()` public | ✓ VERIFIED | Lines 64-108: all three methods present, substantive, structurally correct. `post<T>` sends `Authorization`, `Accept: application/json`, `Content-Type: application/json`, throws on `!res.ok` with "BambooHR API error: HTTP ... on POST {path}" message. |
| `src/index.ts` | Three write blocks gated by `!dryRun`, CR-01 dry-run guard, INFRA-03 summary | ✓ VERIFIED | Three `if (!dryRun)` guards at lines 118, 169, 203. CR-01 `if (dryRun)` block at lines 150-162. `import type { EvaluationResult }` at line 16. INFRA-03 `console.log(JSON.stringify(...))` at line 243. |
| `Dockerfile` | Multi-stage `node:22-alpine`, non-root `screener` user, exec-form ENTRYPOINT | ✓ VERIFIED | 2 × `FROM node:22-alpine` (AS build, AS production). `RUN addgroup -S screener && adduser -S screener -G screener`. `USER screener`. `ENTRYPOINT ["node", "dist/index.js"]` in exec form. Zero `EXPOSE`, zero `CMD`, zero `ENV` credentials. `npm ci --omit=dev` in production stage. |
| `.dockerignore` | Excludes node_modules, .env, .env.*, dist, .git, .planning, *.md, Dockerfile | ✓ VERIFIED | All required exclusions present flush-left. `!.env.example` appears after `.env.*` (ordering confirmed). `tsconfig.json`, `package.json`, `src/` not excluded (build stage requires them). |
| `README.md` | Full operator documentation including cron setup (macOS + Linux), compliance | ✓ VERIFIED | 244 lines. All required sections present: Quick Start, Build, Run, Configuration, Cron Setup (### macOS, ### Linux server), Operating Notes, Compliance. All five env vars documented. `ATS settings access` mentioned. `Data Processing Agreement` mentioned. INFRA-03 JSON example present. No TODO/TBD markers. Cron entry uses `--env-file`, not `-e KEY=value`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/index.ts` soft-eval branch | `client.postComment` + `client.moveStage` | `if (!dryRun)` block at line 169, postComment at 180, moveStage at 181 | ✓ WIRED | postComment precedes moveStage; both use `evalResult.applicationId` |
| `src/index.ts` needsReview branch | `client.postComment` + `client.moveStage` | `if (!dryRun)` block at line 118, postComment at 130, moveStage at 131 | ✓ WIRED | postComment precedes moveStage; both use `detail.id` |
| `src/index.ts` hard-rule fail branch | `client.postComment` + `client.moveStage` | `if (!dryRun)` block at line 203, postComment at 215, moveStage at 216 | ✓ WIRED | postComment precedes moveStage; both use `detail.id` |
| `src/bamboohr/client.ts` `post<T>` | BambooHR REST API | `fetch` with `method: 'POST'`, `Authorization`, `Content-Type: application/json` | ✓ WIRED | Line 64-81 — full authenticated POST with JSON body and error handling |
| Dockerfile build stage | Dockerfile production stage | `COPY --from=build /app/dist ./dist` | ✓ WIRED | Line 32 in Dockerfile |
| `.dockerignore` | Docker build context | `.env`, `.env.*`, `!.env.example` in correct order | ✓ WIRED | Ordering verified: `.env.*` at line 11, `!.env.example` at line 12 |
| README cron entry | Dockerfile image name | literal `bamboohr-screener:latest` in docker run command | ✓ WIRED | Line 153 in README matches Plan 02 image name exactly |
| README env-file template | `.env.example` | `.env.example` documented as template source | ✓ WIRED | README macOS section references `cp .env.example /etc/screener.env` |

### Data-Flow Trace (Level 4)

This phase's primary artifacts are infrastructure/configuration (Dockerfile, .dockerignore, README) and control-flow code (index.ts write guards). They do not render dynamic data in a UI sense — they gate external API calls. Level 4 data-flow trace is not applicable for Dockerfile and README. For `src/index.ts` the relevant data flows are:

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/index.ts` soft-eval write | `evalResult.comment` | `evaluateSoftRules()` (GPT-4o) OR dry-run synthesized string | Yes — GPT-4o in LIVE_MODE, deterministic stub in dry-run | ✓ FLOWING |
| `src/index.ts` needsReview write | `ctx.needsReviewReason` | `buildCandidateContext()` returns non-null reason string | Yes — string from Phase 2 pipeline | ✓ FLOWING |
| `src/index.ts` hard-rule write | `result.reasons[]` | `evaluateHardRules()` returns verbatim YAML rule labels | Yes — operator-controlled rule labels | ✓ FLOWING |
| `src/bamboohr/client.ts` `postComment` | posted comment | caller-provided string | Flows through to BambooHR API POST body | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `dist/index.js` contains write paths | `grep -c "client.postComment" dist/index.js` | 3 | ✓ PASS |
| `dist/index.js` contains moveStage | `grep -c "client.moveStage" dist/index.js` | 3 | ✓ PASS |
| Single evaluateSoftRules call site | `grep -c "await evaluateSoftRules(" src/index.ts` | 1 | ✓ PASS |
| `.env.example` keeps LIVE_MODE opt-in | `grep "# LIVE_MODE" .env.example` | `# LIVE_MODE=true` | ✓ PASS |
| README has no TODO markers | `grep -iE "TODO\|TBD\|FIXME\|XXX" README.md \| wc -l` | 0 | ✓ PASS |
| Live docker build and run | requires Docker daemon + real credentials | not testable statically | ? SKIP |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BAMB-02 | 04-01-PLAN.md | Stage transitions via BambooHR API | ✓ SATISFIED | `moveStage(applicationId, stageId)` in `client.ts:103-108`; called in 3 write blocks in `index.ts` |
| BAMB-03 | 04-01-PLAN.md | Recruiter comments via BambooHR API | ✓ SATISFIED | `postComment(applicationId, comment)` in `client.ts:89-94`; called before moveStage in all 3 write blocks |
| INFRA-01 | 04-02-PLAN.md | node:22-alpine Docker container, exits 0/1, config via volume mount | ✓ SATISFIED | Dockerfile confirmed: 2-stage node:22-alpine build, exec-form ENTRYPOINT, non-root user. Human verification (Task 3 in plan) confirmed `docker run --rm` exits 1 on missing config. |
| INFRA-03 | 04-01-PLAN.md | Final log line is JSON `{processed, pass, fail, needsReview, errors}` | ✓ SATISFIED | `src/index.ts:243-245` — `console.log(JSON.stringify(...))` as last statement in main() |
| INFRA-04 | 04-03-PLAN.md | README with copy-paste macOS crontab entry and Linux deployment note | ✓ SATISFIED | `README.md` 244 lines, `## Cron Setup` with `### macOS` cron line and `### Linux server` note both present |

No orphaned requirements: REQUIREMENTS.md maps INFRA-01, INFRA-03, INFRA-04, BAMB-02, BAMB-03 to Phase 4, and all five are accounted for across the three plans.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/index.ts` | 2 occurrences | `[Auto-screened by AI — final decision rests with recruiter]` footer appears only twice (needsReview + hard-rule fail blocks), not three times as the plan's Task 2 acceptance criteria originally required | ℹ️ Info | The soft-eval block correctly uses `evalResult.comment` verbatim (GPT-4o assembles it per D-06), so the literal footer does not appear in source for that branch. Plan's SUMMARY.md documents this discrepancy explicitly as a criterion mis-specification, not a code deviation. The behavior is correct. |

No stub implementations, no `return null/[]`, no hardcoded empty responses, no TODO markers found in modified files.

### Human Verification Required

#### 1. Live Write-Path End-to-End Test

**Test:** With LIVE_MODE=true and valid BambooHR credentials, run the Docker container against a test job opening that has at least one candidate in the intake stage. Observe BambooHR UI after the run completes.

**Expected:** The candidate is moved to the correct pipeline stage (pass/fail based on their evaluation outcome). A recruiter comment is visible on the application before the stage transition entry (proves comment-then-move atomicity). Hard-rule failures show "FAIL — Hard rules" with bulleted unmet criteria. needsReview candidates show "NEEDS REVIEW — Automated screening incomplete".

**Why human:** Cannot verify live BambooHR API write behavior (postComment endpoint + moveStage endpoint) without real credentials and a live tenant. Static analysis has confirmed the code structure, endpoint paths, request body shapes, and guard placement are all correct, but actual HTTP round-trips to `applicant_tracking/applications/{id}/comments` and `applicant_tracking/applications/{id}/status` require a live environment.

#### 2. Dry-Run Zero-Calls Confirmation

**Test:** Run `docker run --rm --env-file /etc/screener.env -v /path/to/config.yaml:/app/config.yaml:ro bamboohr-screener:latest` without LIVE_MODE in the env file (or with it absent/empty). Observe the output log.

**Expected:** Final stdout line is the INFRA-03 JSON object. No lines mention "postComment", "moveStage", or BambooHR write errors. No OpenAI API errors (evaluateSoftRules is not called). The stderr mode banner says "DRY_RUN (no writes)".

**Why human:** End-to-end dry-run on real infrastructure (BambooHR API for reads, absent OpenAI calls) confirms the guard structure behaves as designed under live network conditions. Static analysis verified the code structure; live execution is the remaining gap.

### Gaps Summary

No blocking gaps. All must-have truths are VERIFIED at the code level. Two behavioral end-to-end tests require human execution against live infrastructure and cannot be verified statically. These are standard acceptance tests for a live-write feature and do not indicate implementation defects.

---

_Verified: 2026-05-02T10:00:00Z_
_Verifier: Claude (gsd-verifier)_
