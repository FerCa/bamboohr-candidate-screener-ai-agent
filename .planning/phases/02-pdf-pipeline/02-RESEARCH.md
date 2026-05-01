# Phase 2: PDF Pipeline - Research

**Researched:** 2026-05-01
**Domain:** BambooHR attachment API, pdf-parse, TypeScript buffer handling, candidate context pipeline
**Confidence:** MEDIUM — pdf-parse API verified; BambooHR attachment endpoint unverifiable without live credentials

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** `CandidateContext` is a separate interface from `CandidateDecision`. `CandidateDecision` remains the log record only.
- **D-02:** `applicationAnswers` is typed `Record<string, unknown>` — raw pass-through from BambooHR, no normalization in Phase 2.
- **D-03:** `cvText` is `string | null` — `null` when extraction failed or flagged.
- **D-04:** `needsReviewReason` is `string | null` — values: `'non-pdf-content-type'`, `'extraction-failed'`, `'image-only-pdf'`, or `null`.
- **D-05:** Image-only detection: word count < 50 AND file size > 50 KB (both required).
- **D-06:** Image-only thresholds are hardcoded — not in `config.yaml`.
- **D-07:** `CandidateDecision.outcome` extends to `'pass' | 'fail' | 'needsReview' | 'error'`.
- **D-08:** Main loop summary gains a `needsReview` counter.

Locked `CandidateContext` interface:
```typescript
interface CandidateContext {
  applicationId: number;
  applicantId: number;
  hardRuleResult: RuleResult;
  cvText: string | null;
  needsReviewReason: string | null;
  applicationAnswers: Record<string, unknown>;
}
```

### Claude's Discretion

- File location for `CandidateContext` type — `src/bamboohr/types.ts` or `src/pipeline/types.ts`
- PDF download implementation — method on `BambooHRClient` or standalone utility
- Integration slot in `index.ts`
- Word count calculation method

### Deferred Ideas (OUT OF SCOPE)

- None deferred from Phase 2 discussion
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BAMB-04 | Download candidate CV as PDF buffer from BambooHR attachment URL | BambooHR attachment endpoint pattern documented below; field name requires live discovery |
| PDF-01 | Download CV PDF, validate `Content-Type: application/pdf`, extract text via `pdf-parse` | pdf-parse v2 API confirmed; binary download via `res.arrayBuffer()` + `Buffer.from()` documented |
| PDF-02 | Truncate extracted CV text to ~8000 chars before GPT-4o | Simple `str.slice(0, 8000)` — no library needed |
| RULE-03 | Flag `needsReview` when CV extraction fails; do not invoke GPT-4o | Error isolation pattern documented; `needsReviewReason` type design confirmed |
</phase_requirements>

---

## Summary

Phase 2 adds three capabilities to the Phase 1 loop: (1) binary PDF download from BambooHR, (2) text extraction via `pdf-parse`, and (3) assembly of a typed `CandidateContext` that Phase 3 consumes. The critical unknowns from Phase 1 — the BambooHR attachment field name and the exact download URL — are not verifiable from public documentation and require live API discovery on first run.

The chosen library `pdf-parse` changed its API completely between v1 and v2. The npm `latest` tag (2.4.5) uses a class-based API and depends on `@napi-rs/canvas`. The `minor` tag (1.1.4) uses a simpler function-based API with zero native dependencies. Both work, but they are not interchangeable. Since the project has not yet installed pdf-parse, a version choice must be made before planning implementation tasks. The research recommends `pdf-parse@1.1.4` (minor tag) for simplicity and zero-native-dep guarantee.

The BambooHR attachment flow has two confirmed parts from community sources: (1) the application detail response contains a `resumeFileId` field (or equivalent); (2) the download uses a separate authenticated HTTP GET that returns binary content. The exact REST endpoint path is not publicly documented and is the highest-uncertainty item in this phase.

**Primary recommendation:** Use `pdf-parse@1.1.4` (minor tag, pure JS). Add `downloadPdf()` as a method on `BambooHRClient`. Write a discovery guard in the main loop that logs the raw application JSON when `resumeFileId` is absent, so the field name can be confirmed on first dry run.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| CV binary download | API / Backend (BambooHRClient) | — | Requires authenticated HTTP; belongs with other BambooHR API calls |
| Content-type validation | API / Backend (download method) | — | Validate at download time before attempting extraction |
| PDF text extraction | API / Backend (pipeline utility) | — | Pure Node.js Buffer processing; no UI or DB involvement |
| Text truncation | API / Backend (pipeline utility) | — | Simple string operation before passing to LLM layer |
| CandidateContext assembly | API / Backend (index.ts loop) | — | Coordination point that combines hard-rule result with PDF result |
| needsReview logging | API / Backend (logger) | — | Extends existing `logDecision()` with new outcome value |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pdf-parse | 1.1.4 (minor tag) | PDF text extraction from Buffer | Zero native dependencies; pure JS; works on Alpine; v1 API is simpler and well-documented |
| Node.js built-in `fetch` | Node.js 22 built-in | Binary PDF download | Already used in `BambooHRClient`; supports `arrayBuffer()` for binary content |

[VERIFIED: npm registry — pdf-parse@1.1.4 has only `node-ensure` as a dependency (no native modules), published 2024-04-28]
[VERIFIED: npm registry — pdf-parse@2.4.5 depends on `@napi-rs/canvas@0.1.80` as a hard (non-optional) dependency]

### Why NOT pdf-parse@2.4.5 (latest)

pdf-parse v2 (`latest` tag, version 2.4.5) has `@napi-rs/canvas` as a **hard non-optional dependency**. While `@napi-rs/canvas` does publish a musl variant (`@napi-rs/canvas-linux-x64-musl`), it is a native pre-compiled binary. This introduces install-time complexity — if the musl binary is missing or fails, the package install fails. The v1 API is simpler for this use case (single function call, no class instantiation, no `destroy()` required). The constraint "no native npm dependencies" in CLAUDE.md means v1 is the safer choice.

[VERIFIED: npm registry — @napi-rs/canvas@0.1.80 optionalDependencies includes @napi-rs/canvas-linux-x64-musl]
[VERIFIED: npm registry — pdf-parse@2.4.5 lists @napi-rs/canvas under `dependencies` (not optionalDependencies)]

### Installation

```bash
npm install pdf-parse@1.1.4
npm install --save-dev @types/pdf-parse
```

**Version verification:**
```bash
npm view pdf-parse version         # confirms latest: 2.4.5
npm view pdf-parse dist-tags       # minor: 1.1.4 — this is the target version
npm view pdf-parse@1.1.4 version   # confirms 1.1.4
```

---

## Architecture Patterns

### System Architecture Diagram

```
index.ts candidate loop
  │
  ├─ [Phase 1: already exists]
  │   └─ evaluateHardRules(config, detail) → RuleResult
  │
  └─ [Phase 2: new]
      │
      ├─ outcome === 'pass' → enter PDF pipeline
      │   │
      │   ├─ BambooHRClient.downloadPdf(resumeFileId)
      │   │   ├─ GET /applicant_tracking/applications/{id}/??  (endpoint TBD)
      │   │   ├─ check Content-Type header
      │   │   │   └─ NOT 'application/pdf' → return { needsReviewReason: 'non-pdf-content-type' }
      │   │   └─ return Buffer + fileSize
      │   │
      │   ├─ pdfParse(buffer) → { text, numpages }
      │   │   └─ throws → return { needsReviewReason: 'extraction-failed' }
      │   │
      │   ├─ image-only heuristic
      │   │   └─ wordCount < 50 AND fileSize > 50KB → { needsReviewReason: 'image-only-pdf' }
      │   │
      │   ├─ truncate text to 8000 chars
      │   │
      │   └─ assemble CandidateContext { applicationId, applicantId, hardRuleResult, cvText, needsReviewReason, applicationAnswers }
      │
      ├─ needsReviewReason !== null → logDecision(outcome: 'needsReview')
      │   └─ increment needsReview counter; continue loop
      │
      └─ CandidateContext (with cvText) → Phase 3 (future)
          └─ for now: logDecision(outcome: 'pass') with placeholder
```

### Recommended Project Structure

```
src/
├── bamboohr/
│   ├── client.ts         # Add downloadPdf() method here
│   └── types.ts          # Keep BambooHR types here
├── pipeline/
│   ├── types.ts          # CandidateContext, NeedsReviewReason — NEW directory
│   └── extract-cv.ts     # extractCvText(): handles pdf-parse + image-only detection — NEW
├── rules/
│   └── types.ts          # RuleResult, CandidateDecision (extend outcome)
├── logger/
│   └── logger.ts         # No change needed (logDecision accepts CandidateDecision)
└── index.ts              # Wire PDF pipeline between hard-rule eval and logDecision
```

**Rationale for `src/pipeline/` directory:** `CandidateContext` is the in-flight state object used across Phase 2 and Phase 3. It is not a BambooHR API type — it is an internal pipeline concept. Placing it in `src/pipeline/types.ts` separates API response shapes (`bamboohr/types.ts`) from pipeline state objects. This is Claude's discretion per D-01.

### Pattern 1: Binary PDF Download on BambooHRClient

**What:** A new `downloadPdf()` method that uses the same auth header but skips `Accept: application/json`, reads binary response, validates Content-Type, and returns a Buffer plus the raw response Content-Type string.

**When to use:** After `fetchApplicationDetails()` returns a `pass` application with a resume file ID.

```typescript
// Source: [ASSUMED — endpoint path requires live discovery; pattern is standard Node.js fetch binary download]
async downloadPdf(resumeFileId: number): Promise<{ buffer: Buffer; contentType: string }> {
  // ASSUMPTION: endpoint path is /applicant_tracking/applications/{id}/documents or similar.
  // The actual path must be discovered from live API on first run.
  // The cloudops/bamboo Go tool uses /files/download.php?id={fileId} (web UI session auth)
  // which is NOT the REST API path. REST API path is unconfirmed in public docs.
  const url = `${this.baseUrl}/applicant_tracking/applications/???/documents/${resumeFileId}`;
  const res = await fetch(url, {
    headers: {
      Authorization: this.authHeader,
      // NO Accept: application/json header — we want binary response
    },
  });
  if (!res.ok) {
    throw new Error(`BambooHR PDF download error: HTTP ${res.status} on fileId ${resumeFileId}`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}
```

### Pattern 2: pdf-parse v1 Text Extraction

**What:** Call the exported function with a Buffer, get text back. Simple promise.

**When to use:** After binary download returns a `application/pdf` Content-Type.

```typescript
// Source: [VERIFIED — npm registry + community examples confirm v1 function call signature]
import pdfParse from 'pdf-parse';
// ESM default import — pdf-parse@1.1.4 uses CommonJS internally but resolves correctly
// with "module": "NodeNext" via interop. Use: import pdfParse from 'pdf-parse'
// If type errors occur, cast: const pdfParse = (await import('pdf-parse')).default

async function extractCvText(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text;  // string — all pages concatenated
}
```

**Result object fields (pdf-parse v1):**
- `data.text` — string, all pages concatenated with newlines
- `data.numpages` — number
- `data.numrender` — number of rendered pages
- `data.info` — PDF metadata object (Author, Title, Creator, etc.)
- `data.metadata` — additional PDF metadata
- `data.version` — pdf.js version string

[VERIFIED: multiple community sources confirm v1 API shape; matches @types/pdf-parse definitions]

### Pattern 3: Image-Only Detection Heuristic

```typescript
// Source: [CITED: CONTEXT.md D-05, D-06 — thresholds locked by user]
function isImageOnlyPdf(text: string, fileSize: number): boolean {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return wordCount < 50 && fileSize > 50 * 1024; // 50 KB
}
```

### Pattern 4: Text Truncation

```typescript
// Source: [ASSUMED — standard string slice; 8000 chars from REQUIREMENTS.md PDF-02]
const MAX_CV_CHARS = 8000;
const truncated = rawText.slice(0, MAX_CV_CHARS);
```

### Pattern 5: Error Isolation in Main Loop

**What:** Each candidate's PDF pipeline step runs inside the existing `try/catch` in `index.ts`. PDF pipeline errors produce `needsReview` (not `error`) when the failure is recoverable (bad content type, extraction failure). Hard crashes (network timeout, auth failure) fall through to the outer `error` catch.

```typescript
// Source: [ASSUMED — extends existing Phase 1 SAFE-01 isolation pattern]
// In index.ts, after evaluateHardRules returns 'pass':
let context: CandidateContext;
try {
  context = await buildCandidateContext(client, detail, result);
} catch (err) {
  // Unexpected error (network, auth) — treat as 'error', not 'needsReview'
  throw err; // re-throw to outer try/catch
}

if (context.needsReviewReason !== null) {
  logDecision({ ..., outcome: 'needsReview', reasons: [context.needsReviewReason] });
  needsReview++;
  continue;
}
// Otherwise: context.cvText is guaranteed non-null here
```

### Anti-Patterns to Avoid

- **Setting `Accept: application/json` on the PDF download request:** The existing `get<T>()` method always sets this header. The PDF download MUST use a separate fetch call without this header — binary responses do not negotiate via Accept.
- **Using the web UI download URL (`/files/download.php?id=...`):** The cloudops/bamboo Go tool uses cookie-based session auth against a web UI endpoint. This is NOT the REST API path and does not work with API key Basic Auth.
- **Calling pdf-parse v2 `new PDFParse({ data: buffer })`:** This is the v2 class API. With v1 (the installed version), call `pdfParse(buffer)` directly as a function.
- **Passing raw `res.json()` instead of `res.arrayBuffer()` for PDF download:** PDF is binary. Calling `.json()` on a binary response throws.
- **Counting words with `text.split(' ')`:** Use `/\s+/` regex split and filter empty strings to handle multi-space and newline separators correctly.

---

## BambooHR Attachment API — Known Unknowns

### What is confirmed (MEDIUM confidence)

Multiple independent sources confirm the following pattern for the BambooHR ATS REST API:

1. **Field name in application detail response:** The application detail response (`GET /applicant_tracking/applications/{id}`) returns resume and cover letter as **file IDs** (not inline binary data). The field name is most likely `resumeFileId` based on the cloudops/bamboo Go source code struct tag and migration guide references. [MEDIUM confidence — cloudops/bamboo uses `resumeFileId` as the JSON tag, but that tool uses web UI endpoints, not the REST API]

2. **Two-step process:** Always requires: (1) get fileId from application detail, (2) separate download request with that fileId.

3. **Authentication:** REST API download uses the same Basic Auth (`apiKey:x` encoded) as all other `/applicant_tracking/` calls. The web UI approach (cookie session + `/files/download.php`) is NOT the right approach for an API key integration.

[CITED: cloudops/bamboo Go source — `resumeFileId` JSON tag, `/files/download.php?id={fileId}` URL]
[CITED: migration guide (clonepartner.com) — "BambooHR stores them as file IDs, not inline content"; `resume_file_id` and `cover_letter_file_id` field names mentioned]

### What is NOT confirmed (requires live discovery)

- **The exact REST API download endpoint path.** The official `documentation.bamboohr.com` does not publish a publicly accessible reference for this endpoint. The candidates are:
  - `/applicant_tracking/applications/{applicationId}/documents/{fileId}` — plausible REST path following resource hierarchy
  - `/v1/employees/{applicantId}/files/{fileId}` — employee files endpoint (different entity)
  - A query-param approach: `/applicant_tracking/files?id={fileId}`

- **Whether the field name is `resumeFileId` or `resume_file_id` (camelCase vs snake_case).** BambooHR uses camelCase for most ATS fields in the REST API responses but some sources report snake_case.

- **Whether the response is direct binary or a redirect to a signed URL.**

### Discovery Strategy (REQUIRED in Wave 0 or Wave 1)

The plan MUST include a discovery task that:

1. Logs `JSON.stringify(detail, null, 2)` for the first application returned by `fetchApplicationDetails()` in DRY_RUN mode. The Phase 1 code already does this when `fieldMap` has placeholder values — the same guard can cover resume field discovery.

2. Tries the download endpoint with the discovered fileId. Log the HTTP status and Content-Type header.

3. If the endpoint returns 404, try alternative paths systematically.

The `BambooHRApplication` type already uses `[key: string]: unknown` precisely for this discovery scenario.

**Recommended implementation guard:**
```typescript
// In downloadPdf() — attempt with most-likely path, surface on 404
const paths = [
  `/applicant_tracking/applications/${applicationId}/documents/${fileId}`,
  `/v1/employees/${applicantId}/files/${fileId}`,
];
// Try first path; if 404, log attempted paths and throw descriptive error
```

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| PDF text extraction | Custom PDF parser | `pdf-parse@1.1.4` | PDF binary format is complex; font encoding, glyph mapping, cross-references — hand-rolling is months of work |
| Binary → Buffer conversion | Manual chunk concatenation | `Buffer.from(await res.arrayBuffer())` | Node.js built-in handles allocation correctly; manual concatenation has off-by-one risk |
| Word count | Complex NLP tokenizer | `text.trim().split(/\s+/).filter(Boolean).length` | Sufficient for the image-only heuristic; NLP tokenizer is overkill |
| Text truncation | Token-aware truncation | `text.slice(0, 8000)` | GPT-4o's token limit is tokens not chars, but 8000 chars ≈ 2000 tokens which is safely under any realistic limit; character truncation is predictable and auditable |

**Key insight:** PDF text extraction has a decade of edge cases (encrypted PDFs, non-standard font encodings, right-to-left text, form fields) that `pdf-parse`'s underlying pdf.js handles. The image-only heuristic is intentionally a blunt instrument — the goal is to avoid calling GPT-4o on binary blobs, not to perfectly detect all scan artifacts.

---

## Type Strategy

### Recommendation: `src/pipeline/types.ts` (new file)

`CandidateContext` is an internal pipeline state object — it is not a BambooHR API response shape. Placing it in `src/bamboohr/types.ts` would blur the boundary between "what BambooHR returns" and "what our pipeline constructs." A new `src/pipeline/types.ts` file makes the architectural boundary explicit.

```typescript
// src/pipeline/types.ts
// [ASSUMED — following established TypeScript separation of concerns pattern]
import type { RuleResult } from '../rules/types.js';

/** String literal union for needsReview reasons — prefer union over enum for serialization */
export type NeedsReviewReason =
  | 'non-pdf-content-type'
  | 'extraction-failed'
  | 'image-only-pdf';

/**
 * In-flight candidate state produced by Phase 2 PDF pipeline.
 * Consumed by Phase 3 agent evaluation.
 * NOT a BambooHR API type — internal pipeline state.
 */
export interface CandidateContext {
  applicationId: number;
  applicantId: number;
  hardRuleResult: RuleResult;
  cvText: string | null;          // null when needsReviewReason !== null
  needsReviewReason: NeedsReviewReason | null;
  applicationAnswers: Record<string, unknown>;
}
```

**Note on `NeedsReviewReason` union type vs `string`:** The interface D-04 says `string | null`. The union type `NeedsReviewReason | null` is strictly compatible — it is a subtype of `string | null`. Using a union type improves type safety (typos in reason strings become compile errors) without changing the interface contract. This is Claude's discretion.

### CandidateDecision extension (in `src/rules/types.ts`)

The existing `CandidateDecision` interface must be updated per D-07:

```typescript
// src/rules/types.ts — extend existing interface
export interface CandidateDecision {
  candidateId: number | string;
  applicationId: number | string;
  outcome: 'pass' | 'fail' | 'needsReview' | 'error';  // add 'needsReview'
  reasons: string[];
  timestamp: string;
}
```

---

## Error Handling

### Isolation Principle

Per SAFE-01 (already implemented in Phase 1), errors on one candidate must not stop others. Phase 2 extends this:

| Failure Type | Recovery | Outcome |
|---|---|---|
| `resumeFileId` absent in detail JSON | Log warning; produce `needsReviewReason: 'extraction-failed'` | `needsReview` |
| Download returns non-200 HTTP | Log error; produce `needsReviewReason: 'extraction-failed'` | `needsReview` |
| Content-Type is not `application/pdf` | Produce `needsReviewReason: 'non-pdf-content-type'` | `needsReview` |
| `pdfParse()` throws | Catch; produce `needsReviewReason: 'extraction-failed'` | `needsReview` |
| Image-only heuristic triggers | Produce `needsReviewReason: 'image-only-pdf'` | `needsReview` |
| Network timeout / auth error | Re-throw to outer `error` catch | `error` |

**The distinction:** `needsReview` means "we have a candidate but can't screen them automatically — human look needed." `error` means "something unexpected happened in our code or infrastructure — this is a bug or outage." They go into different counters in the summary.

### Practical error isolation structure in `index.ts`

```typescript
// Source: [ASSUMED — extends Phase 1 SAFE-01 pattern]
// After evaluateHardRules returns 'pass':
let ctx: CandidateContext;
try {
  ctx = await buildCandidateContext(client, detail, hardRuleResult);
} catch (pipelineErr) {
  // Unexpected error — not a recoverable needsReview — falls to outer error handler
  throw pipelineErr;
}
```

`buildCandidateContext()` should itself return a `CandidateContext` (never throw) for recoverable failures, and throw only for unrecoverable conditions (network timeout, auth failure).

---

## Code Examples

### Complete `buildCandidateContext` skeleton

```typescript
// Source: [ASSUMED — pattern derived from research findings and CONTEXT.md decisions]
// src/pipeline/extract-cv.ts
import pdfParse from 'pdf-parse';
import type { BambooHRClient } from '../bamboohr/client.js';
import type { BambooHRApplication } from '../bamboohr/types.js';
import type { RuleResult } from '../rules/types.js';
import type { CandidateContext, NeedsReviewReason } from './types.js';

const MAX_CV_CHARS = 8000;
const IMAGE_ONLY_WORD_THRESHOLD = 50;
const IMAGE_ONLY_SIZE_THRESHOLD = 50 * 1024; // 50 KB

export async function buildCandidateContext(
  client: BambooHRClient,
  detail: BambooHRApplication,
  hardRuleResult: RuleResult,
): Promise<CandidateContext> {
  const applicationId = detail.id;
  const applicantId = detail.applicant.id;
  // D-02: raw pass-through — no normalization
  const applicationAnswers = (detail['questionsAndAnswers'] ?? {}) as Record<string, unknown>;

  // Discover the resume file ID — field name is account-specific (ASSUMED: 'resumeFileId')
  const resumeFileId = detail['resumeFileId'];
  if (!resumeFileId || typeof resumeFileId !== 'number') {
    return makeNeedsReview(applicationId, applicantId, hardRuleResult, applicationAnswers, 'extraction-failed');
  }

  // Download binary
  let buffer: Buffer;
  let contentType: string;
  try {
    ({ buffer, contentType } = await client.downloadPdf(applicationId, resumeFileId));
  } catch {
    return makeNeedsReview(applicationId, applicantId, hardRuleResult, applicationAnswers, 'extraction-failed');
  }

  // Content-type guard
  if (!contentType.includes('application/pdf')) {
    return makeNeedsReview(applicationId, applicantId, hardRuleResult, applicationAnswers, 'non-pdf-content-type');
  }

  // PDF text extraction
  let rawText: string;
  try {
    const parsed = await pdfParse(buffer);
    rawText = parsed.text;
  } catch {
    return makeNeedsReview(applicationId, applicantId, hardRuleResult, applicationAnswers, 'extraction-failed');
  }

  // Image-only heuristic (D-05, D-06)
  const wordCount = rawText.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < IMAGE_ONLY_WORD_THRESHOLD && buffer.length > IMAGE_ONLY_SIZE_THRESHOLD) {
    return makeNeedsReview(applicationId, applicantId, hardRuleResult, applicationAnswers, 'image-only-pdf');
  }

  // Truncate (PDF-02)
  const cvText = rawText.slice(0, MAX_CV_CHARS);

  return { applicationId, applicantId, hardRuleResult, cvText, needsReviewReason: null, applicationAnswers };
}

function makeNeedsReview(
  applicationId: number,
  applicantId: number,
  hardRuleResult: RuleResult,
  applicationAnswers: Record<string, unknown>,
  reason: NeedsReviewReason,
): CandidateContext {
  return { applicationId, applicantId, hardRuleResult, cvText: null, needsReviewReason: reason, applicationAnswers };
}
```

### ESM import note for pdf-parse@1.1.4

pdf-parse v1 is CommonJS. With `"module": "NodeNext"` in tsconfig, default import works:

```typescript
// Source: [ASSUMED — standard ESM/CJS interop in Node.js 22]
import pdfParse from 'pdf-parse';
// If TypeScript reports type errors, try:
// import { default as pdfParse } from 'pdf-parse';
// or install @types/pdf-parse for type definitions
```

If `import pdfParse from 'pdf-parse'` produces a "does not have a default export" TS error, the fix is `@types/pdf-parse` (which provides the correct type declaration for the default export).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| pdf-parse v1 (function-based, pure JS) | pdf-parse v2 (class-based, pdfjs-dist + @napi-rs/canvas) | Late 2024 (v2.1.x) | v2 is more capable (images, tables, screenshots) but has native deps; v1 stays valid for text-only extraction |
| BambooHR legacy gateway URL (`api.bamboohr.com/api/gateway.php/`) | Subdomain URL (`{subdomain}.bamboohr.com/api/v1`) | Already confirmed in Phase 1 | Phase 1 client uses new URL; confirmed in BambooHR docs |

**Deprecated/outdated:**
- **pdf-parse v1 `require()` style:** Still works with CJS interop but ESM import is preferred in this project.
- **cloudops/bamboo `/files/download.php` URL:** Web UI endpoint requiring cookie auth — NOT usable with API key Basic Auth.

---

## Common Pitfalls

### Pitfall 1: Using `get<T>()` for PDF Download

**What goes wrong:** `BambooHRClient.get<T>()` sets `Accept: application/json` and calls `res.json()`. Calling it for a binary PDF endpoint produces a JSON parse error on the binary response body.

**Why it happens:** The generic method was designed for JSON endpoints only.

**How to avoid:** Implement `downloadPdf()` as a separate method that does NOT set `Accept: application/json` and calls `res.arrayBuffer()` instead of `res.json()`.

**Warning signs:** `SyntaxError: Unexpected token` in JSON parse, or binary garbage in the response.

### Pitfall 2: Assuming `resumeFileId` Field Name

**What goes wrong:** If the actual JSON field is `resume_file_id` (snake_case) or `attachment.resumeId` (nested), the code silently gets `undefined` and flags every candidate as `needsReview`.

**Why it happens:** BambooHR's ATS field names are account-specific and not confirmed from public documentation. The Phase 1 codebase explicitly comments this with `[key: string]: unknown`.

**How to avoid:** Add explicit discovery logging in Wave 0/1: if `detail['resumeFileId']` is undefined, log `Object.keys(detail)` so the actual field name appears in the first dry-run output.

**Warning signs:** Every candidate logs `needsReview` with reason `extraction-failed` on first run.

### Pitfall 3: pdf-parse v2 Class API Confusion

**What goes wrong:** Developer installs `pdf-parse@latest` (2.4.5), calls `pdfParse(buffer)` (v1 style), gets `TypeError: pdfParse is not a function`.

**Why it happens:** v2 exports a class `PDFParse`, not a callable function. The two APIs are completely incompatible.

**How to avoid:** Pin `pdf-parse@1.1.4` explicitly in `package.json`. Do not run `npm update` without checking the version.

**Warning signs:** `TypeError: pdfParse is not a function` at runtime.

### Pitfall 4: Forgetting `.js` Extensions in New Files

**What goes wrong:** Importing `from '../pipeline/types'` (without `.js`) works in `tsx` dev mode but fails in production `node dist/` run with `ERR_MODULE_NOT_FOUND`.

**Why it happens:** `"module": "NodeNext"` requires explicit `.js` extensions in ESM imports even for TypeScript source files.

**How to avoid:** Every new import in Phase 2 code must use `.js` extension: `from '../pipeline/types.js'`, `from '../bamboohr/client.js'`, etc.

**Warning signs:** Works with `npm run dev` (tsx) but crashes with `npm start` (node dist/).

### Pitfall 5: Binary Content-Type Substring Check

**What goes wrong:** Using `contentType === 'application/pdf'` fails when the server returns `application/pdf; charset=utf-8` or similar.

**Why it happens:** HTTP Content-Type headers often include parameters after a semicolon.

**How to avoid:** Use `contentType.includes('application/pdf')` or `contentType.startsWith('application/pdf')`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The application detail response field for the resume is named `resumeFileId` (camelCase) | BambooHR Attachment API | Every candidate becomes `needsReview`; requires code update after first dry run |
| A2 | The REST API download endpoint follows `/applicant_tracking/applications/{applicationId}/documents/{fileId}` | BambooHR Attachment API | Download returns 404; endpoint must be discovered by trial or BambooHR support |
| A3 | The download endpoint accepts the same Basic Auth as all other ATS endpoints | BambooHR Attachment API | Auth error on download; may need different auth approach |
| A4 | The download returns binary directly (not a redirect to a signed URL) | BambooHR Attachment API | `res.arrayBuffer()` on a redirect body returns HTML, not PDF; would need to follow redirect |
| A5 | `applicationAnswers` lives at `detail['questionsAndAnswers']` in the detail response | CandidateContext assembly | `applicationAnswers` is empty `{}`; Phase 3 agent has no application answers to evaluate |
| A6 | `import pdfParse from 'pdf-parse'` works with NodeNext module resolution for v1 | pdf-parse ESM import | TypeScript error; fix with `@types/pdf-parse` or dynamic import |

**All A1–A5 are verifiable on the first `DRY_RUN=true` execution. The plan must include a discovery wave before the main implementation.**

---

## Open Questions

1. **What is the exact REST API download endpoint path?**
   - What we know: Separate endpoint required; fileId comes from application detail; Basic Auth is used
   - What's unclear: The URL path pattern. No public documentation found.
   - Recommendation: Wave 0 must include a discovery task that attempts the most likely path and logs 404 responses with instructions for the developer to check BambooHR's Postman collection (publicly available at documentation.bamboohr.com/docs/postman-collection)

2. **Is `resumeFileId` always present, or only when a CV was uploaded?**
   - What we know: BambooHR does not require CVs on all job applications
   - What's unclear: What value the field has when no CV exists (null, absent key, 0?)
   - Recommendation: Guard with both existence check and value check (`detail['resumeFileId'] != null && detail['resumeFileId'] !== 0`)

3. **Does `pdf-parse@1.1.4` work correctly with Node.js 22?**
   - What we know: v1 was last published 2024-04-28; Node 22 released 2024; the package is pure JS with only `node-ensure` as a dependency
   - What's unclear: Whether any Node.js 22-specific API changes break the pdf.js internals bundled in v1
   - Recommendation: Add a one-line smoke test in Wave 0: parse a known simple PDF buffer and assert `text.length > 0`

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ | v14.21.3 (dev machine) | — |
| npm | Package install | ✓ | 6.14.18 | — |
| pdf-parse@1.1.4 | PDF-01 | ✗ (not yet installed) | — | Install in Wave 0 |
| @types/pdf-parse | TypeScript types | ✗ (not yet installed) | — | Install in Wave 0 |
| BambooHR credentials | BAMB-04 | Unknown (env var) | — | Dry-run logs error if missing |
| Docker/Alpine | INFRA-01 (Phase 4) | Not required for Phase 2 | — | — |

**Note on Node.js version:** The local dev machine runs Node 14.21.3 but the project targets Node 22 (`"engines": { "node": ">=22.0.0" }`). The `tsx` dev runner and `tsc` compiler work at Node 14, but the runtime target is Node 22 (via Docker). All code should be written for Node 22 features (built-in `fetch`, `arrayBuffer()` on response).

**Missing dependencies with no fallback:**
- `pdf-parse@1.1.4` — required for PDF-01; must be installed before implementation begins

---

## Validation Architecture

> `nyquist_validation` is set to `false` in `.planning/config.json`. This section is included as requested in the task brief but the Nyquist validation workflow is disabled.

### Test Framework

No test framework is currently installed in the project. pdf-parse extraction logic is a good candidate for unit tests, but given `nyquist_validation: false`, this phase does not require a test infrastructure.

If tests are added in a future phase, the recommended framework for Node.js 22 ESM projects is **Vitest** (native ESM support, TypeScript first, no config needed for basic usage).

### Phase Requirements → Test Map (informational, not required)

| Req ID | Behavior | Test Type | Notes |
|--------|----------|-----------|-------|
| PDF-01 | Content-type validation rejects non-PDF | unit | Mock fetch; check needsReviewReason === 'non-pdf-content-type' |
| PDF-01 | pdf-parse extracts text from valid PDF | unit | Use a small known PDF fixture; assert text.length > 0 |
| PDF-02 | Text truncation at 8000 chars | unit | Feed 9000-char string; assert output.length === 8000 |
| RULE-03 | Image-only PDF flagged (D-05 thresholds) | unit | Feed buffer with small wordcount and >50KB size |
| BAMB-04 | Download endpoint returns binary | integration | Requires live BambooHR credentials — manual only |

---

## Security Domain

> `security_enforcement` is not explicitly set to `false` in config. Reviewing applicable ASVS categories for Phase 2.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | BambooHR API key auth handled in existing client |
| V3 Session Management | No | Stateless; no sessions |
| V4 Access Control | No | Single-tenant; no user-facing access control |
| V5 Input Validation | Yes | Content-Type validation before extraction; file size implicit via Buffer |
| V6 Cryptography | No | No new crypto operations; existing Basic Auth unchanged |

### Known Threat Patterns for PDF Pipeline

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malicious PDF with zip-bomb characteristics (decompression bomb) | Denial of Service | pdf-parse v1 uses pdf.js which has page/object limits; no additional guard needed for this use case |
| PDF containing embedded scripts or JavaScript | Tampering | pdf-parse extracts text only — no script execution in Node.js context; non-issue |
| Overly large PDF consuming excessive memory | Denial of Service | No explicit size limit before download; if BambooHR serves PDFs > 50 MB this could be an issue. LOW risk for typical CV files. |

**GDPR note (from REQUIREMENTS.md compliance section):** CV text extracted in Phase 2 is held in memory only for the duration of one agent run. It is never persisted to disk or any datastore. This is compliant with the "no PII storage outside BambooHR" requirement. This does not change in Phase 2.

---

## Sources

### Primary (HIGH confidence)
- npm registry (`npm view pdf-parse@1.1.4`, `npm view pdf-parse@2.4.5`, `npm view @napi-rs/canvas@0.1.80`) — package deps and version details verified directly
- Phase 1 source code (`src/bamboohr/client.ts`, `src/bamboohr/types.ts`, `src/index.ts`) — existing patterns, auth approach, type definitions
- CONTEXT.md Phase 2 decisions (D-01 through D-08) — locked interface shape, thresholds, outcome values

### Secondary (MEDIUM confidence)
- cloudops/bamboo Go source (`github.com/cloudops/bamboo`) — `resumeFileId` JSON field name, download URL pattern (web UI, not REST API)
- migration guide (clonepartner.com BambooHR→Greenhouse) — confirms two-step fileId download pattern, mentions `resume_file_id` field
- Multiple integration guide aggregators — confirm "attachments returned as file IDs, require separate requests"
- DEV Community / Tabnine examples — pdf-parse v1 API shape (text, numpages, info, metadata fields)

### Tertiary (LOW confidence)
- WebSearch aggregations of BambooHR ATS documentation — no first-party JSON schema examples found
- pdf-parse v2 README (GitHub) — v2 class API; not used but documented for completeness

---

## Metadata

**Confidence breakdown:**
- pdf-parse v1 API: HIGH — multiple verified sources, npm registry confirms version and deps
- pdf-parse version choice (v1 vs v2): HIGH — native dep concern is verified fact; musl variant exists but is still a native binary
- BambooHR attachment field name: LOW — inferred from third-party Go tool; not confirmed from official REST API docs
- BambooHR download endpoint path: LOW — no public REST API documentation found; requires live discovery
- Integration pattern (loop slot, error isolation): HIGH — extends Phase 1 patterns directly
- Type design: HIGH — follows CONTEXT.md locked decisions; `NeedsReviewReason` union is additive

**Research date:** 2026-05-01
**Valid until:** 2026-06-01 (pdf-parse; stable library) / 2026-05-15 (BambooHR API — account-specific, verify on first run)
