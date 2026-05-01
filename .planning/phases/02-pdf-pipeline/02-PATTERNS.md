# Phase 2: PDF Pipeline - Pattern Map

**Mapped:** 2026-05-01
**Files analyzed:** 6 (2 new, 4 modified)
**Analogs found:** 6 / 6

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/pipeline/types.ts` | model | transform | `src/rules/types.ts` | exact (type definitions file; same pattern of exported interfaces + union types) |
| `src/bamboohr/client.ts` | service | request-response | `src/bamboohr/client.ts` (existing `get<T>()` method) | exact (binary download is a new method on the same class; same auth, same fetch, different response handling) |
| `src/pipeline/extract-cv.ts` | service | transform + file-I/O | `src/rules/evaluator.ts` | role-match (pure transform function; takes typed input, returns typed output; same collect-and-return structure, no early return on first failure) |
| `src/rules/types.ts` | model | transform | `src/rules/types.ts` (self) | exact (extend existing interface inline) |
| `src/bamboohr/types.ts` | model | transform | `src/bamboohr/types.ts` (self) | n/a (no change required — `[key: string]: unknown` already covers `resumeFileId` discovery) |
| `src/index.ts` | controller | request-response | `src/index.ts` (self) | exact (slot new pipeline step into existing candidate loop; extend counter block) |

---

## Pattern Assignments

### `src/pipeline/types.ts` (model, transform) — NEW FILE

**Analog:** `src/rules/types.ts`

**Imports pattern** (`src/rules/types.ts` lines 1-2 — no external imports; this is the pattern):
```typescript
// No external library imports in type-only files.
// Use 'import type' for cross-module types (ESM NodeNext: .js extension required).
import type { RuleResult } from '../rules/types.js';
```

**Core type definition pattern** (`src/rules/types.ts` lines 8-29 — full file):
```typescript
// Pattern: JSDoc comment block over each exported interface.
// Pattern: union type for outcome values — NOT an enum (serialization-safe).
// Pattern: each field has an inline comment explaining its purpose and any gotchas.

export interface RuleResult {
  /** 'pass' if all rules pass; 'fail' if one or more rules fail */
  outcome: 'pass' | 'fail';
  /**
   * Labels (verbatim from config rule.label) of every unmet rule.
   * Empty array when outcome is 'pass'.
   */
  reasons: string[];
}

export interface CandidateDecision {
  candidateId: number | string;    // applicant.id — for reference/logging
  applicationId: number | string;  // application.id — the BambooHR write entity
  outcome: 'pass' | 'fail' | 'error';
  reasons: string[];
  timestamp: string;               // ISO 8601
}
```

**Apply to `src/pipeline/types.ts`:**
- File header comment explains what these types represent and that they are internal pipeline state (not BambooHR API shapes)
- Export `NeedsReviewReason` as a string literal union (same pattern as `outcome` in `RuleResult`)
- Export `CandidateContext` interface with JSDoc on each field
- Use `import type` from `../rules/types.js` for `RuleResult`

---

### `src/bamboohr/client.ts` — ADD `downloadPdf()` METHOD (modify existing)

**Analog:** `src/bamboohr/client.ts` — existing `get<T>()` method (lines 34-53)

**Auth pattern** (lines 13-28 — constructor sets up shared auth header):
```typescript
export class BambooHRClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(subdomain: string, apiKey: string) {
    this.baseUrl = `https://${subdomain}.bamboohr.com/api/v1`;
    this.authHeader = 'Basic ' + Buffer.from(`${apiKey}:x`).toString('base64');
  }
```

**Core fetch pattern to copy and adapt** (lines 34-53 — `get<T>()` method):
```typescript
async get<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${this.baseUrl}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url.toString(), {
    headers: {
      Authorization: this.authHeader,
      Accept: 'application/json',  // REQUIRED — omitting causes XML response
    },
  });
  if (!res.ok) {
    throw new Error(
      `BambooHR API error: HTTP ${res.status} ${res.statusText} on ${path}`,
    );
  }
  return res.json() as Promise<T>;
}
```

**Key divergences for `downloadPdf()`:**
- Do NOT set `Accept: application/json` — binary response must not request JSON negotiation
- Call `res.arrayBuffer()` instead of `res.json()`
- Return `{ buffer: Buffer; contentType: string }` instead of generic `T`
- Read `res.headers.get('content-type') ?? ''` before consuming the body
- Error message must include both `applicationId` and `fileId` for debuggability
- URL path is the high-uncertainty item (A2 in RESEARCH.md): implement with the most-likely path first, log attempted paths on 404

**Error handling pattern** (lines 47-51 — `get<T>()` non-ok guard — copy verbatim, adapt message):
```typescript
if (!res.ok) {
  throw new Error(
    `BambooHR API error: HTTP ${res.status} ${res.statusText} on ${path}`,
  );
}
```

---

### `src/pipeline/extract-cv.ts` (service, transform + file-I/O) — NEW FILE

**Analog:** `src/rules/evaluator.ts`

**Imports pattern** (`src/rules/evaluator.ts` lines 1-8):
```typescript
// Pattern: file header comment stating what the module does and key decisions it implements.
// Pattern: 'import type' for all type-only imports; named imports from project modules.
// Pattern: .js extensions on all local imports (NodeNext ESM requirement).
import type { Config } from '../config/schema.js';
import type { BambooHRApplication } from '../bamboohr/types.js';
import type { RuleResult } from './types.js';
```

**Core processing function pattern** (`src/rules/evaluator.ts` lines 50-143 — `evaluateHardRules`):
```typescript
// Pattern: exported named async/sync function, not a class.
// Pattern: takes typed inputs, returns typed output — never throws for recoverable failures.
// Pattern: local helper function (resolveField) handles sub-logic; main export is the orchestrator.
// Pattern: const for sub-results accumulated before final return.
// Pattern: function returns typed result object — never undefined, never void.
export function evaluateHardRules(
  config: Config,
  application: BambooHRApplication,
): RuleResult {
  const reasons: string[] = [];
  // ... collect all failures ...
  return {
    outcome: reasons.length === 0 ? 'pass' : 'fail',
    reasons,
  };
}
```

**Apply to `src/pipeline/extract-cv.ts`:**
- Named export `buildCandidateContext()` — async, takes `(client, detail, hardRuleResult)`, returns `Promise<CandidateContext>`
- Private helper `makeNeedsReview()` — same pattern as `resolveField()` in evaluator (local helper, not exported)
- Hardcoded constants at top of file (per D-06): `MAX_CV_CHARS = 8000`, `IMAGE_ONLY_WORD_THRESHOLD = 50`, `IMAGE_ONLY_SIZE_THRESHOLD = 50 * 1024`
- Function never throws for recoverable failures (`extraction-failed`, `non-pdf-content-type`, `image-only-pdf`); only throws for unrecoverable failures (network timeout, auth error) so the outer try/catch in index.ts handles them correctly
- Each recoverable failure path calls `makeNeedsReview(...)` and returns immediately — similar to how evaluator does `reasons.push(label)` for each rule failure

**Error isolation pattern** (`src/rules/evaluator.ts` lines 61-75 — one rule's guard pattern):
```typescript
// Pattern for each recoverable failure: guard → produce typed 'needsReview' result → return.
// Do NOT throw for expected failure modes (missing field, wrong content type, extraction error).
if (rawSalary === undefined || rawSalary === null || rawSalary === '') {
  reasons.push(label);
} else {
  const salary = parseFloat(String(rawSalary).replace(/,/g, ''));
  if (Number.isNaN(salary) || salary > ceiling) {
    reasons.push(label);
  }
}
```

**pdf-parse import note (RESEARCH.md — ESM/CJS interop):**
```typescript
// pdf-parse@1.1.4 is CommonJS; with "module": "NodeNext" use default import.
// If TypeScript reports "does not have a default export", install @types/pdf-parse.
import pdfParse from 'pdf-parse';
```

---

### `src/rules/types.ts` — EXTEND `CandidateDecision.outcome` (modify existing)

**Analog:** `src/rules/types.ts` (self — inline extension)

**Existing interface to modify** (lines 22-29):
```typescript
export interface CandidateDecision {
  candidateId: number | string;    // applicant.id — for reference/logging
  applicationId: number | string;  // application.id — the BambooHR write entity
  outcome: 'pass' | 'fail' | 'error';  // <-- ADD 'needsReview' here (D-07)
  reasons: string[];
  timestamp: string;               // ISO 8601
}
```

**Change:** Add `'needsReview'` to the `outcome` union:
```typescript
outcome: 'pass' | 'fail' | 'needsReview' | 'error';
```

No other changes needed. `logDecision()` in `logger.ts` accepts `CandidateDecision` — the extended union type is backward-compatible; existing call sites passing `'pass'`, `'fail'`, or `'error'` continue to type-check without modification.

---

### `src/bamboohr/types.ts` — NO CHANGE REQUIRED

**Assessment:** The existing `[key: string]: unknown` index signature on `BambooHRApplication` (line 44) already covers `resumeFileId` field discovery. No structural change is needed. The comment on lines 41-44 explicitly describes this design:

```typescript
// NOTE: Additional fields (questions[], resume fileId, etc.) are account-specific.
// On first DRY_RUN, log JSON.stringify(application, null, 2) to discover actual paths.
// fieldMap in config.yaml maps readable names to those actual paths.
[key: string]: unknown;
```

`CandidateContext` goes in `src/pipeline/types.ts` (not here) per the architectural decision in RESEARCH.md — separating BambooHR API shapes from internal pipeline state.

---

### `src/index.ts` — SLOT PDF PIPELINE + EXTEND COUNTERS (modify existing)

**Analog:** `src/index.ts` (self)

**Import block pattern** (lines 7-12 — add new imports here):
```typescript
import 'dotenv/config';

import { loadConfig, isDryRun } from './config/loader.js';
import { BambooHRClient } from './bamboohr/client.js';
import { evaluateHardRules } from './rules/evaluator.js';
import { logDecision } from './logger/logger.js';
// ADD: import { buildCandidateContext } from './pipeline/extract-cv.js';
// ADD: import type { CandidateContext } from './pipeline/types.js';
```

**Counter block pattern** (lines 69-73 — add `needsReview` counter):
```typescript
let processed = 0;
let passed = 0;
let failed = 0;
let errors = 0;
// ADD: let needsReview = 0;
```

**Integration slot** (lines 89-98 — after `evaluateHardRules`, before `logDecision`):
```typescript
// Existing: evaluate all hard rules (collect-all, no LLM)
const result = evaluateHardRules(config, detail);

// ADD Phase 2 block here — between evaluateHardRules and logDecision:
// if (result.outcome === 'pass') {
//   const ctx = await buildCandidateContext(client, detail, result);
//   if (ctx.needsReviewReason !== null) {
//     logDecision({ candidateId: detail.applicant.id, applicationId: detail.id,
//                   outcome: 'needsReview', reasons: [ctx.needsReviewReason],
//                   timestamp: new Date().toISOString() });
//     needsReview++;
//     processed++;
//     continue;
//   }
//   // ctx.cvText is guaranteed non-null here; Phase 3 will consume ctx
// }

// Existing logDecision call (line 92-98) stays for fail/pass-without-context path
logDecision({
  candidateId: detail.applicant.id,
  applicationId: detail.id,
  outcome: result.outcome,
  reasons: result.reasons,
  timestamp: new Date().toISOString(),
});
```

**Summary line pattern** (lines 119-122 — add `needsReview` to output):
```typescript
// Existing:
console.error(
  `[main] Done. processed=${processed} pass=${passed} fail=${failed} errors=${errors}`,
);
// ADD needsReview=${needsReview} to this template string (D-08)
```

**Per-candidate error handling pattern** (`src/index.ts` lines 103-115 — SAFE-01):
```typescript
// Pattern: per-candidate try/catch; never re-throw; log 'error' and continue.
// buildCandidateContext() throws only for unrecoverable errors (network, auth).
// Those unrecoverable throws fall here — they become 'error' outcome, not 'needsReview'.
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  logDecision({
    candidateId: application?.applicant?.id ?? 'unknown',
    applicationId: application?.id ?? 'unknown',
    outcome: 'error',
    reasons: [message],
    timestamp: new Date().toISOString(),
  });
  errors++;
  // NOTE: Do NOT re-throw — continue to next candidate.
}
```

---

## Shared Patterns

### ESM Import Extensions
**Source:** Every existing source file in the project
**Apply to:** All new files in Phase 2
```typescript
// REQUIRED: .js extension on all local imports — "module": "NodeNext" in tsconfig.
// Works for both .ts source and compiled .js output.
import type { RuleResult } from '../rules/types.js';
import { buildCandidateContext } from './pipeline/extract-cv.js';
import type { BambooHRApplication } from '../bamboohr/types.js';
```

### File Header Comment
**Source:** Every existing source file — `src/bamboohr/client.ts` lines 1-5, `src/rules/evaluator.ts` lines 1-5
```typescript
// src/pipeline/types.ts
// [One-line summary of what this file contains.]
// [Key design decisions this file implements, with D-## references.]
// [Source citations if applicable.]
```

### `import type` for Type-Only Imports
**Source:** `src/rules/evaluator.ts` lines 6-8, `src/logger/logger.ts` line 5
```typescript
// Pattern: use 'import type' when the import is used only for type annotations.
// This ensures the import is erased at compile time (no runtime cost).
import type { CandidateDecision } from '../rules/types.js';
import type { BambooHRApplication } from '../bamboohr/types.js';
```

### Authenticated Fetch Error Guard
**Source:** `src/bamboohr/client.ts` lines 47-51
```typescript
if (!res.ok) {
  throw new Error(
    `BambooHR API error: HTTP ${res.status} ${res.statusText} on ${path}`,
  );
}
```
**Apply to:** `downloadPdf()` method — same pattern, adapted error message to include fileId.

### stderr for Diagnostics, stdout for JSON Log Lines
**Source:** `src/index.ts` lines 34, 85-87, 119-122; `src/logger/logger.ts` line 15
```typescript
// Diagnostics, discovery output, mode announcements → console.error() (stderr)
console.error('[main] fieldMap has placeholder values. Logging application detail JSON...');
// Structured candidate decision records → process.stdout.write() via logDecision()
process.stdout.write(JSON.stringify(record) + '\n');
```
**Apply to:** `src/index.ts` modifications — discovery logging for `resumeFileId` field goes to `console.error()`.

### Named Export Function (Not Class) for Pure Logic
**Source:** `src/rules/evaluator.ts` line 50; `src/logger/logger.ts` line 14
```typescript
// Pattern: utility and pipeline modules export named functions, not classes.
// Classes are only used for stateful API clients (BambooHRClient).
export function evaluateHardRules(config: Config, application: BambooHRApplication): RuleResult { ... }
export function logDecision(record: CandidateDecision): void { ... }
```
**Apply to:** `src/pipeline/extract-cv.ts` — export `buildCandidateContext()` as a named function, not a class.

---

## No Analog Found

No files in Phase 2 are entirely without analog. The closest gaps:

| File | Gap | Resolution |
|---|---|---|
| `src/pipeline/extract-cv.ts` | No existing binary-download + pdf-parse integration | Use `evaluateHardRules` structural pattern (named export, helper function, typed I/O) + RESEARCH.md code examples for pdf-parse specifics |
| `src/pipeline/types.ts` | No existing internal pipeline state type file | Use `src/rules/types.ts` structural pattern exactly |

---

## Metadata

**Analog search scope:** `src/bamboohr/`, `src/rules/`, `src/logger/`, `src/config/`, `src/index.ts`
**Files read:** 7
**Pattern extraction date:** 2026-05-01
