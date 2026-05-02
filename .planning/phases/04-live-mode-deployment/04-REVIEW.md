---
phase: 04-live-mode-deployment
reviewed: 2026-05-02T00:00:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/bamboohr/client.ts
  - src/index.ts
  - Dockerfile
  - .dockerignore
  - README.md
findings:
  critical: 1
  warning: 4
  info: 3
  total: 8
status: issues_found
---

# Phase 4: Code Review Report

**Reviewed:** 2026-05-02
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Five files were reviewed covering the BambooHR write path (`postComment`/`moveStage`), the dry-run
guard, Docker packaging, and the operator README. The implementation is largely sound: the
dry-run gate is correct (`LIVE_MODE !== 'true'`), comment-then-move atomicity is correct, and
the Dockerfile multi-stage build with a non-root user is well constructed. Three material defects
were found — one critical (response bodies unconsumed on error paths leak HTTP connections), three
warnings (no fetch timeout, missing OPENAI_API_KEY startup guard in LIVE_MODE, and a stale/wrong
comment describing the PDF download implementation), and three informational items.

---

## Critical Issues

### CR-01: HTTP response bodies unconsumed on error paths — connection pool leak

**File:** `src/bamboohr/client.ts:51-55, 75-79`

**Issue:** When `res.ok` is `false`, `get()` and `post()` throw immediately without consuming
the response body. Node.js's built-in `fetch` (backed by undici) keeps the underlying TCP
connection in a half-closed, unresumable state until the body is garbage-collected. In a
run that processes many candidates against an API returning errors (e.g., 403 on a bad
API key), this produces a connection-per-request leak. In the worst case — an API key with
the wrong permissions producing a 403 on every `postComment`/`moveStage` — the container
can exhaust its socket descriptors before the run completes.

`downloadPdf` at line 176 has the same problem.

**Fix:** Consume (drain or cancel) the body before throwing. The idiomatic pattern:

```typescript
// get() error path (same fix applies to post() and downloadPdf)
if (!res.ok) {
  await res.body?.cancel();   // drain so undici can reuse the connection
  throw new Error(
    `BambooHR API error: HTTP ${res.status} ${res.statusText} on ${path}`,
  );
}
```

Alternatively call `await res.text()` or `await res.arrayBuffer()` and ignore the result,
which drains the body through the normal path.

---

## Warnings

### WR-01: No fetch timeout — container can hang indefinitely on a stalled BambooHR API

**File:** `src/bamboohr/client.ts:38-57, 64-81, 166-189`

**Issue:** None of the three `fetch()` calls in the client set a request timeout via
`AbortSignal`. If BambooHR becomes unresponsive (connection accepted, no bytes returned),
Node.js built-in fetch will wait forever. This container is designed to be a short-lived
cron job; a hung fetch holds up the cron slot indefinitely and prevents the next
scheduled run from starting cleanly on systems with single-instance cron guards.

**Fix:** Add an `AbortSignal.timeout(ms)` to every fetch call:

```typescript
const FETCH_TIMEOUT_MS = 30_000;  // 30 s, configurable constant

const res = await fetch(url.toString(), {
  signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  headers: {
    Authorization: this.authHeader,
    Accept: 'application/json',
  },
});
```

`AbortSignal.timeout()` is available in Node.js 17.3+ / 22 LTS with no extra dependencies.

---

### WR-02: `OPENAI_API_KEY` not validated at startup in LIVE_MODE — first failing candidate absorbs a silent error

**File:** `src/index.ts:28-35`

**Issue:** `BAMBOOHR_API_KEY` and `BAMBOOHR_SUBDOMAIN` are validated at startup with an
immediate `process.exit(1)` if either is absent. `OPENAI_API_KEY` receives no equivalent
check. In `LIVE_MODE=true`, if `OPENAI_API_KEY` is missing the `@openai/agents` SDK will
fail when it first tries to call the OpenAI API. That error surfaces only inside the
per-candidate try/catch (per SAFE-01), so the missing key manifests as `errors: N` in the
final summary rather than a clear startup failure. If all candidates fail hard rules before
reaching the soft-eval step, the missing key is never detected at all, giving a false-clean
summary.

The README (line 62) already calls `OPENAI_API_KEY` a required variable for live runs,
so a matching startup guard is the logical completion of the existing pattern.

**Fix:** Add the check alongside the existing credential guard:

```typescript
const apiKey = process.env['BAMBOOHR_API_KEY'];
const subdomain = process.env['BAMBOOHR_SUBDOMAIN'];
const openAiKey = process.env['OPENAI_API_KEY'];

if (!apiKey || !subdomain) {
  console.error('[main] Missing required environment variables: BAMBOOHR_API_KEY, BAMBOOHR_SUBDOMAIN');
  process.exit(1);
}

// Guard OPENAI_API_KEY only in LIVE_MODE to preserve dry-run behaviour (CR-01).
const dryRun = isDryRun();
if (!dryRun && !openAiKey) {
  console.error('[main] LIVE_MODE=true but OPENAI_API_KEY is not set. Exiting.');
  process.exit(1);
}
```

---

### WR-03: Stale comment in `extract-cv.ts` describes an unimplemented two-step download

**File:** `src/pipeline/extract-cv.ts:73-77`

**Issue:** The comment block above the `downloadPdf` call states:

> `downloadPdf() now uses a two-step approach (GAP-02 fix):`
> `Step 1: fetches document list via GET /applicant_tracking/applications/{id}/documents`
> `Step 2: downloads the binary using the URL found in the document object`

`client.ts:downloadPdf` performs a single direct request to
`/hiring/api/applications/{applicationId}/files/{fileId}/download`. There is no two-step
document-list fetch. The comment describes an approach that was planned, not one that was
implemented. A future maintainer reading this comment would look for code that does not
exist, or assume their fix to `downloadPdf` should maintain a two-step flow that the code
never actually had.

**Fix:** Replace the comment with an accurate description:

```typescript
// --- Step 2: Download PDF binary (BAMB-04) ---
// Uses the BambooHR hiring web API:
//   GET /hiring/api/applications/{applicationId}/files/{resumeFileId}/download
// Throws for network/auth errors — caught below and returned as needsReview('extraction-failed').
```

---

### WR-04: `config.yaml` not excluded from Docker build context

**File:** `.dockerignore`

**Issue:** `config.yaml` in the project root is NOT listed in `.dockerignore`. The current
Dockerfile does not `COPY config.yaml` anywhere, so it is not baked into the image today.
However, as a defense-in-depth gap: if a future maintainer adds a broad `COPY . .`
(a common pattern when expanding the Dockerfile), `config.yaml` — which contains the job
opening ID, salary ceiling, and YAML rule details — will be silently included in the image.
Operators have been instructed to mount it at runtime, not bake it in; the `.dockerignore`
should enforce that intent.

**Fix:** Add to `.dockerignore`:

```
# Operator rules config — mounted via volume at runtime, never baked into the image (D-06).
config.yaml
```

---

## Info

### IN-01: Duplicate import from the same module

**File:** `src/index.ts:12, 17`

**Issue:** `logDecision` (line 12) and `logEvaluation` (line 17) are both imported from
`./logger/logger.js` in separate `import` statements. This is valid TypeScript ESM but
inconsistent with the module system's convention of combining named exports from the same
source:

```typescript
// Current — two statements
import { logDecision } from './logger/logger.js';
import { logEvaluation } from './logger/logger.js';

// Preferred — one statement
import { logDecision, logEvaluation } from './logger/logger.js';
```

**Fix:** Merge into a single import statement.

---

### IN-02: `_applicantId` parameter retained in `downloadPdf` signature

**File:** `src/bamboohr/client.ts:169`

**Issue:** `downloadPdf(applicationId, _applicantId, fileId)` accepts and ignores
`_applicantId`. The underscore prefix communicates "intentionally unused" but the
parameter is still part of the public call signature and all callers must supply a value.
If `_applicantId` will never be used (the hiring endpoint only requires `applicationId`
and `fileId`), removing it now prevents callers from needing to pass it and reduces
confusion about why it exists.

**Fix:** Remove the parameter from the signature and update the single call site in
`extract-cv.ts:81`:

```typescript
// client.ts
async downloadPdf(
  applicationId: number,
  fileId: number,
): Promise<{ buffer: Buffer; contentType: string }>

// extract-cv.ts
({ buffer, contentType } = await client.downloadPdf(applicationId, resumeFileId));
```

---

### IN-03: `processed` counter excludes error candidates — summary arithmetic is surprising

**File:** `src/index.ts:71-75, 220-245`

**Issue:** The final summary logs `processed + errors` as two separate counters, but
`processed` is never incremented in the `catch` block — only `errors++` is. This means
`processed` counts only successfully-handled candidates, not all candidates attempted.
The README health check (line 197) says to parse `errors` separately, which is correct,
but operators seeing `{"processed":2,"errors":1}` for a 3-candidate run may not realise
that `processed + errors` equals the total. A `total` field in the summary JSON would
remove the ambiguity.

**Fix:** Either add a `total` key:

```typescript
console.log(
  JSON.stringify({ total: candidates.length, processed, pass: passed, fail: failed, needsReview, errors }),
);
```

or document the arithmetic explicitly in the README health check section.

---

_Reviewed: 2026-05-02_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
