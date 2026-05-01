---
phase: 01-foundation
reviewed: 2026-05-01T00:00:00Z
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
  info: 2
  total: 9
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-05-01T00:00:00Z
**Depth:** standard
**Files Reviewed:** 14
**Status:** issues_found

## Summary

The Foundation phase implements config loading, the BambooHR ATS client, hard-rule evaluation, and structured JSON logging. The overall architecture is sound: credentials are correctly env-var-only, the dry-run default is correctly wired, and the evaluate-all (no early-exit) collect rule is correctly implemented.

Three blockers were found:

1. The `requiredFields` rule bypasses `fieldMap` entirely and does a direct property lookup on the top-level application object — this means the `resume` field check silently passes for any candidate because `resume` is never a top-level application key in the BambooHR API response. This is a correctness failure in the primary hard-rule gate.
2. The `isDryRun()` helper reads `LIVE_MODE` but `.env.example` documents `DRY_RUN=true` as the flag operators set. This naming mismatch means operators who follow `.env.example` instructions will have no effect on the dry-run guard: setting `DRY_RUN=false` in `.env` is silently ignored.
3. The `openingId` schema accepts any non-empty string, so the placeholder value `"REPLACE_WITH_YOUR_JOB_OPENING_ID"` passes Zod validation and the agent will issue live API calls against a nonsense job ID, returning empty results with no warning.

Four warnings cover: an infinite-loop risk if the BambooHR API never sets `paginationComplete`, a duplicate `Config` export under two names in `types.ts`, the `dryRun` variable being computed but unused at runtime (no guard at the write site), and a missing guard against `fieldMapValues` being an empty array in the placeholder-detection logic.

---

## Critical Issues

### CR-01: `requiredFields` rule does not use `fieldMap` — direct property access always misses nested fields

**File:** `src/rules/evaluator.ts:84`
**Issue:** Rule 2 (`requiredFields`) accesses fields as `(application as Record<string, unknown>)[fieldName]` — a direct lookup on the top-level application object. The field name `"resume"` (as declared in `config.yaml`) is not a top-level key on `BambooHRApplication`; the resume file ID is nested (e.g., `application.resume.id` or similar). This means the check always evaluates `undefined`, which causes `allPresent = false` and pushes the label, permanently failing every candidate on this rule regardless of whether they attached a CV. Alternatively, if the operator maps `resume` through `fieldMap` to a path, they have no way to use it here because `fieldMap` is not consulted. Either way, the rule does not behave as documented.

Additionally, unlike all other rules, `requiredFields` uses a single shared `label` for all fields in the list — if multiple fields are checked and only one is missing, the operator cannot distinguish which one failed from the log output.

**Fix:** Use `resolveField` (or an equivalent top-level key lookup for truly flat fields), consistent with how Rules 3 and 4 are implemented. For field names that represent nested API paths, route them through `fieldMap`:
```typescript
// Option A: route every requiredFields entry through fieldMap (consistent)
for (const fieldName of fields) {
  const value = resolveField(application, fieldName, fieldMap);
  if (value === undefined || value === null || value === '') {
    allPresent = false;
    break;
  }
}

// Option B (if some required fields are truly top-level): keep direct access
// but document which fields are top-level vs. fieldMap-resolved and add a
// per-field label so the operator knows which field was missing.
```

---

### CR-02: `isDryRun()` reads `LIVE_MODE` but `.env.example` documents `DRY_RUN` — env var naming mismatch

**File:** `src/config/loader.ts:39`, `.env.example:9`
**Issue:** `isDryRun()` returns `process.env['LIVE_MODE'] !== 'true'`, meaning it is only overridden when `LIVE_MODE=true` is set. However, `.env.example` exposes `DRY_RUN=true` as the operator-facing flag to copy and configure. An operator who reads `.env.example`, copies it to `.env`, and leaves it as-is will have `DRY_RUN=true` in their environment — but `isDryRun()` never reads `DRY_RUN`. Setting `DRY_RUN=false` has zero effect. This creates an operator confusion trap and violates the documented contract. In Phase 4, when live writes are added and the operator expects `DRY_RUN=false` to disable dry-run, the system will silently remain in dry-run mode.

**Fix:** Either (A) remove `DRY_RUN` from `.env.example` and document only `LIVE_MODE`, or (B) update `isDryRun()` to honour `DRY_RUN` as well:
```typescript
// Option A (preferred — one flag, one source of truth):
// .env.example: remove DRY_RUN line entirely; add LIVE_MODE=false comment

// Option B (if DRY_RUN must be supported):
export function isDryRun(): boolean {
  if (process.env['LIVE_MODE'] === 'true') return false;
  if (process.env['DRY_RUN'] === 'false') return false;
  return true;
}
```

---

### CR-03: Placeholder `openingId` passes schema validation — agent runs against invalid job ID with no warning

**File:** `src/config/schema.ts:30`, `config.yaml:7`
**Issue:** `openingId` is validated as `z.string().min(1)`. The default config ships with `openingId: "REPLACE_WITH_YOUR_JOB_OPENING_ID"` — a 38-character non-empty string that passes this check. The agent will proceed through startup, call `validateStages`, then call `fetchCandidates` with the literal string `"REPLACE_WITH_YOUR_JOB_OPENING_ID"` as the `jobId` query parameter. The BambooHR API will either return an empty list (silent wrong-result) or a 4xx error (caught and exited). In neither case is the operator given an early, actionable error message at config-load time.

**Fix:** Add a `.refine()` to reject placeholder values, or use a pattern check:
```typescript
openingId: z.string().min(1).refine(
  (v) => !v.startsWith('REPLACE_WITH'),
  { message: 'openingId must be set to a real BambooHR job opening ID' },
),
```
Apply the same pattern to `fieldMap` values that start with `REPLACE_WITH` — at minimum, emit a startup warning distinguishing "placeholder fieldMap (discovery mode)" from "real fieldMap (production mode)" so operators are not confused about which mode they are in.

---

## Warnings

### WR-01: Infinite loop risk in `fetchCandidates` if API never sets `paginationComplete`

**File:** `src/bamboohr/client.ts:99-111`
**Issue:** The pagination loop uses `while (true)` and breaks only when `data.paginationComplete === true`. If the BambooHR API returns a response where `paginationComplete` is absent, always `false`, or returns a truthy non-boolean (e.g., `1`), the loop will run indefinitely. There is no page-count safety limit and no timeout applied to the loop itself. In a Docker container with a daily cron schedule this would hang the container indefinitely.

**Fix:** Add a maximum-page guard:
```typescript
const MAX_PAGES = 100; // safety ceiling; tune to your expected data volume
let page = 1;
while (page <= MAX_PAGES) {
  const data = await this.get<ApplicationsResponse>(...);
  all.push(...data.applications);
  if (data.paginationComplete) break;
  page++;
}
if (page > MAX_PAGES) {
  throw new Error(`fetchCandidates: exceeded ${MAX_PAGES} pages — possible infinite loop`);
}
```

---

### WR-02: `dryRun` variable is computed in `main()` but never gates any behaviour

**File:** `src/index.ts:33`
**Issue:** `const dryRun = isDryRun()` is computed and logged, but nothing in Phase 1 code actually branches on its value. This is expected for Phase 1 (no write paths yet), but the variable is imported and assigned in a way that implies it is actively enforced. When Phase 4 adds write paths, there is no existing guard to copy-paste correctly — the only usage is the startup log message, which is easy to miss as a model for the real guard. This is likely to result in a write path that calls live BambooHR APIs without checking `dryRun`.

**Fix:** Add an explicit no-op guard comment co-located with the write site placeholder, so Phase 4 has an unmissable anchor:
```typescript
// PHASE 4: All write operations must be inside this guard.
// if (!dryRun) {
//   await client.updateStage(application.id, targetStageId);
//   await client.postComment(application.id, comment);
// }
```

---

### WR-03: `hasPlaceholders` detection uses `.every()` — any partially-configured `fieldMap` skips field discovery logging

**File:** `src/index.ts:79-82`
**Issue:** `fieldMapValues.every((v) => v.includes('REPLACE_WITH'))` is true only when ALL values are placeholders. If the operator has configured `salary` and `city` but left `rightToWork` as a placeholder (partial configuration), `.every()` returns `false` and the raw JSON discovery log is suppressed. The operator will not see the raw application JSON that would help them figure out the remaining field path. Additionally, if `fieldMap` is empty (`{}`), `[].every(...)` returns `true` (vacuous truth), causing the raw JSON log to fire even though there are no field-map rules to discover.

**Fix:** Use `.some()` for the "has any placeholder" check, which is the semantically correct condition for triggering discovery logging:
```typescript
const hasPlaceholders = fieldMapValues.length > 0 && fieldMapValues.some((v) =>
  v.includes('REPLACE_WITH'),
);
```

---

### WR-04: `src/config/types.ts` exports `Config` twice under different names — confusion risk

**File:** `src/config/types.ts:3-5`
**Issue:** The file exports the same `Config` type as both `Config` and `AppConfig`:
```typescript
export type { Config } from './schema.js';
export type { Config as AppConfig } from './schema.js';
```
This creates two names for the identical type. Any future code using `AppConfig` will be a different import path from code using `Config`, making refactoring harder and causing reviewer confusion about whether they are the same type. No downstream file currently imports `AppConfig`.

**Fix:** Remove the `AppConfig` alias. If a distinct alias is ever needed, add it then with a clear rationale.

---

## Info

### IN-01: `package.json` specifies `typescript: "^6.0.3"` which does not exist as of the knowledge cutoff

**File:** `package.json:21`
**Issue:** TypeScript's latest stable release as of mid-2025 is in the 5.x series. `^6.0.3` will either fail to resolve during `npm install` or resolve to a future major version with potentially breaking changes. The project should pin to a known-stable version consistent with the `@tsconfig/node22` base (which targets TypeScript 5.x).

**Fix:**
```json
"typescript": "^5.8.0"
```
Verify the version available on npm before pinning.

---

### IN-02: `dotenv` version `^17.4.2` is an unusually high major version — verify against npm

**File:** `package.json:14`
**Issue:** `dotenv` is at version 16.x as of early 2025. `^17.4.2` is likely a non-existent or future version. If it resolves to a real package it may be a fork or pre-release. This will cause `npm install` to fail in CI or Docker builds.

**Fix:** Pin to the known-stable dotenv release:
```json
"dotenv": "^16.4.5"
```
Verify against npm before committing.

---

_Reviewed: 2026-05-01T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
