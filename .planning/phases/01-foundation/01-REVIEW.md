---
phase: 01-foundation
reviewed: 2026-05-01T12:00:00Z
depth: standard
files_reviewed: 14
files_reviewed_list:
  - .env.example
  - .gitignore
  - config.yaml
  - package.json
  - tsconfig.json
  - src/bamboohr/client.ts
  - src/bamboohr/types.ts
  - src/config/loader.ts
  - src/config/schema.ts
  - src/config/types.ts
  - src/index.ts
  - src/logger/logger.ts
  - src/rules/evaluator.ts
  - src/rules/types.ts
findings:
  critical: 3
  warning: 4
  info: 1
  total: 8
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-05-01T12:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

The Foundation phase delivers config loading, BambooHR ATS client, hard-rule evaluation, and
structured JSON logging. The architecture is sound: credentials are env-var-only, the dry-run
default is correctly implemented, and the collect-all evaluation order is correctly maintained.

Three blockers were found:

1. The candidate fetch stage is hardcoded as `"New"` in `index.ts`. This string is not sourced
   from `config.yaml` and is not validated by `validateStages`. If the BambooHR account uses a
   different name for the initial stage (e.g., "Applied", "Inbox"), the agent silently processes
   zero candidates with no error — a silent wrong-result failure.

2. The `requiredBoolean` evaluator does not handle numeric `0`/`1` values. BambooHR API responses
   may return boolean form answers as integers; unhandled values cause `actual` to stay `undefined`,
   unconditionally failing every candidate on that rule regardless of their actual answer.

3. The `hasPlaceholders` detection in `index.ts` uses `Array.every()` instead of `Array.some()`.
   JavaScript's vacuous truth rule means an empty `fieldMap` (`{}`) evaluates `[].every(...)` as
   `true`, triggering the raw-JSON discovery log for every candidate even when no field-map rules
   exist. Conversely, a partially-configured fieldMap (some real values, one placeholder) silently
   suppresses the discovery log even though discovery is still needed.

Four warnings cover: pagination data loss when `MAX_PAGES` is hit (error is logged but incomplete
results are silently returned), `dryRun` computed but never branched on (write-gate gap for Phase
4), a duplicate type export creating two names for the same `Config` type, and the missing source
stage in `config.yaml` that makes the hardcoded `"New"` bug impossible to fix without a schema
change.

---

## Critical Issues

### CR-01: Candidate source stage hardcoded as `"New"` — silently processes zero candidates if stage name differs

**File:** `src/index.ts:54`
**Issue:** The stage used to fetch candidates is hardcoded as the string literal `"New"`:
```typescript
const newStatus = statuses.find((s) => s.name === 'New');
```
`config.yaml` defines `job.stages.pass` and `job.stages.fail`, but there is no `job.stages.source`
or equivalent configurable field. The string `"New"` is not validated by `validateStages()` and is
not present in `config.yaml`. If the operator's BambooHR account uses a different stage name for
newly-applied candidates (e.g., "Applied", "Inbox", "Received"), `statuses.find` returns
`undefined`, the agent exits at line 56 with a misleading error, OR the operator never reaches
that case because their pipeline genuinely has a "New" stage but it's mapped to a different
concept.

More critically, if `newStatus` is found but returns 0 applications (because the real intake stage
has a different name), the agent logs `processed=0 pass=0 fail=0 errors=0` and exits with code 0 —
a silent wrong-result that looks like success.

**Fix:** Add a `source` stage name to `config.yaml` and `schema.ts`, then use it in `index.ts`:

`config.yaml`:
```yaml
job:
  openingId: "REPLACE_WITH_YOUR_JOB_OPENING_ID"
  stages:
    source: "New"          # stage to screen candidates from
    pass: "Schedule Phone Screen"
    fail: "Reviewed"
```

`src/config/schema.ts`:
```typescript
stages: z.object({
  source: z.string().min(1),
  pass: z.string().min(1),
  fail: z.string().min(1),
}),
```

`src/index.ts`:
```typescript
const sourceStatus = statuses.find((s) => s.name === config.job.stages.source);
if (!sourceStatus) {
  console.error(`[main] Source stage "${config.job.stages.source}" not found in BambooHR.`);
  process.exit(1);
}
```
This also lets `validateStages` validate the source stage alongside pass/fail.

---

### CR-02: `requiredBoolean` evaluator does not handle numeric `0`/`1` — silently fails every candidate

**File:** `src/rules/evaluator.ts:106-114`
**Issue:** The boolean coercion logic handles `typeof raw === 'boolean'` and `typeof raw === 'string'`
but not `typeof raw === 'number'`. BambooHR form answers may be returned as integers (`1` for yes,
`0` for no). When `raw` is `1` or `0`, neither branch executes, `actual` remains `undefined`, and
line 114 evaluates `actual === undefined || actual !== expectedValue` as `true`, pushing the failure
label unconditionally. Every candidate who answered "yes" via a numeric form response will be
rejected even if their answer satisfies the rule:
```typescript
// raw = 1 (number) — neither branch sets actual:
if (typeof raw === 'boolean') { ... }       // false
else if (typeof raw === 'string') { ... }   // false
// actual is still undefined → rule fails
```

**Fix:** Add a numeric branch before the string branch:
```typescript
if (typeof raw === 'boolean') {
  actual = raw;
} else if (typeof raw === 'number') {
  if (raw === 1) actual = true;
  else if (raw === 0) actual = false;
} else if (typeof raw === 'string') {
  const lower = raw.toLowerCase().trim();
  if (lower === 'yes' || lower === 'true' || lower === '1') actual = true;
  else if (lower === 'no' || lower === 'false' || lower === '0') actual = false;
}
```

---

### CR-03: `hasPlaceholders` uses `Array.every()` — vacuous truth on empty `fieldMap` triggers discovery log unconditionally; partial config suppresses it

**File:** `src/index.ts:79-82`
**Issue:** The placeholder detection logic is:
```typescript
const fieldMapValues = Object.values(config.fieldMap);
const hasPlaceholders = fieldMapValues.every((v) => v.includes('REPLACE_WITH'));
```
Two failure modes:

1. **Empty `fieldMap` (`{}`):** `[].every(fn)` returns `true` in JavaScript (vacuous truth). If
   `fieldMap` is an empty object, `hasPlaceholders` is `true` and the raw-JSON discovery log fires
   for every candidate on the first run. There are no placeholder values to discover, so this is
   a spurious log that pollutes the structured JSON output on stdout.

2. **Partially configured `fieldMap`:** If the operator has set `salary: "questions.2.answer"` and
   `city: "applicant.address.city"` but left `rightToWork: "REPLACE_WITH_..."`, `.every()` returns
   `false` (not all values are placeholders), and the discovery log is suppressed. The operator
   has no way to see the raw JSON to find the remaining `rightToWork` path.

**Fix:** Use `.some()` with an empty-array guard:
```typescript
const hasPlaceholders = fieldMapValues.length > 0 && fieldMapValues.some((v) =>
  v.includes('REPLACE_WITH'),
);
```

---

## Warnings

### WR-01: `fetchCandidates` silently returns incomplete results when `MAX_PAGES` is hit

**File:** `src/bamboohr/client.ts:116-120`
**Issue:** When the pagination loop reaches `MAX_PAGES` (100) without `paginationComplete`, the
function logs a `console.error` warning and then **returns** the partial `all` array. The caller
(`main()`) receives a truncated candidate list without any indication that data is missing — the
final summary will show a count that appears legitimate. In a high-volume pipeline this is a silent
data-loss risk: candidates beyond page 100 are never screened.

**Fix:** Throw an error instead of silently returning partial data, so the caller can decide whether
to abort the run:
```typescript
if (page > BambooHRClient.MAX_PAGES) {
  throw new Error(
    `fetchCandidates: reached MAX_PAGES (${BambooHRClient.MAX_PAGES}) without paginationComplete — results are incomplete`,
  );
}
```
If partial processing is intentional, document it explicitly and add the count of fetched vs.
expected candidates to the log record.

---

### WR-02: `dryRun` is computed in `main()` but never gates any code path

**File:** `src/index.ts:33`
**Issue:** `const dryRun = isDryRun()` is computed and logged to stderr but there is no conditional
branch on its value anywhere in the file. Phase 1 has no write paths, so this is by design, but
the variable is assigned to a constant and used only in a log message. When Phase 4 adds write
paths, there is no existing guard pattern to anchor the new code against — the risk is that a
write path is added without consulting `dryRun`.

**Fix:** Add a commented placeholder at the point where writes will be inserted:
```typescript
// PHASE 4 — ALL write operations MUST be inside this guard:
// if (!dryRun) {
//   await client.updateStage(application.id, targetStageId);
//   await client.postComment(application.id, reasonComment);
// } else {
//   console.error(`[main] DRY_RUN: would move ${application.id} to ${targetStage}`);
// }
```

---

### WR-03: `validateStages` makes two network calls at startup — statuses fetched twice

**File:** `src/index.ts:44`, `src/index.ts:51`
**Issue:** `validateStages()` calls `GET /applicant_tracking/statuses` internally (client.ts:63).
Then `main()` calls `client.get('/applicant_tracking/statuses')` again at line 51 to resolve the
source stage ID. This is two identical network calls to the same endpoint at startup, and
`validateStages()` already has the status list in memory but discards it. Beyond inefficiency,
this doubles the startup latency and the number of API calls that can fail or rate-limit.

**Fix:** Refactor `validateStages` to return the validated statuses array so the caller can reuse
it:
```typescript
async validateStages(config: Config): Promise<BambooHRStatus[]> {
  // ... existing logic ...
  if (hasError) process.exit(1);
  return statuses; // return for reuse
}
```
Then in `main()`:
```typescript
const statuses = await client.validateStages(config);
const sourceStatus = statuses.find((s) => s.name === config.job.stages.source);
```

---

### WR-04: `src/config/types.ts` exports `Config` under two names — dead alias creates confusion

**File:** `src/config/types.ts:3-5`
**Issue:**
```typescript
export type { Config } from './schema.js';
export type { Config as AppConfig } from './schema.js';
```
Both `Config` and `AppConfig` refer to the same type. `AppConfig` is not imported anywhere in the
codebase. Two names for one type makes it unclear to future contributors which to use, and any
future refactoring must track both aliases.

**Fix:** Remove the unused `AppConfig` alias. If a distinct alias is needed in Phase 3 or later,
add it at that point with a rationale comment.

---

## Info

### IN-01: `config.yaml` has no `source` stage field — makes CR-01 fix require a schema change

**File:** `config.yaml:8-10`
**Issue:** `config.yaml` ships with only `pass` and `fail` under `job.stages`. The hardcoded
`"New"` source stage (CR-01) cannot be made configurable without a schema addition. Noting this
as a reminder that fixing CR-01 requires a coordinated change across `config.yaml`, `schema.ts`,
and `index.ts`.

**Fix:** Add `source: "New"` to the `stages` block in `config.yaml` as part of the CR-01 fix:
```yaml
job:
  openingId: "REPLACE_WITH_YOUR_JOB_OPENING_ID"
  stages:
    source: "New"
    pass: "Schedule Phone Screen"
    fail: "Reviewed"
```

---

_Reviewed: 2026-05-01T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
