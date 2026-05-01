---
phase: 02-pdf-pipeline
reviewed: 2026-05-01T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/pipeline/types.ts
  - src/rules/types.ts
  - src/bamboohr/client.ts
  - src/pipeline/extract-cv.ts
  - src/index.ts
  - package.json
findings:
  critical: 4
  warning: 3
  info: 1
  total: 8
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-05-01T00:00:00Z
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the Phase 2 PDF pipeline implementation: `BambooHRClient`, `extract-cv.ts`, `index.ts`,
and associated type definitions. The type and logging infrastructure is solid; the overall
structure (collect-all hard rules, recoverable needsReview path, dry-run default) is correct.

Four blockers were found: a malformed fallback URL in `downloadPdf` that guarantees a 404 on the
second path attempt; use of `applicationId` instead of `applicantId` in the employee-files
fallback path (wrong entity type); a hardcoded stage name `"New"` in `index.ts` that ignores
the configurable intake stage; and an unsafe type assertion on `rawFileId` that passes negative
integers to the download API. Three warnings cover a vacuous-true logic bug in the first-run
PII-disclosure guard, a missing validation that `rawFileId` is a positive integer, and a
PII-in-stderr risk from unguarded `JSON.stringify(detail)`.

---

## Critical Issues

### CR-01: Double `/v1/` segment in `downloadPdf` fallback URL

**File:** `src/bamboohr/client.ts:123`

**Issue:** `this.baseUrl` is already `https://{subdomain}.bamboohr.com/api/v1`. The second
fallback candidate path is `/v1/employees/${applicationId}/files/${fileId}`, which when
concatenated produces `…/api/v1/v1/employees/…` — a path that can never succeed. The second
fallback is therefore permanently broken and will always 404, defeating the purpose of having two
candidate paths.

**Fix:** Strip the leading `/v1` from the fallback path (or rebase to the root):

```typescript
// Option A — remove the redundant /v1 prefix
const candidatePaths = [
  `/applicant_tracking/applications/${applicationId}/documents/${fileId}`,
  `/employees/${applicationId}/files/${fileId}`,
];

// Option B — build the fallback from a root URL, not baseUrl
const rootUrl = `https://${this.subdomain}.bamboohr.com`;
// then fetch rootUrl + `/api/v1/employees/…`
```

---

### CR-02: Wrong entity ID in `downloadPdf` fallback path

**File:** `src/bamboohr/client.ts:123`

**Issue:** The second fallback path is `/v1/employees/${applicationId}/files/${fileId}`. The
BambooHR `/employees/{id}` endpoint expects an **employee (person) ID**, not an
**application ID**. These are distinct entities: `applicationId` is `BambooHRApplication.id`;
the person ID is `BambooHRApplication.applicant.id`. Passing `applicationId` to the employee
endpoint will either return a 404 (wrong person) or, worse, return files belonging to a
different employee whose employee ID happens to collide with the application ID.

**Fix:** The fallback requires the `applicantId` (person ID), not `applicationId`. Pass it as an
additional parameter or restructure the method:

```typescript
async downloadPdf(
  applicationId: number,
  applicantId: number,   // add this
  fileId: number,
): Promise<{ buffer: Buffer; contentType: string }> {
  const candidatePaths = [
    `/applicant_tracking/applications/${applicationId}/documents/${fileId}`,
    `/employees/${applicantId}/files/${fileId}`,   // use applicantId here
  ];
  // …
}
```

Update all call sites in `extract-cv.ts` to pass `detail.applicant.id` as the second argument.

---

### CR-03: Hardcoded intake stage name `"New"` ignores configured stage

**File:** `src/index.ts:56`

**Issue:** The candidate fetch step resolves the intake stage by searching for a status whose
name is literally `"New"`:

```typescript
const newStatus = statuses.find((s) => s.name === 'New');
```

The project's own `config.job.stages` schema provides operator-configured stage names
(`pass`, `fail`) for exactly this purpose — but there is no `intake` stage key, and the
`"New"` string is hardcoded rather than coming from config. If the BambooHR account names the
intake stage anything other than `"New"` (e.g., `"Applied"`, `"Inbox"`, `"New Application"`),
the system finds zero candidates and exits silently with `processed=0` — no error is surfaced
because `candidates.length === 0` is treated as a valid empty result.

**Fix:** Add an `intake` stage to the config schema and use it:

```typescript
// src/config/schema.ts
stages: z.object({
  intake: z.string().min(1),   // add this
  pass: z.string().min(1),
  fail: z.string().min(1),
}),

// src/index.ts
const intakeStageName = config.job.stages.intake;
const newStatus = statuses.find((s) => s.name === intakeStageName);
if (!newStatus) {
  console.error(`[main] Intake stage "${intakeStageName}" not found in BambooHR.`);
  process.exit(1);
}
```

`validateStages()` will then also validate the intake stage automatically.

---

### CR-04: Unsafe `as number` cast on `rawFileId` — non-numeric types silently pass

**File:** `src/pipeline/extract-cv.ts:55-66`

**Issue:** After guarding for `undefined`, `null`, and `0`, the code does:

```typescript
const resumeFileId = rawFileId as number;
```

This is a TypeScript-only assertion that performs no runtime check. Two problems:

1. `rawFileId` may be a **string** (e.g., `"12345"`) from the BambooHR JSON response. The guard
   `rawFileId === 0` checks for numeric zero but not for the string `"0"`. A string passes the
   guard and is then asserted as `number` — TypeScript is satisfied, but at runtime the value is
   still a string. `downloadPdf` receives a string where a number is typed; URL interpolation
   happens to work, but the TypeScript contract is violated and `fileId` comparisons would break.

2. A **negative integer** (e.g., `-1`) passes the `=== 0` check and is forwarded to
   `downloadPdf` as a valid file ID, causing a 404 or an error that is then swallowed as
   `extraction-failed`.

**Fix:** Validate that the value is a positive integer at runtime:

```typescript
const rawFileId = detail['resumeFileId'];
const resumeFileId = typeof rawFileId === 'number' && Number.isInteger(rawFileId) && rawFileId > 0
  ? rawFileId
  : null;

if (resumeFileId === null) {
  console.error(
    `[extract-cv] Invalid or missing resumeFileId for applicationId=${applicationId}. ` +
    `Value: ${JSON.stringify(rawFileId)}. ` +
    `Expected a positive integer. Top-level keys: ${Object.keys(detail).join(', ')}`,
  );
  return makeNeedsReview(applicationId, applicantId, hardRuleResult, applicationAnswers, 'extraction-failed');
}
```

---

## Warnings

### WR-01: `hasPlaceholders` uses `Array.every()` — vacuously true for empty `fieldMap`

**File:** `src/index.ts:78`

**Issue:** The first-run discovery guard is:

```typescript
const hasPlaceholders = fieldMapValues.every((v) => v.includes('REPLACE_WITH'));
```

`Array.prototype.every()` returns `true` for an empty array (vacuous truth). If `fieldMap: {}`
is present in the YAML config (which `z.record(z.string(), z.string())` permits — no minimum
entry count is enforced), then `fieldMapValues` is `[]`, `hasPlaceholders` is `true`, and the
first candidate's full `detail` JSON is logged to stderr on every single run — including full
name, email, and address. This is both a PII leak and a noisy log.

Additionally, the guard fires when **all** values contain `REPLACE_WITH`. A mixed config where
some fields are real and some are placeholders (`every` returns `false`) would suppress the
discovery log even though it is still misconfigured.

**Fix:** Use `some()` instead of `every()`, and also guard against the empty-array case:

```typescript
const fieldMapValues = Object.values(config.fieldMap);
const hasPlaceholders =
  fieldMapValues.length === 0 ||
  fieldMapValues.some((v) => v.includes('REPLACE_WITH'));
```

---

### WR-02: Full `detail` JSON (including PII) logged unconditionally to stderr

**File:** `src/index.ts:89`

**Issue:** When `hasPlaceholders` is true (see WR-01), the full application detail object is
logged via `console.error(JSON.stringify(detail, null, 2))`. This detail includes PII fields
from `BambooHRApplication`: `applicant.firstName`, `applicant.lastName`, `applicant.email`, and
potentially full address and salary. In a containerised environment, stderr is typically captured
by a log aggregator (Docker logs, CloudWatch, etc.) and persisted. Logging raw candidate PII
violates the GDPR compliance requirements stated in `CLAUDE.md`.

**Fix:** Either redact PII before logging, or log only the top-level keys and field paths
(sufficient for field discovery):

```typescript
if (hasPlaceholders && processed === 0) {
  const safeKeys = Object.keys(detail);
  // Show only structure — no values
  const structure = Object.fromEntries(safeKeys.map((k) => [k, typeof detail[k]]));
  console.error('[main] fieldMap has placeholder values. Application detail structure:');
  console.error(JSON.stringify(structure, null, 2));
}
```

---

### WR-03: Duplicate `/applicant_tracking/statuses` API call — stage ID not retained from `validateStages`

**File:** `src/index.ts:53-66`

**Issue:** `validateStages()` calls `GET /applicant_tracking/statuses` at startup (line 63 of
`client.ts`). `index.ts` then makes an **identical second call** at lines 53–55 to resolve the
intake stage ID. Two HTTP requests to the same endpoint within a single run is fragile: if the
second call's response differs from the first (stale cache, race, API inconsistency), stage
validation and stage ID resolution are inconsistent. The comment at line 51 explicitly
acknowledges this as a known issue ("Phase 4 optimization") but it creates a real consistency
risk in the short term.

**Fix:** Refactor `validateStages` to return the resolved stage map, avoiding the duplicate call:

```typescript
// client.ts
async validateStages(config: Config): Promise<Map<string, number>> {
  const statuses = await this.get<BambooHRStatus[]>('/applicant_tracking/statuses');
  const stageMap = new Map(statuses.map((s) => [s.name, s.id]));
  // validate configured names exist…
  return stageMap;
}

// index.ts
const stageMap = await client.validateStages(config);
const intakeId = stageMap.get(config.job.stages.intake);
```

---

## Info

### IN-01: `package.json` pins `pdf-parse` to exact version `1.1.4` without a lockfile entry concern

**File:** `package.json:15`

**Issue:** `pdf-parse` is pinned to the exact version `"1.1.4"` (no range prefix), which is
correct for reproducibility given the CLAUDE.md note that this library has "zero native deps,
works in Alpine." However, `pdf-parse@1.1.4` is the **only release ever published** to npm (no
subsequent patches). Its `lib/pdf.js` contains a filesystem read (`fs.readFileSync`) of a local
test PDF during module load in certain test environments, which can cause unexpected errors when
jest or other test runners import the module. This does not affect production operation but will
bite Phase 3 when tests are written.

**Fix:** No action needed for production. When tests are added in Phase 3, mock `pdf-parse` at
the module boundary rather than invoking it directly in unit tests.

---

_Reviewed: 2026-05-01T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
