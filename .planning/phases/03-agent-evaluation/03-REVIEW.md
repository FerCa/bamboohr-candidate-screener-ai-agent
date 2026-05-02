---
phase: 03-agent-evaluation
reviewed: 2026-05-02T00:00:00Z
depth: standard
files_reviewed: 7
files_reviewed_list:
  - src/agent/evaluator.ts
  - src/agent/prompt.ts
  - src/agent/types.ts
  - src/index.ts
  - src/logger/logger.ts
  - src/config/schema.ts
  - config.yaml
findings:
  critical: 3
  warning: 3
  info: 2
  total: 8
status: issues_found
---

# Phase 03: Code Review Report

**Reviewed:** 2026-05-02T00:00:00Z
**Depth:** standard
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Reviewed the Phase 3 agent evaluation layer: the `@openai/agents` soft-rule evaluator, prompt builders, type schemas, main entry point, logger, and config schema. The core logic (one-agent-per-candidate, MaxTurnsExceededError recovery, hard-rules-before-LLM) is structurally sound. Three blockers were identified: the dry-run flag is never enforced (live OpenAI API calls are made unconditionally), the structured-output schema allows GPT-4o to emit `needsReview` (undermining the error-only semantics of that value), and `OPENAI_API_KEY` absence is not caught at startup.

---

## Critical Issues

### CR-01: Dry-run flag is read but never enforced — agent makes live OpenAI API calls in dry-run mode

**File:** `src/index.ts:37-38, 128`

**Issue:** `isDryRun()` is called and `dryRun` is assigned on line 37, used only for a log message on line 38, and then never referenced again. `evaluateSoftRules(ctx, config.softRules)` is called unconditionally on line 128 regardless of the dry-run flag. According to CLAUDE.md: "Dry-run is default. `DRY_RUN=true` unless `LIVE_MODE=true` is explicitly set." Every dry-run invocation therefore makes real OpenAI API calls, consuming API credits and sending candidate CV data to OpenAI even in mode that is supposed to make no external writes.

**Fix:** Guard the agent call with the `dryRun` flag. When `dryRun` is true, skip the API call and emit a deterministic pass result so the log record is still produced:

```typescript
let evalResult: EvaluationResult;
if (dryRun) {
  // Dry-run: skip GPT-4o entirely, emit a predictable log record.
  evalResult = {
    applicationId: ctx.applicationId,
    applicantId: ctx.applicantId,
    outcome: 'pass',
    required: [],
    optional: [],
    comment: '[DRY_RUN] Soft evaluation skipped — no API call made.',
    timestamp: new Date().toISOString(),
  };
} else {
  evalResult = await evaluateSoftRules(ctx, config.softRules);
}
logEvaluation(evalResult);
```

Alternatively, pass `dryRun` into `evaluateSoftRules` and short-circuit there — the important invariant is that no OpenAI network call is made when `DRY_RUN=true`.

---

### CR-02: `EvaluationOutputSchema` allows GPT-4o to return `'needsReview'`, collapsing the error/model-output distinction

**File:** `src/agent/types.ts:44`

**Issue:** `EvaluationOutputSchema.outcome` is `z.enum(['pass', 'fail', 'needsReview'])`. This schema is passed as `outputType` to the Agent, which means the SDK's structured output layer will accept a model response of `needsReview` without error. The system prompt in `prompt.ts:65` instructs GPT-4o "Never output 'needsReview'", but the schema does not enforce this constraint at the parsing boundary. If GPT-4o ignores the instruction — which LLMs can do, especially on edge-case inputs — a model-generated `needsReview` reaches `evaluator.ts` as a successful parse and is returned identically to the evaluator-synthesised `needsReview` produced on MaxTurnsExceededError. There is no way for downstream logic (Phase 4) to distinguish "max turns hit" from "model hallucinated needsReview".

**Fix:** Remove `'needsReview'` from `EvaluationOutputSchema.outcome`. The model is only allowed to output `pass` or `fail`. `needsReview` is synthesised only by `evaluator.ts` in its catch blocks:

```typescript
// src/agent/types.ts
export const EvaluationOutputSchema = z.object({
  required: z.array(CriterionResultSchema),
  optional: z.array(CriterionResultSchema),
  comment: z.string(),
  outcome: z.enum(['pass', 'fail']),  // NOT 'needsReview' — reserved for evaluator.ts error paths
});
```

`EvaluationResult` (the TypeScript interface) retains `'needsReview'` in its `outcome` union — that is correct.

---

### CR-03: `OPENAI_API_KEY` is not validated at startup — failure deferred to per-candidate runtime error

**File:** `src/index.ts:27-34`

**Issue:** Lines 27-34 validate `BAMBOOHR_API_KEY` and `BAMBOOHR_SUBDOMAIN` at startup and exit with code 1 if either is absent. `OPENAI_API_KEY` is consumed silently by the `@openai/agents` SDK (via `getDefaultOpenAIKey()`) when `evaluateSoftRules` is called. If the variable is missing or empty, the SDK will throw an authentication error at per-candidate evaluation time (inside the for-loop try/catch on line 152). Every hard-rule-passing candidate will be processed through API detail fetch, CV download, and extraction before the missing key is discovered for that candidate, and each one will be logged with `outcome: 'error'` rather than triggering a clean fatal startup exit.

**Fix:** Add `OPENAI_API_KEY` to the startup credential check alongside the BambooHR credentials:

```typescript
const apiKey = process.env['BAMBOOHR_API_KEY'];
const subdomain = process.env['BAMBOOHR_SUBDOMAIN'];
const openaiKey = process.env['OPENAI_API_KEY'];

if (!apiKey || !subdomain || !openaiKey) {
  console.error('[main] Missing required environment variables: BAMBOOHR_API_KEY, BAMBOOHR_SUBDOMAIN, OPENAI_API_KEY');
  console.error('[main] Copy .env.example to .env and fill in your credentials.');
  process.exit(1);
}
```

Note: If soft rules are not configured in config.yaml, `OPENAI_API_KEY` is not actually needed (the short-circuit in `evaluateSoftRules` skips the API call). The guard can be conditioned on `config.softRules` presence if needed, but a fail-fast check is always safer than a deferred per-candidate failure.

---

## Warnings

### WR-01: `processed` counter has two increment sites creating a fragile dual-path pattern

**File:** `src/index.ts:116, 151`

**Issue:** Most candidates reach `processed++` at line 151. The single exception is the `needsReviewReason !== null` early-exit branch (lines 115-117), which increments `processed` at line 116 and then `continue`s. This means the `processed` counter is maintained by two different lines. The pattern is currently correct, but is fragile: any future early `continue` added to another code path that does not manually increment `processed` will silently under-count, and the counter at line 151 is not obviously "the one true increment location" because an exception already exists. This divergence would also be invisible in the final summary log.

**Fix:** Move `processed++` before any `continue` exit is possible and remove the per-branch increment, or restructure using a `finally`-like pattern:

```typescript
try {
  // ... all candidate logic ...
} catch (err) {
  // ... error handling ...
} finally {
  // NOTE: errors path does NOT call processed++; errors is a separate counter.
}
processed++;  // Unconditional — runs for both pass and needsReview branches.
```

Alternatively, replace the early `continue` with a flag and let the normal flow handle it, keeping a single `processed++` at the bottom. The current mix of line 116 and line 151 is the root of the fragility.

---

### WR-02: Comment template in prompt omits example for unmet optional criteria

**File:** `src/agent/prompt.ts:77-83`

**Issue:** The `COMMENT FORMAT` template example (lines 71-80) shows only `Optional (met)`. Line 83 instructs GPT-4o to omit the optional section entirely when the optional list is empty, but gives no guidance on how to format optional criteria that exist but were NOT met. The only example the model has is the `Optional (met): • <label>: <rationale>` pattern. Concretely, if a candidate does not have open-source contributions, GPT-4o has no template to follow — it may omit unmet optional criteria entirely, invent an `Optional (unmet):` section, or produce inconsistent formatting across candidates. This breaks the D-06 structured comment requirement.

**Fix:** Add an explicit `Optional (unmet)` section to the comment format template:

```
'Optional (met):',
'• <label>: <rationale>',
'',
'Optional (unmet):',
'• <label>: <rationale>',
'',
'[Auto-screened by AI — final decision rests with recruiter]',
```

And update the prose instruction to specify: "Include all optional criteria in the Optional section, grouped into met/unmet subsections. Omit the Optional section entirely only when no optional criteria are configured."

---

### WR-03: `fieldMap` schema allows an empty record, silently deferring mis-configuration failure to rule evaluation

**File:** `src/config/schema.ts:75`

**Issue:** `fieldMap: z.record(z.string(), z.string())` accepts an empty object `{}`. The `hardRules` section can reference fields by name (`rightToWork`, `city`, `salary`, `resume`), and those lookups fail silently at rule-evaluation time if the corresponding key is absent from `fieldMap`. An operator who accidentally deletes all `fieldMap` entries will see `loadConfig` succeed, and the failure will not manifest until evaluation time (likely reporting every candidate as passing due to unmapped fields evaluating to undefined). The `hasPlaceholders` check on line 78 of `index.ts` treats an empty fieldMap as a discovery mode signal, which partially mitigates this for the first candidate, but still proceeds with hard-rule evaluation.

**Fix:** Add a `min(1)` constraint or a `.refine()` cross-check against the `hardRules` fields that require a fieldMap entry:

```typescript
fieldMap: z.record(z.string(), z.string()).refine(
  (map) => Object.keys(map).length > 0,
  { message: 'fieldMap must contain at least one entry' }
),
```

A stronger fix would cross-validate that every field referenced by `hardRules` entries (`requiredBoolean[*].field`, `requiredKeyword[*].field`, the `maxSalary` field, `requiredFields.fields[*]`) has a corresponding key in `fieldMap`.

---

## Info

### IN-01: `dryRun` variable is unused dead code (beyond the startup log message)

**File:** `src/index.ts:37`

**Issue:** `const dryRun = isDryRun()` is assigned on line 37 and used only in the `console.error` on line 38. It is never used as a conditional anywhere else in the file. This is dead code until CR-01 is fixed. Once CR-01 is remediated, the guard will reference `dryRun` and this note becomes moot.

**Fix:** Address CR-01 above. Once the agent call is gated on `dryRun`, this variable is live.

---

### IN-02: `logDecision` and `logEvaluation` emit structurally incompatible JSON schemas with no type discriminant

**File:** `src/logger/logger.ts:15, 29`

**Issue:** `CandidateDecision` records (emitted by `logDecision`) have a `reasons: string[]` field and no `required`/`optional` fields. `EvaluationResult` records (emitted by `logEvaluation`) have `required: CriterionResultSchema[]`, `optional: CriterionResultSchema[]`, and `comment: string`, but no `reasons` field. Both share `applicationId`, `applicantId`, `outcome`, and `timestamp`. Any log consumer (aggregator, Phase 4 processor) that reads the stdout stream will receive a mix of both shapes with no `type` or `recordType` discriminant field to distinguish them without inspecting which fields are present.

**Fix:** Add a `type` discriminant field to both record shapes:

```typescript
// In CandidateDecision:
type: 'decision';  // 'hard-rule-fail' | 'needs-review' | 'error'

// In EvaluationResult:
type: 'evaluation';
```

Alternatively, unify under a tagged-union log record type that wraps both payloads, ensuring the stream is always self-describing.

---

_Reviewed: 2026-05-02T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
