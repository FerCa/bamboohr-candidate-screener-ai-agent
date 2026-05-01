---
phase: 02-pdf-pipeline
reviewed: 2026-05-01T14:00:00Z
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
  warning: 5
  info: 3
  total: 10
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-01T14:00:00Z (updated after plan 07 / GAP-02 gap-closure)
**Depth:** standard
**Files Reviewed:** 8
**Status:** issues_found

## Summary

This report covers the full Phase 2 review, updated after plan 07 applied the GAP-02 gap-closure
to `src/bamboohr/client.ts` and `src/pipeline/extract-cv.ts`.

**What plan 07 changed and whether it introduced new issues:**

`client.ts` replaced the dead two-path `candidatePaths` loop with a two-step approach:
`getApplicationDocuments()` (new method) fetches the documents list, then `downloadPdf()` extracts
a download URL from the returned object using a defensive multi-field-name probe. The logic for
normalising the documents response (array vs. wrapper object) and for URL extraction is sound for
the known field-name variants. However two new warnings are introduced:

1. `matchesFileId()` uses strict `===` equality against a `number` ID, but the API field values
   from JSON may be strings — meaning the ID-match branch silently never fires and the fallback
   "first URL" path is always taken when an application has multiple attachments. No crash, but the
   wrong document could be downloaded.

2. The error-path diagnostic logs dump the full raw response and the resolved download URL to
   stderr. If BambooHR returns a pre-signed S3 URL (common for cloud-stored documents), the
   signed credentials are logged in plaintext. One additional info item: the `void matchedDoc`
   comment misrepresents the variable as "used only for debug logging above" when no log statement
   actually references `matchedDoc` by value.

`extract-cv.ts` had only its comment block updated (lines 73-77). No executable code changed.
All previously identified issues in this file remain open.

**Carry-forward from the earlier review (all still open):**

- CR-01 and CR-02 (hardcoded field names in `extract-cv.ts`; empty `fieldMap` silently disables
  all rules) are unresolved — plan 07 did not touch `extract-cv.ts` executable code or
  `config/schema.ts`.
- WR-01, WR-02, WR-03 (salary silent rejection, string/number `resumeFileId` type gap,
  unfiltered `applicant` key log) are all unresolved.
- IN-01 and IN-02 (Zod record idiom, caret version pins) are unresolved.

Net findings after plan 07: 2 critical, 5 warnings, 3 info (up from 7 total — plan 07 added
WR-04, WR-05, IN-03).

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

### WR-04: `matchesFileId` uses strict `===` number comparison against JSON field that may be a string — ID match silently never fires (introduced in plan 07)

**File:** `src/bamboohr/client.ts:192`

**Issue:** The `matchesFileId` helper compares the document object's ID field against the
`fileId` parameter (a TypeScript `number`) using strict equality:

```typescript
const matchesFileId = (doc: unknown, id: number): boolean => {
  if (doc === null || typeof doc !== 'object') return false;
  const d = doc as Record<string, unknown>;
  return d['id'] === id || d['fileId'] === id || d['file_id'] === id;
};
```

JSON deserialized via `res.json()` produces field values whose runtime type depends on how
BambooHR serializes them. If the API returns `"id": "1234"` (a JSON string — which occurs in
some BambooHR API variants for legacy endpoints), then `d['id']` is the string `"1234"` and
`d['id'] === id` (where `id` is the number `1234`) evaluates to `false` via strict equality.
The ID-match path silently fails for all documents and the code falls through to the "first
document with a URL" fallback path.

This is a silent correctness failure. The fallback still returns a URL so no error is thrown,
but when an application has multiple attachments (cover letter + CV, or CV in multiple formats),
the wrong document may be downloaded. Because the fallback logs only a single `console.error`
line identifying the applicationId, there is no indication that an ID mismatch was the cause.

**Fix:** Coerce to number before comparing, or also compare against the stringified form:

```typescript
const matchesFileId = (doc: unknown, id: number): boolean => {
  if (doc === null || typeof doc !== 'object') return false;
  const d = doc as Record<string, unknown>;
  // Coerce to handle both numeric and string-serialized IDs from the API
  const numericId = (val: unknown): number | null => {
    if (typeof val === 'number') return val;
    if (typeof val === 'string') { const n = Number(val); return Number.isFinite(n) ? n : null; }
    return null;
  };
  return (
    numericId(d['id']) === id ||
    numericId(d['fileId']) === id ||
    numericId(d['file_id']) === id
  );
};
```

---

### WR-05: Error-path logs dump full raw response and resolved download URL — signed URL credentials leaked to stderr (introduced in plan 07)

**File:** `src/bamboohr/client.ts:169-170, 229-235, 263-265`

**Issue:** Three log statements in `downloadPdf()` emit sensitive data to stderr:

1. **Line 169-170** — when the documents list is empty:
   ```typescript
   `[bamboohr] downloadPdf: raw documents response shape: ${JSON.stringify(docsRaw)}`,
   ```
   Dumps the entire API response. If BambooHR embeds file metadata (original filenames, upload
   timestamps, owner info) in the documents list, this constitutes a PII leak to stderr.

2. **Lines 229-235** — when no usable URL is found:
   ```typescript
   `[bamboohr] downloadPdf: full raw response: ${JSON.stringify(docsRaw)}`,
   ```
   Same issue as above, with the added risk that the documents list itself may contain pre-signed
   download URLs for all documents on the application — logging the full raw response therefore
   also logs those credentials.

3. **Line 263-265** — on a failed binary download:
   ```typescript
   `[bamboohr] downloadPdf: binary download returned HTTP ${res.status} for URL=${absoluteUrl} ...`
   ```
   If `absoluteUrl` is a pre-signed S3 URL (standard for cloud document storage), the full URL
   including query-string signature parameters (`X-Amz-Signature`, `X-Amz-Credential`, etc.) is
   written to stderr in plaintext. Depending on how the container's stderr is captured (CloudWatch,
   Datadog, Splunk), these credentials may be stored in a logging system with broader access than
   the runtime environment.

**Fix:**

For the raw response logs, log only structural shape information rather than values:

```typescript
// Instead of JSON.stringify(docsRaw) — log shape only
const shape = Array.isArray(docsRaw)
  ? `array[${(docsRaw as unknown[]).length}]`
  : typeof docsRaw === 'object' && docsRaw !== null
    ? `object{keys: ${Object.keys(docsRaw as object).join(', ')}}`
    : String(typeof docsRaw);
console.error(`[bamboohr] downloadPdf: raw documents response shape: ${shape}`);
```

For the download URL in the error log, strip query parameters before logging:

```typescript
const safeUrl = (() => {
  try { return new URL(absoluteUrl).origin + new URL(absoluteUrl).pathname; }
  catch { return '(unparseable URL)'; }
})();
console.error(`[bamboohr] downloadPdf: binary download returned HTTP ${res.status} for URL=${safeUrl} ...`);
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

### IN-03: `void matchedDoc` comment claims variable is used for debug logging — it is not (introduced in plan 07)

**File:** `src/bamboohr/client.ts:246`

**Issue:**

```typescript
void matchedDoc; // used only for debug logging above; suppress unused-var lint
```

The comment states `matchedDoc` is "used only for debug logging above". Tracing the code, no
`console.error` or `console.log` statement references `matchedDoc` by value. The logging
statements on lines 218-220 and 229-235 reference `docsRaw` and `docs.slice(0, 3)` —
`matchedDoc` is assigned (lines 205, 221) but never read. The comment is inaccurate and will
mislead future maintainers who search for where the matched document is logged.

**Fix:** Either remove `matchedDoc` entirely (the assigned value is not needed) or, if the
intent was to include it in a log, add the log:

```typescript
// Option A — remove unused variable
// (delete matchedDoc assignment and void statement; update both break sites)

// Option B — log it where useful (e.g. when falling back to first-URL path)
console.error(
  `[bamboohr] downloadPdf: using fallback document: ${JSON.stringify(matchedDoc)}`,
);
// NOTE: apply WR-05 shape-only logging if matchedDoc may contain PII
```

---

_Reviewed: 2026-05-01T14:00:00Z (updated for plan 07 / GAP-02 gap-closure)_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
