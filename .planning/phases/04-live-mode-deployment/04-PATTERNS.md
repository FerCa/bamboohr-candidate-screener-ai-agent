# Phase 4: Live Mode & Deployment - Pattern Map

**Mapped:** 2026-05-02
**Files analyzed:** 5 (2 modified TypeScript, 1 new TypeScript helper, 1 new Dockerfile, 1 new .dockerignore)
**Analogs found:** 4 / 5 (Dockerfile/dockerignore has no analog — project root is empty)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/bamboohr/client.ts` | service / API client | request-response | `src/bamboohr/client.ts` existing `get<T>()` method | exact — add `post<T>()` alongside |
| `src/index.ts` | entry point / orchestrator | event-driven (batch loop) | `src/index.ts` existing per-candidate loop | exact — add write guards, CR-01 fix, INFRA-03 |
| `Dockerfile` | config / build | file-I/O | none — no existing Dockerfile | no analog |
| `.dockerignore` | config | file-I/O | none — no existing .dockerignore | no analog |
| `README.md` | docs | — | none — no existing README.md | no analog |

---

## Pattern Assignments

### `src/bamboohr/client.ts` — add `post<T>()`, `postComment()`, `moveStage()` (service, request-response)

**Analog:** `src/bamboohr/client.ts` — existing `get<T>()` method (lines 38–57)

**Imports pattern** (lines 1–11) — no new imports needed; all types already present:
```typescript
import type { Config } from '../config/schema.js';
import type {
  BambooHRApplication,
  BambooHRStatus,
  ApplicationsResponse,
} from './types.js';
```

**Auth pattern** (lines 21–31) — auth header already on `this.authHeader`, base URL on `this.baseUrl`:
```typescript
this.baseUrl = `https://${subdomain}.bamboohr.com/api/v1`;
this.authHeader = 'Basic ' + Buffer.from(`${apiKey}:x`).toString('base64');
```

**Core GET pattern to mirror for POST** (lines 38–57):
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
      Accept: 'application/json',
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

**New `post<T>()` method — mirrors `get<T>()` exactly, adds body + Content-Type:**
```typescript
private async post<T>(path: string, body: unknown): Promise<T> {
  const url = `${this.baseUrl}${path}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: this.authHeader,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(
      `BambooHR API error: HTTP ${res.status} ${res.statusText} on POST ${path}`,
    );
  }
  return res.json() as Promise<T>;
}
```

**New public methods — placed after `fetchCandidates()`:**
```typescript
async postComment(applicationId: number, comment: string): Promise<void> {
  await this.post<unknown>(
    `/applicant_tracking/applications/${applicationId}/comments`,
    { type: 'comment', comment },
  );
}

async moveStage(applicationId: number, stageId: number): Promise<void> {
  await this.post<unknown>(
    `/applicant_tracking/applications/${applicationId}/status`,
    { status: stageId },
  );
}
```

**Error handling pattern** (lines 51–55) — throw on !res.ok, no try/catch inside the method; caller's per-candidate try/catch handles it:
```typescript
if (!res.ok) {
  throw new Error(
    `BambooHR API error: HTTP ${res.status} ${res.statusText} on ${path}`,
  );
}
```

---

### `src/index.ts` — add write guards, CR-01 fix, INFRA-03 summary (entry point, batch loop)

**Analog:** `src/index.ts` existing structure — the file is modified in place.

**Imports pattern** (lines 1–16) — no new imports needed for write path; `isDryRun` and `BambooHRClient` already imported:
```typescript
import 'dotenv/config';
import { loadConfig, isDryRun } from './config/loader.js';
import { BambooHRClient } from './bamboohr/client.js';
import { evaluateHardRules } from './rules/evaluator.js';
import { logDecision } from './logger/logger.js';
import { buildCandidateContext } from './pipeline/extract-cv.js';
import type { CandidateContext } from './pipeline/types.js';
import { evaluateSoftRules } from './agent/evaluator.js';
import { logEvaluation } from './logger/logger.js';
```

**`dryRun` variable pattern** (line 37) — already declared; all write guards reference this:
```typescript
const dryRun = isDryRun();
```

**CR-01 fix — dry-run guard for OpenAI calls** (replaces unconditional `evaluateSoftRules()` call at line 128):
```typescript
let evalResult: EvaluationResult;
if (dryRun) {
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

**Soft-eval write guard — inserted after `logEvaluation(evalResult)` at line 129** (D-03/D-04 atomicity):
```typescript
if (!dryRun) {
  const targetStageName =
    evalResult.outcome === 'pass'
      ? config.job.stages.pass
      : config.job.stages.fail;   // 'fail' and 'needsReview' both go to reviewed stage (D-01)
  const targetStageId = stageMap.get(targetStageName);
  if (targetStageId === undefined) {
    throw new Error(`[write] Target stage "${targetStageName}" not found in stageMap`);
  }
  // D-03: comment FIRST, then move only if comment succeeds
  await client.postComment(evalResult.applicationId, evalResult.comment);
  await client.moveStage(evalResult.applicationId, targetStageId);
}
```

**Hard-rule fail write guard — inserted after `logDecision()` at line 147** (D-05):
```typescript
if (!dryRun) {
  const hardRuleComment = [
    'FAIL — Hard rules',
    result.reasons.map((r) => `• ${r}`).join('\n'),
    '[Auto-screened by AI — final decision rests with recruiter]',
  ].join('\n\n');

  const failStageId = stageMap.get(config.job.stages.fail);
  if (failStageId === undefined) {
    throw new Error(`[write] Fail stage "${config.job.stages.fail}" not found in stageMap`);
  }
  // D-03: comment FIRST, then move
  await client.postComment(detail.id, hardRuleComment);
  await client.moveStage(detail.id, failStageId);
}
```

**needsReview write guard — inserted after the `logDecision()` call in the `ctx.needsReviewReason !== null` branch** (D-01/D-02/D-04):
```typescript
if (!dryRun) {
  const needsReviewComment = [
    'NEEDS REVIEW — Automated screening incomplete',
    ctx.needsReviewReason,
    '[Auto-screened by AI — final decision rests with recruiter]',
  ].join('\n\n');

  const reviewedStageId = stageMap.get(config.job.stages.fail);
  if (reviewedStageId === undefined) {
    throw new Error(`[write] Reviewed stage not found in stageMap`);
  }
  await client.postComment(detail.id, needsReviewComment);
  await client.moveStage(detail.id, reviewedStageId);
}
```

**Per-candidate error handling pattern** (lines 152–164) — write errors throw and are caught here; no change to the structure, just ensure write errors propagate naturally:
```typescript
} catch (err) {
  // SAFE-01: Log error record and continue to next candidate.
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

**INFRA-03 summary line — replaces `console.error` at line 168–170:**
```typescript
// Keep human-readable stderr line for operator visibility
console.error(
  `[main] Done. processed=${processed} pass=${passed} fail=${failed} needsReview=${needsReview} errors=${errors}`,
);
// INFRA-03: machine-readable JSON summary on stdout (final line, captured by cron log aggregator)
console.log(JSON.stringify({ processed, pass: passed, fail: failed, needsReview, errors }));
```

**`EvaluationResult` import** — required for CR-01 fix; `EvaluationResult` is already re-exported from `logger.ts` so no new import needed. If using it as a type annotation, add:
```typescript
import type { EvaluationResult } from './agent/types.js';
```

---

### `Dockerfile` — new file at project root (config/build, file-I/O)

**Analog:** None in this codebase. Pattern from 04-RESEARCH.md Pattern 6 is the authoritative source.

**Multi-stage build — copy this pattern verbatim:**
```dockerfile
# Stage 1: build (has devDependencies for tsc)
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

# Stage 2: production image (no devDependencies, no source .ts files)
FROM node:22-alpine AS production
WORKDIR /app

# Non-root user for security (Alpine uses addgroup/adduser, not groupadd/useradd)
RUN addgroup -S screener && adduser -S screener -G screener

COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev

USER screener

ENTRYPOINT ["node", "dist/index.js"]
```

**Key constraints:**
- `ENTRYPOINT` exec form (not `CMD`) — process is PID 1, receives SIGTERM cleanly from `docker stop`
- No `EXPOSE` — container makes outbound calls only
- No `HEALTHCHECK` — health is exit code 0/1
- `npm run build` uses `package.json` `"build": "tsc"` script (confirmed in `package.json` line 10)
- `package.json` `"main": "dist/index.js"` confirms the entrypoint path (line 7)

---

### `.dockerignore` — new file at project root (config, file-I/O)

**Analog:** None in this codebase. Pattern from 04-RESEARCH.md Pattern 7 is the authoritative source.

**Copy this pattern verbatim (see override note below):**
```
node_modules/
dist/
.env
.env.*
!.env.example
.git/
*.md
.planning/
.dockerignore
Dockerfile
```

**Override note:** Do NOT include `tsconfig.json` in `.dockerignore` — the multi-stage Dockerfile's build stage requires `tsconfig.json` in the build context for `tsc` to run. Plan 04-02 Task 2 action is the authoritative source on `.dockerignore` content.

**Key inclusions:**
- `node_modules/` — rebuilt inside Docker via `npm ci`; macOS binaries are incompatible with Alpine
- `.env` / `.env.*` — never baked into image (D-06); `!.env.example` is an explicit exception
- `dist/` — rebuilt inside Docker; stale host dist causes confusion
- `.planning/` — no runtime value

---

## Shared Patterns

### Dry-Run Guard (`isDryRun()`)
**Source:** `src/config/loader.ts` lines 38–40
**Apply to:** Every external write call in `src/index.ts`
```typescript
export function isDryRun(): boolean {
  return process.env['LIVE_MODE'] !== 'true';
}
```
The `dryRun` variable at `src/index.ts` line 37 (`const dryRun = isDryRun()`) is already the single gate. All new write blocks are `if (!dryRun) { ... }`. This gate covers BOTH BambooHR writes (Phase 4 new) AND OpenAI calls (CR-01 fix).

### Error Handling — Per-Candidate Try/Catch
**Source:** `src/index.ts` lines 152–164
**Apply to:** BambooHR write calls added in Phase 4 — they throw on HTTP error; the outer `try/catch` catches them and increments `errors`; the loop continues. No additional try/catch inside write blocks needed.

### BambooHR HTTP Error Pattern
**Source:** `src/bamboohr/client.ts` lines 51–55 (inside `get<T>()`)
**Apply to:** New `post<T>()` method in `client.ts`
```typescript
if (!res.ok) {
  throw new Error(
    `BambooHR API error: HTTP ${res.status} ${res.statusText} on ${path}`,
  );
}
```
The `post<T>()` variant extends the message with `on POST ${path}` for clarity.

### Console Channel Convention
**Source:** `src/index.ts` lines 38–39, 168–170 and `src/logger/logger.ts` lines 16–17, 30–31
**Apply to:** All new log lines in `src/index.ts`
```
console.error(...)  → diagnostic / mode messages (goes to stderr)
process.stdout.write(JSON.stringify(record) + '\n')  → per-candidate JSON records
console.log(JSON.stringify(...))  → INFRA-03 final summary JSON (stdout)
```
The INFRA-03 summary uses `console.log` (not `process.stdout.write`) because it is a single terminal line, not a streaming record.

### `applicationId` vs `applicantId` in Write Calls
**Source:** `src/agent/types.ts` lines 57–60 (`EvaluationResult` interface)
**Apply to:** All `client.postComment()` and `client.moveStage()` call sites
- Soft-eval branch: use `evalResult.applicationId` (typed as `number` in `EvaluationResult`)
- Hard-rule fail branch: use `detail.id` (the `BambooHRApplication.id` field — the application ID)
- needsReview branch: use `detail.id`
- NEVER use `detail.applicant.id` or `evalResult.applicantId` for write operations

### ESM Import Extension Convention
**Source:** All existing source files — e.g., `src/index.ts` line 9 (`'./config/loader.js'`)
**Apply to:** Any new import added in Phase 4
```typescript
// Always use .js extension even for .ts source files (NodeNext ESM requirement)
import type { EvaluationResult } from './agent/types.js';
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `Dockerfile` | build config | file-I/O | No existing Dockerfile in project; use RESEARCH.md Pattern 6 verbatim |
| `.dockerignore` | build config | file-I/O | No existing .dockerignore; use RESEARCH.md Pattern 7 verbatim |
| `README.md` | documentation | — | No existing README; content from RESEARCH.md Patterns 8 + D-06/D-07/D-08 decisions |

---

## Metadata

**Analog search scope:** `src/bamboohr/`, `src/config/`, `src/index.ts`, `src/logger/`, `src/agent/`, `src/rules/`, project root
**Files read:** `src/bamboohr/client.ts`, `src/index.ts`, `src/agent/types.ts`, `src/rules/types.ts`, `src/logger/logger.ts`, `src/config/loader.ts`, `package.json`
**Pattern extraction date:** 2026-05-02
