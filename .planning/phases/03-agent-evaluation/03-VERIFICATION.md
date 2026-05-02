---
phase: 03-agent-evaluation
verified: 2026-05-02T00:00:00Z
status: human_needed
score: 5/6 must-haves verified
overrides_applied: 0
human_verification:
  - test: "End-to-end dry-run with live credentials"
    expected: "DRY_RUN=true npx tsx src/index.ts produces at least one EvaluationResult JSON line on stdout containing 'outcome', 'required', 'optional', 'comment', 'timestamp' fields"
    why_human: "Requires real BAMBOOHR_API_KEY, BAMBOOHR_SUBDOMAIN, and OPENAI_API_KEY in .env; cannot be verified without live credentials"
  - test: "Hard-rule fail candidate never triggers evaluateSoftRules"
    expected: "A candidate whose hard-rule evaluation returns 'fail' produces a CandidateDecision JSON line with outcome 'fail'; no EvaluationResult JSON line is emitted for that candidate; stderr shows no [evaluator] log"
    why_human: "Requires a live candidate that fails a hard rule in BambooHR; flow inspection shows the code gate is correct but runtime confirmation requires live credentials"
  - test: "MaxTurnsExceededError path produces needsReview log"
    expected: "Simulating a MaxTurnsExceededError (or waiting for natural timeout with maxTurns:5) produces an EvaluationResult with outcome 'needsReview' and comment containing 'please review manually', not an unhandled exception"
    why_human: "Cannot trigger without calling the live OpenAI API and arranging conditions for 5-turn overflow; unit test not present"
gaps: []
---

# Phase 3: Agent Evaluation Verification Report

**Phase Goal:** End-to-end screening flow runs in dry-run mode — hard-rule pre-filter feeds into GPT-4o soft evaluation via OpenAI Agents SDK, producing a structured pass/fail/review decision with a recruiter comment for every candidate, with no BambooHR writes yet
**Verified:** 2026-05-02T00:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

The six roadmap success criteria are used as the primary truths, supplemented by cross-cutting constraints from the ROADMAP and the code review (03-REVIEW.md).

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC1 | In dry-run mode, each candidate with a valid CV receives a GPT-4o evaluation logged as JSON with outcome (pass/fail/needsReview), matched criteria, and unmet criteria | ? UNCERTAIN — human needed | Code path verified: pass-branch calls `evaluateSoftRules(ctx, config.softRules)` then `logEvaluation(evalResult)`. EvaluationOutputSchema enforces all required fields. Cannot confirm actual JSON output without live credentials. |
| SC2 | A candidate failing a hard rule never reaches GPT-4o (evaluateSoftRules is not called) | ✓ VERIFIED | `evaluateSoftRules` is gated inside `if (result.outcome === 'pass')` in `src/index.ts:100`. Hard-rule fails jump to the `else` branch calling `logDecision` with `outcome: result.outcome`. No path from hard-rule fail to `evaluateSoftRules`. |
| SC3 | A candidate whose CV text is empty or too short is logged as needsReview (from PDF pipeline) without calling GPT-4o | ✓ VERIFIED | `src/index.ts:106–117`: the `if (ctx.needsReviewReason !== null)` gate runs before `evaluateSoftRules`. The PDF pipeline (`src/pipeline/extract-cv.ts`) sets `needsReviewReason: 'image-only-pdf'` for low-word-count + large-file PDFs and `'extraction-failed'` for other failures. Both set `cvText: null`, ensuring the gate fires. |
| SC4 | MaxTurnsExceededError from the SDK is caught and mapped to needsReview (not an unhandled exception) | ✓ VERIFIED | `src/agent/evaluator.ts:93–98`: `catch (err) { if (err instanceof MaxTurnsExceededError) { ... return needsReviewResult(ctx); } throw err; }`. Discriminated catch — only `MaxTurnsExceededError` returns needsReview; all other errors re-throw. |
| SC5 | With softRules absent or empty arrays, the evaluator short-circuits and returns pass without calling OpenAI | ✓ VERIFIED | `src/agent/evaluator.ts:42–55`: `if (softRules === undefined || (softRules.required.length === 0 && softRules.optional.length === 0))` returns `{outcome:'pass', comment:'No soft rules configured', ...}` before any `Agent` construction or `run()` call. |
| SC6 (cross-cutting) | Zero BambooHR writes in Phase 3 (no ATS API calls in new agent code) | ✓ VERIFIED | `src/bamboohr/client.ts` exports only `validateStages`, `fetchCandidates`, `fetchApplicationDetails`, `downloadPdf` — no POST/PUT/PATCH write methods exist. Grep of `src/index.ts`, `src/agent/evaluator.ts`, `src/agent/prompt.ts`, `src/logger/logger.ts` for write patterns (`updateStage`, `postComment`, `POST`, `PUT`, `PATCH`) returns zero hits. |

**Score:** 5/6 truths machine-verified; SC1 requires human confirmation with live credentials.

### Cross-Cutting Constraint Verification

| Constraint | Status | Evidence |
|-----------|--------|----------|
| `model: 'gpt-4o'` specified explicitly | ✓ VERIFIED | `src/agent/evaluator.ts:67`: `model: 'gpt-4o'` in Agent constructor |
| `maxTurns: 5` on every `run()` call | ✓ VERIFIED | `src/agent/evaluator.ts:76`: `await run(agent, userMessage, { maxTurns: 5 })` — single run() call site |
| `MaxTurnsExceededError` caught inside `evaluateSoftRules`; others re-throw | ✓ VERIFIED | Lines 93–103 of evaluator.ts: discriminated catch, `throw err` after the `instanceof` check |
| Zero BambooHR writes | ✓ VERIFIED | See SC6 above |
| ESM `.js` imports throughout | ✓ VERIFIED | All 5 Phase 3 modified/created files use `.js` extensions in imports (`from './types.js'`, `from '../pipeline/types.js'`, `from './prompt.js'`, `from './agent/evaluator.js'`, etc.) |
| CR-01 (code review): `evaluateSoftRules` called unconditionally even when `DRY_RUN=true` | ✓ CONFIRMED as documented gap | `src/index.ts:128`: `await evaluateSoftRules(ctx, config.softRules)` is not gated on `dryRun`. `dryRun` is assigned on line 37 and used only in the startup log (line 38). See Gap Analysis section below. |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/agent/types.ts` | EvaluationOutputSchema (Zod) + EvaluationResult (interface) + CriterionResultSchema | ✓ VERIFIED | 72 lines; exports all three; z.infer<typeof CriterionResultSchema>[] used for interface arrays (single source of truth) |
| `src/agent/prompt.ts` | `buildSystemPrompt` + `buildUserMessage` pure functions, no SDK imports | ✓ VERIFIED | 111 lines; two exports; audit footer hardcoded at line 80; `hardRuleResult` not referenced (grep returns 0) |
| `src/agent/evaluator.ts` | `evaluateSoftRules()` with Agent/run/MaxTurnsExceededError | ✓ VERIFIED | 121 lines; all required patterns present |
| `src/logger/logger.ts` | `logEvaluation(record: EvaluationResult)` alongside unchanged `logDecision` | ✓ VERIFIED | 31 lines; both functions present; `logDecision` byte-identical to Phase 2 |
| `src/index.ts` | Pass branch wired to `evaluateSoftRules` + `logEvaluation`; placeholder removed | ✓ VERIFIED | Phase 2 placeholder (`'CV extracted; pending Phase 3 agent evaluation'`) removed; `evaluateSoftRules(ctx, config.softRules)` + `logEvaluation(evalResult)` at lines 128–129; outcome-branched counters at lines 131–138 |
| `src/config/schema.ts` | Optional `softRules` key with `softRuleEntrySchema` | ✓ VERIFIED | `softRuleEntrySchema`, `softRulesSchema`, and `softRules: softRulesSchema` all present |
| `config.yaml` | `softRules` block with 2 required + 1 optional entries | ✓ VERIFIED | Lines 41–49: `softRules:` at top level with 2 required entries and 1 optional entry |
| `package.json` | `@openai/agents` as runtime dependency | ✓ VERIFIED | `"@openai/agents": "^0.8.5"` in `dependencies` |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/agent/evaluator.ts` | `@openai/agents` | `import { Agent, run, MaxTurnsExceededError }` | ✓ WIRED | Line 13 of evaluator.ts |
| `src/agent/evaluator.ts` | `src/agent/types.ts` | `import { EvaluationOutputSchema }` + `import type { EvaluationResult }` | ✓ WIRED | Lines 15–16 of evaluator.ts |
| `src/agent/evaluator.ts` | `src/agent/prompt.ts` | `import { buildSystemPrompt, buildUserMessage }` | ✓ WIRED | Line 17 of evaluator.ts; both used at lines 58–62 |
| `src/agent/evaluator.ts` | `src/pipeline/types.ts` | `import type { CandidateContext }` | ✓ WIRED | Line 14 of evaluator.ts |
| `src/logger/logger.ts` | `src/agent/types.ts` | `import type { EvaluationResult }` | ✓ WIRED | Line 6 of logger.ts; used in `logEvaluation` parameter type |
| `src/index.ts` (pass branch) | `src/agent/evaluator.ts` | `await evaluateSoftRules(ctx, config.softRules)` | ✓ WIRED | Lines 15 (import) + 128 (call) |
| `src/index.ts` (pass branch) | `src/logger/logger.ts logEvaluation` | `logEvaluation(evalResult)` | ✓ WIRED | Lines 16 (import) + 129 (call) |
| `src/index.ts` pass branch | `config.softRules` | `config.softRules` passed to `evaluateSoftRules` | ✓ WIRED | `config.softRules` typed as `SoftRulesInput | undefined` by Zod inference; evaluator handles `undefined` via short-circuit |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `src/index.ts` pass branch | `evalResult` | `await evaluateSoftRules(ctx, config.softRules)` → OpenAI API via SDK | Yes — when `softRules` present, calls GPT-4o; when absent, returns deterministic pass | ✓ FLOWING |
| `src/logger/logger.ts logEvaluation` | `record: EvaluationResult` | Passed from `src/index.ts:129` | Yes — the `evalResult` from evaluator is fully populated before `logEvaluation` is called | ✓ FLOWING |
| `src/agent/evaluator.ts` | `out` (GPT-4o output) | `result.finalOutput` from SDK `run()` | SDK validates against `outputType: EvaluationOutputSchema`; non-null or returns `needsReviewResult` | ✓ FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Short-circuit path (softRules=undefined) returns pass without API call | Code inspection of `evaluateSoftRules` lines 42–55 | Returns `{outcome:'pass', comment:'No soft rules configured', ...}` before any `Agent` or `run()` call | ✓ PASS |
| Hard-rule fail gate prevents evaluateSoftRules | `src/index.ts:100`: `if (result.outcome === 'pass')` | evaluateSoftRules only reachable inside the true branch | ✓ PASS |
| needsReviewReason gate prevents evaluateSoftRules for bad CVs | `src/index.ts:106–117`: early `continue` before evaluateSoftRules | confirmed by code structure | ✓ PASS |
| MaxTurnsExceededError discriminated from other errors | `src/agent/evaluator.ts:93–103` | `instanceof` check then `throw err` for non-matching | ✓ PASS |
| Full end-to-end dry-run produces EvaluationResult JSON to stdout | Cannot run without live credentials | N/A | ? SKIP — human |

---

### Requirements Coverage

| Requirement | Source Plan(s) | Description | Status | Evidence |
|-------------|---------------|-------------|--------|----------|
| RULE-02 | 03-01, 03-02, 03-03, 03-04 | Soft criteria evaluated via GPT-4o with structured JSON output | ✓ SATISFIED | `evaluateSoftRules` uses `outputType: EvaluationOutputSchema` + `model:'gpt-4o'`; config schema accepts `softRules` YAML block; wired in `src/index.ts` pass branch |
| SAFE-02 | 03-01, 03-03, 03-04 | Each per-candidate agent run has explicit `maxTurns` cap (≤ 5) | ✓ SATISFIED | `run(agent, userMessage, { maxTurns: 5 })` at `src/agent/evaluator.ts:76`; single call site |
| BAMB-02 | 03-02, 03-03, 03-04 | System moves candidate pipeline stage to pass/fail stage | PARTIAL — data ready, writes deferred to Phase 4 | Phase 3 produces `EvaluationResult.outcome` which maps to target stage; no write methods implemented yet (intentional per ROADMAP SC4: "zero stage transitions in Phase 3"). The data contract for Phase 4 writes is fully established. |
| BAMB-03 | 03-02, 03-03, 03-04 | System posts structured comment on each processed application | PARTIAL — data ready, writes deferred to Phase 4 | Phase 3 produces `EvaluationResult.comment` (recruiter-ready formatted string with D-06 structure and audit footer). No write API call exists yet. The data contract for Phase 4 comment posting is fully established. |

**Note on BAMB-02/BAMB-03:** REQUIREMENTS.md traces both to Phase 3, but the ROADMAP Phase 3 goal explicitly states "no BambooHR writes yet" and SC4 confirms "zero stage transitions and zero comments are written to BambooHR." Phase 3 satisfies its scope of BAMB-02/BAMB-03 by producing the typed data structures that Phase 4 will use to execute the writes. The actual API calls (BAMB-02 stage move + BAMB-03 comment post) are Phase 4 deliverables. This is intentional phased delivery, not a gap.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/index.ts` | 37–38, 128 | `dryRun` assigned and used only in startup log; `evaluateSoftRules` called unconditionally regardless of `DRY_RUN=true` | WARNING (CR-01 from 03-REVIEW.md) | Every dry-run invocation makes real OpenAI API calls, consuming API credits and sending candidate CV data to OpenAI. Confirmed by code inspection. |
| `src/agent/types.ts` | 44 | `EvaluationOutputSchema.outcome` includes `'needsReview'` in the enum passed to the SDK as `outputType`, allowing GPT-4o to emit `needsReview` (CR-02 from 03-REVIEW.md) | WARNING | GPT-4o can hallucinate `needsReview` as a valid model output; evaluator-synthesized and model-generated `needsReview` become indistinguishable. System prompt instructs GPT-4o not to use it, but the schema does not enforce this at parse boundary. |
| `src/index.ts` | 27–34 | `OPENAI_API_KEY` not validated at startup alongside `BAMBOOHR_API_KEY`/`BAMBOOHR_SUBDOMAIN` (CR-03 from 03-REVIEW.md) | INFO | Missing key deferred to per-candidate error; every candidate logs `outcome:'error'` rather than clean startup exit. Not a blocker for Phase 3 goal but degrades operational experience. |

**CR-01 deeper analysis:** The ROADMAP SC1 says "In dry-run mode, each candidate with a valid CV receives a GPT-4o evaluation logged as JSON." The Phase 3 goal says "hard-rule pre-filter feeds into GPT-4o soft evaluation... in dry-run mode." These statements indicate that GPT-4o IS called in Phase 3's dry-run — dry-run in this phase means no BambooHR writes, not no OpenAI calls. SC4 confirms: "zero stage transitions and zero comments are written to BambooHR" (not zero OpenAI calls). CR-01 is a valid operational concern (API cost, PII to OpenAI without explicit operator intent) but does NOT block any Phase 3 success criterion. It is flagged as a WARNING for human decision.

---

### Human Verification Required

#### 1. End-to-End Dry-Run Evaluation Flow

**Test:** With valid credentials in `.env`, run `DRY_RUN=true npx tsx src/index.ts 2>/dev/null` (or pipe stderr elsewhere) and inspect stdout for JSON lines.

**Expected:** At least one JSON line containing all of: `"applicationId"`, `"applicantId"`, `"outcome"` (one of `pass`, `fail`, `needsReview`), `"required"` (array), `"optional"` (array), `"comment"` (non-empty string with `[Auto-screened by AI — final decision rests with recruiter]` footer), `"timestamp"` (ISO 8601).

**Why human:** Requires real BambooHR + OpenAI credentials; candidate data in the "New" stage is required.

#### 2. Hard-Rule Fail Isolation — No GPT-4o Call

**Test:** Observe a candidate who fails a hard rule (e.g., salary above ceiling or missing required field). Confirm the stdout JSON line is a `CandidateDecision` shape (`reasons: [...]`, no `required`/`optional` arrays) and no `[evaluator]` lines appear in stderr.

**Expected:** `CandidateDecision` record only; no EvaluationResult; no OpenAI API call for that candidate.

**Why human:** Requires a live candidate that fails a configured hard rule; cannot simulate without live BambooHR data.

#### 3. MaxTurnsExceededError Recovery Path

**Test:** Confirm via logs or by artificially reducing `maxTurns` to 1 in a test run that MaxTurnsExceededError produces an EvaluationResult with `"outcome":"needsReview"` and `"comment":"Soft evaluation could not be completed automatically — please review manually."` rather than an unhandled exception.

**Expected:** EvaluationResult JSON line with `outcome:'needsReview'`; no process crash; remaining candidates continue processing.

**Why human:** Triggering MaxTurnsExceededError requires either a live API call with a model that exceeds 5 turns (unusual for structured output) or a code modification; neither is automatable without live credentials and controlled conditions.

---

### Gaps Summary

**No blockers identified.** All five machine-verifiable success criteria pass. The one uncertain criterion (SC1 — end-to-end JSON output) awaits human confirmation with live credentials.

**Two warnings from 03-REVIEW.md carried forward:**
- CR-01: `evaluateSoftRules` called unconditionally — OpenAI API is called in dry-run. Consistent with Phase 3 ROADMAP scope (dry-run = no BambooHR writes; GPT-4o evaluation is the Phase 3 deliverable). No blocker to phase goal but incurs API cost on every `DRY_RUN=true` execution and sends CV data to OpenAI before Phase 4 compliance gates are in place.
- CR-02: `needsReview` in `EvaluationOutputSchema` allows GPT-4o to emit it; prompt-only guard is insufficient.

Both warnings are improvement items for Phase 4 or a gap-closure plan, not blockers for Phase 3 goal completion.

---

*Verified: 2026-05-02T00:00:00Z*
*Verifier: Claude (gsd-verifier)*
