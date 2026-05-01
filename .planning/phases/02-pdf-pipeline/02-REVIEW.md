---
phase: 02-pdf-pipeline
reviewed: 2026-05-01T12:00:00Z
depth: standard
files_reviewed: 8
files_reviewed_list:
  - config.yaml
  - package.json
  - src/bamboohr/client.ts
  - src/config/schema.ts
  - src/index.ts
  - src/pipeline/extract-cv.ts
  - src/pipeline/types.ts
  - src/rules/types.ts
findings:
  critical: 2
  warning: 3
  info: 2
  total: 7
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-01T12:00:00Z
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Reviewed the Phase 2 PDF pipeline after gap-closure plans 02-05 and 02-06 were applied. The
previously identified issues (CR-01 through CR-04, WR-01 through WR-03) are now all correctly
fixed in the current code: the double-`/v1` path is gone, `downloadPdf` takes the separate
`applicantId` parameter, the intake stage is read from `config.job.stages.intake`, `resumeFileId`
is validated with a full positive-integer guard, `hasPlaceholders` uses `some()` with an
empty-array fast-path, the PII log emits only field names and types, and `validateStages` returns
the stageMap that `index.ts` consumes directly.

Two new blockers remain. The `resumeFileId` field lookup and the `questionsAndAnswers` field
lookup in `extract-cv.ts` are both hardcoded string literals — they bypass the `fieldMap`
abstraction entirely, meaning operators cannot reconfigure these paths without editing source code.
Additionally the `config/schema.ts` `fieldMap` record has no minimum-length constraint, allowing
an empty `fieldMap: {}` to pass validation while silently disabling every rule that depends on
field resolution.

Three warnings cover: (1) the `maxSalary` rule's silent rejection of candidates with absent
salary data, (2) a minor PII surface in a diagnostic log that does not filter the `applicant`
key, and (3) the `requiredFields` rule treating a string `resumeFileId` value as "present" while
`extract-cv.ts` requires a numeric value — creating a gap between what hard-rules consider a
passing resume and what the pipeline can actually process.

---

## Critical Issues

### CR-01: `resumeFileId` and `questionsAndAnswers` hardcoded in `extract-cv.ts` — `fieldMap` bypassed

**File:** `src/pipeline/extract-cv.ts:42,54`

**Issue:** `buildCandidateContext` reads two fields directly by hardcoded string literal:

```typescript
// line 42
const rawAnswers = detail['questionsAndAnswers'];

// line 54
const rawFileId = detail['resumeFileId'];
```

The project's `fieldMap` in `config.yaml` exists specifically so operators can remap field paths
without touching source code. The `evaluator.ts` rules engine correctly routes every field through
`resolveField(application, fieldName, fieldMap)`. But the PDF pipeline ignores `fieldMap`
entirely for both the resume file ID and the application answers.

Two concrete failure modes:

1. If the actual BambooHR account returns the file ID under a different key (e.g., `"resume"`,
   `"cv_file_id"`, `"attachments[0].id"`) the operator has no way to fix this via config — the
   code will always look for `"resumeFileId"`, always get `undefined`, and flag every candidate
   as `extraction-failed` with `needsReviewReason`.

2. The `requiredFields` hard rule *also* checks `resume` presence via `fieldMap` (mapped to
   `"resumeFileId"` in `config.yaml`). If the actual BambooHR key differs, the operator updates
   `fieldMap.resume` — but `extract-cv.ts` still reads the old hardcoded key. The two layers
   become inconsistent: a candidate can pass the hard-rule check yet fail CV extraction for the
   same "missing file" reason, causing a misleading `needsReview` outcome.

`questionsAndAnswers` is similarly hardcoded with a diagnostic fallback log (line 44-49) but no
operator-configurable override.

**Fix:** Accept `config` as a parameter in `buildCandidateContext` and use `fieldMap` for both
lookups, mirroring the evaluator pattern:

```typescript
// src/pipeline/extract-cv.ts
export async function buildCandidateContext(
  client: BambooHRClient,
  detail: BambooHRApplication,
  hardRuleResult: RuleResult,
  config: Config,                              // add config
): Promise<CandidateContext> {

  // Replace hardcoded 'questionsAndAnswers':
  const answersPath = config.fieldMap['questionsAndAnswers'] ?? 'questionsAndAnswers';
  // ... or define a dedicated fieldMap key like config.fieldMap.applicationAnswers

  // Replace hardcoded 'resumeFileId':
  const fileIdPath = config.fieldMap['resume'] ?? 'resumeFileId';
  const rawFileId = resolveField(detail, fileIdPath);   // use the same resolver
  // ...
}
```

Update `index.ts` to pass `config` when calling `buildCandidateContext`.

---

### CR-02: `fieldMap` schema has no minimum-entry constraint — empty `fieldMap: {}` silently disables all rules

**File:** `src/config/schema.ts:57`

**Issue:**

```typescript
fieldMap: z.record(z.string(), z.string()),
```

`z.record` with no size constraint accepts an empty object. The `hardRules.refine()` check
(lines 49-55) ensures at least one rule is configured, but says nothing about `fieldMap`. An
operator who publishes `fieldMap: {}` in `config.yaml` will pass schema validation, then:

- `maxSalary` rule calls `resolveField(application, 'salary', {})` — `fieldMap['salary']` is
  `undefined`, path is `undefined`, returns `undefined`, candidate is **rejected** for missing
  salary.
- `requiredBoolean` / `requiredKeyword` rules similarly treat every field as absent and fail.
- `requiredFields` similarly marks every field as absent.

In effect, every candidate is rejected for every rule, silently, with no schema-level error.
This is an especially bad failure mode because the run *appears* to complete successfully
(`processed=N fail=N errors=0`) while applying no real rules.

**Fix:** Add a `.min(1)` entry count check, or at minimum warn when `fieldMap` is empty:

```typescript
// Option A — schema-level enforcement
fieldMap: z.record(z.string(), z.string()).refine(
  (m) => Object.keys(m).length > 0,
  { message: 'fieldMap must contain at least one entry' },
),

// Option B — runtime warning in loadConfig() or main()
if (Object.keys(config.fieldMap).length === 0) {
  console.error('[main] WARNING: fieldMap is empty — all field-based rules will reject every candidate.');
}
```

---

## Warnings

### WR-01: `maxSalary` rule silently rejects candidates whose salary field is absent

**File:** `src/rules/evaluator.ts:65-67`

**Issue:**

```typescript
if (rawSalary === undefined || rawSalary === null || rawSalary === '') {
  // Field absent — cannot verify; treat as failing rule (conservative)
  reasons.push(label);
}
```

If the `salary` field is absent from the BambooHR response (common for intake-stage applications
where salary is not a required form question), every candidate is auto-rejected with the salary
label. The policy of "reject when data is missing" is plausible but is silently baked in rather
than being operator-configurable. An operator who sees a run with all candidates failing on
`"Salary above ceiling"` will have no obvious path to distinguish "salary was provided and over
ceiling" from "salary field was never present."

This is compounded by the fact that `fieldMap.salary = "desiredSalary"` is a top-level field
assumed to exist on the detail response. If BambooHR places salary data inside a nested object
or question array, `resolveField` returns `undefined` and the rule silently rejects every
candidate even though the config is misconfigured, not the candidates.

**Fix:** Add a `rejectOnMissingData` boolean to the `maxSalaryRuleSchema` (default `true` to
preserve current behaviour, allowing operators to opt into `false`), and improve the log message
to distinguish "field absent" from "salary over ceiling":

```typescript
if (rawSalary === undefined || rawSalary === null || rawSalary === '') {
  console.error(
    `[evaluator] maxSalary: salary field absent for application — ` +
    `fieldMap path: "${config.fieldMap['salary'] ?? '(unmapped)'}". ` +
    `Rejecting conservatively.`,
  );
  reasons.push(label);
}
```

At minimum the log should make the absence vs. excess distinction clear so operators can
diagnose misconfigured `fieldMap` paths quickly.

---

### WR-02: `requiredFields` rule allows string `resumeFileId` to pass while pipeline rejects it

**File:** `src/rules/evaluator.ts:84-90` and `src/pipeline/extract-cv.ts:55-58`

**Issue:** The `requiredFields` rule for `resume` evaluates:

```typescript
const value = resolveField(application, fieldName, fieldMap);
if (value === undefined || value === null || value === '') {
  allPresent = false;
}
```

This passes for any truthy value — including the string `"12345"`. The `extract-cv.ts` pipeline
then enforces a stricter guard:

```typescript
typeof rawFileId === 'number' && Number.isInteger(rawFileId) && rawFileId > 0
```

If BambooHR returns `resumeFileId` as a JSON string (which is plausible for some API variants),
a candidate passes the hard-rule check (resume "present") but then hits `extraction-failed` in
the pipeline, and is flagged for human review. The recruiter sees a `needsReview` candidate whose
CV is actually present — the error is in type coercion, not the candidate.

**Fix:** The `requiredFields` check for the resume field should validate that the value is a
positive integer (or delegate to the same guard used in `extract-cv.ts`). Alternatively,
document in a code comment that `requiredFields` only checks presence, not type, so downstream
callers must re-validate types — and ensure that `extraction-failed` log messages make the
type-mismatch case distinguishable from a truly missing file.

---

### WR-03: Diagnostic log at `extract-cv.ts:65` exposes `applicant` key without filter

**File:** `src/pipeline/extract-cv.ts:65`

**Issue:** When `resumeFileId` is absent or invalid, the diagnostic log prints all top-level keys
of `detail`:

```typescript
`Top-level keys on application detail: ${Object.keys(detail).join(', ')} ` +
```

This includes the key `"applicant"` (which the line at 46 deliberately filters out for the
equivalent `questionsAndAnswers` diagnostic). The key name itself is not PII, but the inconsistent
treatment between the two diagnostic messages is confusing and risks escalating: a future
maintainer adding per-field value logging will see the line-46 pattern without the filter and
copy the unfiltered pattern from line 65.

**Fix:** Apply the same filter as line 46 for consistency:

```typescript
`Top-level keys on application detail: ${Object.keys(detail).filter((k) => k !== 'applicant').join(', ')} ` +
```

Or, better, document why `"applicant"` is excluded, making the intent explicit:

```typescript
// Exclude 'applicant' sub-object — it contains PII (name, email); log key names only
const safeKeys = Object.keys(detail).filter((k) => k !== 'applicant');
```

---

## Info

### IN-01: `config/schema.ts` comment cites `z.record(z.string(), z.string())` as Zod v4 API but the two-argument form is undocumented in official Zod v4 reference

**File:** `src/config/schema.ts:3,57`

**Issue:** The comment at line 3 cites `zod.dev/api` as the source for `z.record`. In Zod v4 the
canonical form for a `Record<string, string>` schema is `z.record(z.string())` (one type argument
— the value type). The two-argument form `z.record(z.string(), z.string())` is a Zod v3 pattern
that was preserved in v4 for backwards compatibility but is not the idiomatic v4 API. Both forms
currently work (tested against v4.4.1), but using the non-idiomatic form undermines the "Source:
zod.dev/api" citation and could cause confusion if a future Zod major version drops the two-arg
overload.

**Fix:** Use the idiomatic Zod v4 form:

```typescript
fieldMap: z.record(z.string()),
```

---

### IN-02: `package.json` uses caret for `zod` and `dotenv` while `pdf-parse` is pinned exactly

**File:** `package.json:13,16`

**Issue:** `CLAUDE.md` calls out `pdf-parse` as pinned to exactly `1.1.4` (no caret). The same
discipline is not applied to `zod` (`"^4.4.1"`) or `dotenv` (`"^17.4.2"`), both of which are
runtime dependencies that directly affect config parsing and startup behaviour. A future minor
release of either package could introduce a breaking API change (Zod has a history of minor
versions with breaking behaviour changes) that a caret range would silently install. The presence
of a `package-lock.json` mitigates this for direct installs but `npm install <other-package>`
will update caret-ranged deps.

**Fix:** Pin `zod` and `dotenv` to exact versions in `package.json` for consistency with the
pinning rationale already applied to `pdf-parse`:

```json
"dotenv": "17.4.2",
"zod": "4.4.1"
```

---

_Reviewed: 2026-05-01T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
