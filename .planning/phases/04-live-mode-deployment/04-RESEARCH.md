# Phase 4: Live Mode & Deployment - Research

**Researched:** 2026-05-02
**Domain:** BambooHR write API, Docker/Alpine packaging, cron wiring, CR gap closure
**Confidence:** MEDIUM — BambooHR write endpoint bodies are MEDIUM confidence (confirmed via official docs + multiple cross-sources but direct JSON page fetch returned 404; see Assumptions Log)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01:** `needsReview` candidates are moved to the `Reviewed` stage in LIVE_MODE — same as `fail`. They do not stay in intake.

**D-02:** Comment format for `needsReview` candidates: `NEEDS REVIEW — Automated screening incomplete` as header, brief reason (e.g., "CV could not be extracted" or "Evaluation engine error"), fixed audit footer `[Auto-screened by AI — final decision rests with recruiter]`.

**D-03:** Comment is posted **before** stage move. Only if the comment POST succeeds does the stage move proceed. If either call fails, the candidate is left in the intake stage and counted as `error` in the summary (not `processed`).

**D-04:** Atomicity policy (comment-then-move) applies to **all** outcomes: `pass`, `fail`, `needsReview`.

**D-05:** Hard-rule fails also trigger BambooHR writes in LIVE_MODE. Moved to `Reviewed`, comment lists failed hard rules (e.g., `FAIL — Hard rules: Salary ceiling exceeded`). Same comment-first-then-move atomicity applies.

**D-06:** Secrets injected via `--env-file` (not inline `-e KEY=value`). The crontab entry in README uses `--env-file`.

**D-07:** `config.yaml` is volume-mounted at runtime: `-v /path/to/config.yaml:/app/config.yaml`. Existing `CONFIG_PATH=/app/config.yaml` env var wires it in.

**D-08:** README documents both a macOS crontab entry and a note for Linux server deployment.

### Claude's Discretion

- Docker image build: single-stage vs multi-stage, `ENTRYPOINT` vs `CMD`, `.dockerignore` contents — standard Node Alpine patterns.
- BambooHR write endpoints: researcher must confirm exact API paths for stage transitions (BAMB-02) and comments (BAMB-03).
- INFRA-03 summary line: move from current `console.error` string to `console.log(JSON.stringify({processed, pass, fail, needsReview, errors}))` as the final stdout line.
- Phase 3 open CRs (CR-01, CR-02, CR-03): fold CR-01 fix (dry-run guard for OpenAI calls) into Phase 4 Plan 1. CR-02 and CR-03 are lower priority.

### Deferred Ideas (OUT OF SCOPE)

- Phase 3 CR-02 and CR-03: lower priority, can be addressed post-Phase 4 if needed.
- 02-07 gap (PDF download 404): still deferred from Phase 2, not blocking Phase 4.
- SAFE-03 (idempotency guard) and all v2 requirements: out of scope for this phase.

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | App runs as short-lived `node:22-alpine` Docker container; exits with code 0 (success) or 1 (error) after processing | Multi-stage Dockerfile pattern confirmed; existing `main().catch(() => process.exit(1))` already handles exit codes |
| INFRA-03 | Final log line is a JSON summary object: `{processed, pass, fail, needsReview, errors}` | Current `console.error` string on line 169 of index.ts must be replaced with `console.log(JSON.stringify(summary))` |
| INFRA-04 | README documents macOS crontab entry and Linux server deployment note | `docker run --rm --env-file /path/to/secrets.env -v /path/to/config.yaml:/app/config.yaml image-name` pattern confirmed |
| BAMB-02 | System moves candidate's pipeline stage in BambooHR | `POST /applicant_tracking/applications/{applicationId}/status` with `{ "status": <statusId integer> }` — MEDIUM confidence |
| BAMB-03 | System posts structured comment on each processed application | `POST /applicant_tracking/applications/{applicationId}/comments` with `{ "type": "comment", "comment": "<text>" }` — MEDIUM confidence |

</phase_requirements>

---

## Summary

Phase 4 activates the write path (BAMB-02, BAMB-03) that Phases 1–3 deferred, packages the application as a `node:22-alpine` Docker image, and documents the external cron wiring. The application code changes are narrow and well-defined: two new methods on `BambooHRClient` (`postComment` + `moveStage`), a write-guard block in `src/index.ts`, a new hard-rule-fail write path, and the INFRA-03 summary line change. The infrastructure deliverables are a Dockerfile, a `.dockerignore`, and README documentation. Phase 4 also folds in the CR-01 fix from Phase 3 (dry-run guard for OpenAI calls) since the same `isDryRun()` pattern is being hardened anyway.

**Key risk:** The BambooHR write endpoint request bodies are MEDIUM confidence — confirmed via the official `update-applicant-status` page WebFetch and cross-referenced across multiple search result excerpts, but the specific endpoint HTML pages are 404-ing on direct fetch. The URL paths and body shapes shown are consistent across all sources consulted. They are tagged as `[CITED]` with medium confidence; the implementer should do a quick validation pass on first LIVE_MODE run.

**Primary recommendation:** Use a two-plan wave structure: Plan 1 handles all TypeScript changes (CR-01 fix + BAMB-02 + BAMB-03 + INFRA-03); Plan 2 handles Dockerfile, .dockerignore, and README. These have no shared files, so they can be parallel waves with Plan 1 as a prerequisite only because Plans 2's README needs to reference the final Docker image name from the Dockerfile.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| BambooHR write (stage move, comment post) | API / Backend (BambooHRClient) | — | All BambooHR I/O lives in the client layer; follows established pattern from read methods |
| Dry-run guard for OpenAI calls (CR-01) | Entry point (src/index.ts) | — | The `dryRun` flag already lives in index.ts line 37; guard is added at the call site |
| Write orchestration (comment-then-move atomicity) | Entry point (src/index.ts) | — | The per-candidate loop in index.ts owns sequencing; client methods are pure HTTP calls |
| INFRA-03 summary line | Entry point (src/index.ts) | Logger (logger.ts optional) | Summary is already assembled in index.ts; change is a one-line stdout format fix |
| Docker packaging | Build / Container layer | — | Dockerfile + .dockerignore; no application code changes |
| Cron documentation | README | — | External cron triggers `docker run`; nothing inside the container changes |

---

## BambooHR Write APIs

### BAMB-02: Stage Transition (moveStage)

**Endpoint:** `POST /applicant_tracking/applications/{applicationId}/status`
**Full URL:** `https://{subdomain}.bamboohr.com/api/v1/applicant_tracking/applications/{applicationId}/status`

**Auth:** Same Basic auth as existing client methods: `Basic base64("apiKey:x")`, `Accept: application/json`.

**Request body:**
```json
{ "status": <statusId integer> }
```
The `statusId` integer is already available in `stageMap` (returned by `validateStages()` at startup).
Use `config.job.stages.pass` → stageMap for `pass`, `config.job.stages.fail` → stageMap for `fail`/`needsReview`.

**Response:** HTTP 200 with `{ "type": ..., "id": ... }` on success.
**Error codes:** 400 bad request, 401 unauthorized, 403 insufficient permissions (API key must have ATS settings access), 404 bad URL.

**Confidence:** MEDIUM — `[CITED: documentation.bamboohr.com/reference/update-applicant-status]` (WebFetch confirmed endpoint path + `status` field name as integer). Cross-referenced against multiple search result excerpts from official BambooHR docs. The `status` field name (not `statusId`) was explicitly returned by the official docs WebFetch.

**Integration point:** New `moveStage(applicationId: number, stageId: number): Promise<void>` method on `BambooHRClient`. Follows the same `this.request()` / `fetch` pattern as existing methods. Needs Content-Type: application/json header for POST bodies.

### BAMB-03: Post Comment (postComment)

**Endpoint:** `POST /applicant_tracking/applications/{applicationId}/comments`
**Full URL:** `https://{subdomain}.bamboohr.com/api/v1/applicant_tracking/applications/{applicationId}/comments`

**Auth:** Same Basic auth as above.

**Request body:**
```json
{ "type": "comment", "comment": "<text string>" }
```
The `comment` field accepts freeform text. The `type` field must be the literal string `"comment"`.

**Response:** HTTP 200 with `{ "type": "comment", "id": <number> }` on success.
**Error codes:** Same 400/401/403/404 pattern.

**Confidence:** MEDIUM — `[CITED: documentation.bamboohr.com/reference/post-application-comment]` (search result excerpts directly quoting the official docs page showed the `{ type, comment }` body structure consistently across multiple independent sources).

**Integration point:** New `postComment(applicationId: number, comment: string): Promise<void>` method on `BambooHRClient`.

### URL Base Format — Critical Clarification

The existing `client.ts` uses `https://{subdomain}.bamboohr.com/api/v1` as the base URL. This is confirmed correct by official BambooHR getting-started docs. `[CITED: documentation.bamboohr.com/docs/getting-started]` — the official docs show `{companyDomain}.bamboohr.com/api/v1` as the standard format.

Several third-party sources and older search results reference `api.bamboohr.com/api/gateway.php/{subdomain}/v1/` — this is the **legacy** format. The existing client.ts already uses the correct modern format, and the write methods must use the same base URL as the rest of the client.

---

## Standard Stack

No new dependencies are required for Phase 4. All necessary packages are already installed.

### Existing Dependencies (confirmed current)

| Library | Installed Version | Purpose |
|---------|------------------|---------|
| typescript | ^6.0.3 (latest: 6.0.3) | [VERIFIED: npm view typescript version] |
| @tsconfig/node22 | ^22.0.5 (latest: 22.0.5) | [VERIFIED: npm view @tsconfig/node22 version] |

### Docker Base Image

**Use:** `node:22-alpine` — specified by INFRA-01 and CLAUDE.md.
This is the Node.js 22 LTS image on Alpine Linux. No alternative considered per locked decision.

---

## Architecture Patterns

### System Architecture — Phase 4 Write Flow

```
src/index.ts (main loop)
    │
    ├── [existing] loadConfig() → validateStages() → fetchCandidates()
    │
    └── For each candidate:
         │
         ├── fetchApplicationDetails() → evaluateHardRules()
         │
         ├── [hard-rule fail] ─── assemble hard-rule comment ─────────────────┐
         │                                                                      │
         ├── [pass] buildCandidateContext() ─────────────────────────────────  │
         │          │                                                           │
         │   [CR-01 fix] if (dryRun) → emit DRY_RUN log record (no API call)  │
         │          │                                                           │
         │   [live] evaluateSoftRules() → logEvaluation(evalResult)            │
         │          │                                                           │
         │          └─── assemble eval comment ─────────────────────────────── │
         │                                                                      ↓
         │                                                   if (!dryRun):
         │                                                   1. client.postComment(applicationId, comment)
         │                                                   2. [only if step 1 succeeds]
         │                                                      client.moveStage(applicationId, stageId)
         │                                                   [if either throws] → counted as error
         │
         └── [end of loop] console.log(JSON.stringify(summary))   ← INFRA-03
```

### Recommended Project Structure After Phase 4

```
/ (project root)
├── src/
│   ├── bamboohr/
│   │   ├── client.ts      # Add: postComment(), moveStage()
│   │   └── types.ts
│   ├── index.ts           # Add: write guard, CR-01 fix, INFRA-03 summary
│   └── ...
├── Dockerfile             # NEW — multi-stage node:22-alpine build
├── .dockerignore          # NEW
├── README.md              # NEW — Docker build/run + crontab instructions
└── ...
```

### Pattern 1: BambooHRClient POST Method (for moveStage and postComment)

The existing `get<T>()` method handles authenticated GETs. Phase 4 adds a `post<T>()` counterpart. All write methods use `applicationId` (not `applicantId`).

```typescript
// src/bamboohr/client.ts — add alongside existing get()
// [ASSUMED] — pattern inferred from existing get() structure; no official TypeScript example available
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

### Pattern 2: Comment-Then-Move Write Block (atomicity, D-03/D-04)

```typescript
// src/index.ts — after logEvaluation(evalResult) or logDecision() for hard-rule fails
// [ASSUMED] — pattern derived from D-03/D-04 decisions in CONTEXT.md
if (!dryRun) {
  const targetStageName =
    evalResult.outcome === 'pass'
      ? config.job.stages.pass
      : config.job.stages.fail;
  const targetStageId = stageMap.get(targetStageName);
  if (targetStageId === undefined) {
    throw new Error(`Stage "${targetStageName}" not in stageMap — this should not happen`);
  }
  // Step 1: comment first (D-03)
  await client.postComment(evalResult.applicationId, evalResult.comment);
  // Step 2: move only if comment succeeded (D-03)
  await client.moveStage(evalResult.applicationId, targetStageId);
}
```

Both `postComment` and `moveStage` throw on HTTP error. The outer per-candidate `try/catch` in `index.ts` catches the throw, logs `outcome: 'error'`, and increments `errors` — leaving the candidate in intake for the next cron run (D-03).

### Pattern 3: CR-01 Fix — Dry-Run Guard for OpenAI Calls

```typescript
// src/index.ts — replaces the unconditional evaluateSoftRules() call on line 128
// [CITED: 03-REVIEW.md CR-01 fix recommendation]
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

### Pattern 4: INFRA-03 Summary Line

```typescript
// src/index.ts — replaces console.error on line 169
// Change from:
console.error(
  `[main] Done. processed=${processed} pass=${passed} fail=${failed} needsReview=${needsReview} errors=${errors}`,
);
// Change to:
console.log(JSON.stringify({ processed, pass: passed, fail: failed, needsReview, errors }));
```

The human-readable stderr log line (if still wanted for operator visibility) can remain as a separate `console.error` immediately before the JSON summary line.

### Pattern 5: Hard-Rule Fail Comment Assembly (D-05)

Hard-rule fails have a `CandidateDecision.reasons[]` array (from `evaluateHardRules()`). The comment must be assembled from this array in the write path — not in the rules evaluator (per CONTEXT.md Specifics).

```typescript
// [ASSUMED] — format derived from D-05 and CONTEXT.md Specifics section
function buildHardRuleComment(reasons: string[]): string {
  const bulletList = reasons.map((r) => `• ${r}`).join('\n');
  return [
    `FAIL — Hard rules`,
    bulletList,
    '[Auto-screened by AI — final decision rests with recruiter]',
  ].join('\n\n');
}
```

### Pattern 6: Multi-Stage Dockerfile

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

# Non-root user for security
RUN addgroup -S screener && adduser -S screener -G screener

COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
RUN npm ci --omit=dev

USER screener

ENTRYPOINT ["node", "dist/index.js"]
```

**Notes:**
- `ENTRYPOINT` (exec form) is correct for short-lived batch containers — process runs as PID 1, receives SIGTERM from `docker stop` cleanly. `[CITED: docs.docker.com/build/building/best-practices/]`
- No `EXPOSE` needed — this container makes outbound HTTP calls, not inbound.
- No `HEALTHCHECK` — short-lived container, health is exit code 0/1.
- No `CMD` — the container has a single execution path with no argument overrides needed.
- `npm ci --omit=dev` in production stage ensures no devDependencies in final image.
- `COPY package*.json` copies both `package.json` and `package-lock.json` for reproducible installs.

**Why multi-stage over single-stage:** Single-stage would ship TypeScript compiler, tsx, and all devDependencies into the production image — roughly 3x larger and includes build tools with no runtime value. Multi-stage is the standard pattern. `[CITED: oneuptime.com/blog/post/2026-01-06-nodejs-multi-stage-dockerfile/view]`

### Pattern 7: .dockerignore

```
node_modules/
dist/
.env
.env.*
!.env.example
.git/
*.md
.planning/
tsconfig.json
.dockerignore
Dockerfile
```

Key points:
- `node_modules/` — rebuilt inside Docker via `npm ci`; including it from host causes layer bloat and potential platform mismatch (macOS vs Alpine)
- `.env` / `.env.*` — never in image (secrets stay in `--env-file` on host, per D-06)
- `dist/` — rebuilt inside Docker; stale host dist is irrelevant and avoids confusion
- `.planning/` — no runtime value

### Pattern 8: Crontab Entry (INFRA-04, D-06, D-07, D-08)

```
# Run BambooHR candidate screener daily at 08:00
0 8 * * * docker run --rm \
  --env-file /etc/screener.env \
  -v /path/to/config.yaml:/app/config.yaml:ro \
  bamboohr-screener:latest >> /var/log/screener.log 2>&1
```

On macOS, use `crontab -e` to install. The `--env-file` points to a file on the host containing:
```
BAMBOOHR_API_KEY=...
BAMBOOHR_SUBDOMAIN=...
OPENAI_API_KEY=...
LIVE_MODE=true
CONFIG_PATH=/app/config.yaml
```

The `.env.example` file in the repo serves as the template for this secrets file.

**Linux deployment note:** The identical `docker run` command works on any Linux host with Docker installed. The only differences: cron syntax may vary (use `crontab -e` or `/etc/cron.d/screener`), and the env-file path should match the server's layout (e.g., `/etc/screener.env`).

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HTTP POST with auth | Custom fetch wrapper | Extend existing `BambooHRClient` with a private `post<T>()` method | Client already handles auth header, error pattern, and base URL |
| Stage ID resolution | Extra API call | `stageMap` from existing `validateStages()` | stageMap already built at startup; second API call is unnecessary |
| Comment formatting | New formatting module | Inline string assembly from existing `reasons[]` / `comment` fields | The data is already in the right shape from Phase 2/3 types |
| Docker layer caching | Manual cache logic | `COPY package*.json ./` before `COPY . .` | Standard Dockerfile pattern: package files change less often than source |
| Secret injection | ENV directives in Dockerfile | `--env-file` at docker run time | ENV in Dockerfile bakes secrets into the image layer (D-06) |

---

## Common Pitfalls

### Pitfall 1: Writing to BambooHR in dry-run mode
**What goes wrong:** The write-guard `if (!dryRun)` is missing or placed incorrectly, causing live BambooHR writes during dry-run operations.
**Why it happens:** `dryRun` is already declared in `index.ts` but was never used for the BambooHR write path (same pattern as CR-01 — the flag was only used for logging).
**How to avoid:** The `dryRun` variable at line 37 of `index.ts` must gate ALL external writes: both BambooHR stage/comment calls AND the OpenAI evaluateSoftRules call (CR-01 fix). A single `if (!dryRun)` block wrapping both write operations is correct.
**Warning signs:** Log output showing BambooHR API calls even when `LIVE_MODE` is not set; OpenAI credits consumed during dry-run invocations.

### Pitfall 2: Using `applicantId` instead of `applicationId` for write calls
**What goes wrong:** `client.postComment(detail.applicant.id, ...)` instead of `client.postComment(detail.id, ...)` — or using the wrong field from `EvaluationResult`.
**Why it happens:** Both IDs are present in the data structures. The comment/stage endpoints require `applicationId` (the top-level `detail.id` or `evalResult.applicationId`).
**How to avoid:** `EvaluationResult.applicationId` is the correct field (explicitly documented in `types.ts`). For hard-rule fails, use `detail.id` (the application ID from `BambooHRApplication`). Never use `detail.applicant.id` for write operations.
**Warning signs:** HTTP 404 from the write endpoints (wrong entity ID).

### Pitfall 3: Comment-then-move order violated
**What goes wrong:** `moveStage()` is called before `postComment()`, leaving candidates in the moved stage with no comment.
**Why it happens:** Move is the "visible" action; comment can feel like a follow-up detail.
**How to avoid:** Always `postComment` first, then `moveStage`. Both calls are in the same `if (!dryRun)` block; ordering is explicit in the code (D-03).
**Warning signs:** Candidates appearing in the correct stage in BambooHR but with no comment.

### Pitfall 4: node_modules from host copied into Docker layer
**What goes wrong:** `.dockerignore` missing or not including `node_modules/`, causing the macOS `node_modules` to be copied into the Alpine build layer.
**Why it happens:** `COPY . .` in Dockerfile copies everything unless `.dockerignore` excludes it.
**How to avoid:** Always put `node_modules/` in `.dockerignore`. `npm ci` inside Docker installs Alpine-compatible binaries.
**Warning signs:** `docker build` succeeds but `docker run` fails with `Exec format error` or native module errors; image is much larger than expected (~600MB+ instead of ~200MB).

### Pitfall 5: Secrets in Docker image layers
**What goes wrong:** `.env` file not in `.dockerignore`, baking API keys into the image.
**Why it happens:** `COPY . .` copies `.env` if it exists in the project root.
**How to avoid:** `.dockerignore` must include `.env` and `.env.*` (except `.env.example`). Use `--env-file` at `docker run` time (D-06).
**Warning signs:** `docker history` shows environment variables; image pushed to a registry exposes credentials.

### Pitfall 6: INFRA-03 summary emitted to stderr instead of stdout
**What goes wrong:** Cron health monitoring (which reads stdout) cannot see the summary JSON if it goes to stderr.
**Why it happens:** The existing `console.error` call (line 169, `index.ts`) goes to stderr. The change to `console.log` is required per INFRA-03.
**How to avoid:** Replace the existing `console.error` string summary with `console.log(JSON.stringify({...}))`. Diagnostic/mode messages remain on `console.error`.

### Pitfall 7: Hard-rule fails silently bypass the write path
**What goes wrong:** Candidates failing hard rules are logged but not written to BambooHR in LIVE_MODE, leaving them in the intake stage indefinitely.
**Why it happens:** The hard-rule fail branch in `index.ts` (the `else` block at line 140) calls `logDecision` but has no write guard. The existing code deferred all writes to Phase 4, but only the soft-eval pass branch may get a write guard if the hard-rule fail path is forgotten.
**How to avoid:** Both branches (soft-eval outcome AND hard-rule fail) must have a `if (!dryRun)` write block. D-05 explicitly requires hard-rule fails to trigger writes.

---

## CR Gap Closure (Phase 3 Carryover)

### CR-01: Dry-run guard for OpenAI calls — FOLD INTO PLAN 1

**Current state:** `evaluateSoftRules()` is called unconditionally in `src/index.ts:128`. The `dryRun` variable (line 37) is never used after the startup log message.

**Fix:** Add a `dryRun` branch before `evaluateSoftRules()` that emits a deterministic `EvaluationResult` without making any API call. See Pattern 3 above for exact code.

**Why fold into Plan 1:** The same `if (!dryRun)` guard pattern is being applied to the BambooHR write calls. Fixing both in the same plan keeps the dryRun contract consistent and avoids a fragmented implementation where the BambooHR writes are guarded but OpenAI is not.

### CR-02 and CR-03: DEFERRED (per user decision in CONTEXT.md)

CR-02 (EvaluationOutputSchema allows `needsReview` from model) and CR-03 (OPENAI_API_KEY not validated at startup) are lower priority and excluded from Phase 4 per user decision.

---

## Code Examples

### Complete postComment + moveStage integration in index.ts

```typescript
// After logEvaluation(evalResult) in the soft-eval pass branch:
// [ASSUMED] — pattern derived from CONTEXT.md decisions D-03/D-04

if (!dryRun) {
  const targetStageName =
    evalResult.outcome === 'pass'
      ? config.job.stages.pass
      : config.job.stages.fail;  // fail and needsReview both go to "fail" stage (D-01)
  const targetStageId = stageMap.get(targetStageName);
  if (targetStageId === undefined) {
    throw new Error(
      `[write] Target stage "${targetStageName}" not found in stageMap`,
    );
  }
  // D-03: comment FIRST, then move
  await client.postComment(evalResult.applicationId, evalResult.comment);
  await client.moveStage(evalResult.applicationId, targetStageId);
}
```

### Hard-rule fail write path (D-05)

```typescript
// After logDecision() for the hard-rule fail branch in index.ts:
// [ASSUMED] — derives from D-05; comment assembled from result.reasons

if (!dryRun) {
  const hardRuleComment = [
    'FAIL — Hard rules',
    result.reasons.map((r) => `• ${r}`).join('\n'),
    '[Auto-screened by AI — final decision rests with recruiter]',
  ].join('\n\n');

  const failStageId = stageMap.get(config.job.stages.fail);
  if (failStageId === undefined) {
    throw new Error(`[write] Fail stage not found in stageMap`);
  }
  await client.postComment(detail.id, hardRuleComment);
  await client.moveStage(detail.id, failStageId);
}
```

### needsReview comment assembly (D-02)

```typescript
// For needsReview path (CV extraction failure or soft-eval failure):
// [ASSUMED] — format from D-02 in CONTEXT.md

function buildNeedsReviewComment(reason: string): string {
  return [
    'NEEDS REVIEW — Automated screening incomplete',
    reason,
    '[Auto-screened by AI — final decision rests with recruiter]',
  ].join('\n\n');
}
```

---

## State of the Art

| Old Approach | Current Approach | Impact |
|--------------|------------------|--------|
| Single-stage Dockerfile | Multi-stage (builder + runtime) | 60–70% smaller image; no build tools in production |
| `CMD ["node", ...]` for short-lived containers | `ENTRYPOINT ["node", ...]` exec form | Process is PID 1, receives SIGTERM correctly |
| Inline `-e KEY=value` in docker run | `--env-file` with host-side file | Secrets never appear in shell history or cron logs |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `POST /applicant_tracking/applications/{applicationId}/status` body field is `status` (integer, not `statusId`) | BambooHR Write APIs / BAMB-02 | Wrong field name causes HTTP 400; fix is one-character change in `moveStage()` body |
| A2 | `POST /applicant_tracking/applications/{applicationId}/comments` body is `{ "type": "comment", "comment": "<text>" }` | BambooHR Write APIs / BAMB-03 | Wrong body structure causes HTTP 400; confirmed from multiple independent sources so risk is low |
| A3 | Non-root user `addgroup -S screener && adduser -S screener -G screener` pattern works in node:22-alpine | Dockerfile pattern | Alpine uses `addgroup`/`adduser` (BusyBox), not `groupadd`/`useradd` (GNU). Pattern matches Alpine standard. |
| A4 | `private post<T>()` method is the right factoring vs a top-level module-level function | Code Examples | Implementation detail; either approach works. Planner chooses based on code style consistency with `get<T>()`. |
| A5 | Hard-rule fail comment string is assembled in the write path (index.ts), not in `evaluateHardRules()` | Pattern 5 | Per CONTEXT.md Specifics section — explicitly stated. Low risk. |

**Note on A1 and A2:** The official BambooHR documentation pages for these endpoints returned HTTP 404 when fetched directly by the tool. The body shapes were determined via: (A1) a successful WebFetch of `documentation.bamboohr.com/reference/update-applicant-status` which returned `status: integer`; (A2) multiple independent search result excerpts quoting the official `post-application-comment` docs showing `{ type, comment }`. Both are tagged MEDIUM confidence.

---

## Open Questions (RESOLVED)

1. **INFRA-03: Keep or remove the human-readable stderr summary line?** *(RESOLVED in Plan 04-01 Task 2)*
   - What we know: Current line 169 is `console.error('[main] Done. processed=...')`. INFRA-03 requires a JSON summary on stdout. CONTEXT.md says replace — not add alongside.
   - What's unclear: Whether operators want both (human-readable stderr + machine-readable stdout) or just the JSON stdout line.
   - Recommendation: Keep the human-readable `console.error` line AND add the JSON `console.log` line. No information is lost; the JSON line satisfies INFRA-03. The planner can confirm with the user if the `console.error` line should be removed.
   - **Resolution:** Plan 04-01 Task 2 keeps the `console.error` line and adds `console.log(JSON.stringify({ processed, pass: passed, fail: failed, needsReview, errors }))` immediately after.

2. **Field name `pass` vs `passed` in INFRA-03 summary object?** *(RESOLVED in Plan 04-01 Task 2)*
   - What we know: INFRA-03 spec says `{processed, pass, fail, needsReview, errors}`. Current variable in `index.ts` is `passed` (line 72), not `pass`. The CONTEXT.md discretion item says `console.log(JSON.stringify({processed, pass, fail, needsReview, errors}))`.
   - What's unclear: Whether the JSON key should be `pass` (matching INFRA-03 spec) or `passed` (matching the local variable name).
   - Recommendation: Use `pass` as the JSON key to match the spec: `{ processed, pass: passed, fail: failed, needsReview, errors }`. The variable rename can be optional.
   - **Resolution:** Plan 04-01 Task 2 uses `{ processed, pass: passed, fail: failed, needsReview, errors }` — JSON key `pass` matches INFRA-03 spec; maps from local variable `passed`.

3. **BambooHR write API permission requirement** *(RESOLVED in Plan 04-03 Task 1)*
   - What we know: Both write endpoints require "the owner of the API key used must have access to ATS settings."
   - What's unclear: Whether the existing API key used for Phase 1–3 reads has this permission level.
   - Recommendation: Document in the README that the API key must have ATS settings access. This is a configuration step for the user, not a code task.
   - **Resolution:** Plan 04-03 Task 1 README includes an "API Key Permissions" section under Operating Notes documenting that the API key must have ATS settings access.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Docker CLI | INFRA-01 build/run | ✓ | 28.0.4 | — |
| Docker daemon | INFRA-01 `docker build` | ✗ (not running) | — | Start Docker Desktop before running build commands |
| Node.js | TypeScript build / `npm run build` | ✓ | v14.21.3 (host) | Note: container uses node:22-alpine; host Node version doesn't affect Docker build |
| npm | Dependency management | ✓ (via node) | — | — |

**Missing dependencies with no fallback:**
- Docker Desktop daemon must be running to execute `docker build` and `docker run` commands. Client is installed; daemon just needs to be started.

**Note on host Node.js version:** The host has Node v14.21.3 which cannot run `npm run dev` (project requires Node ≥22). This is not a Phase 4 blocker — Phase 4 deliverables are Docker-based. All TypeScript changes are compiled inside Docker during `docker build`.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | No new auth flows added |
| V3 Session Management | No | Stateless container |
| V4 Access Control | No | Single-purpose tool; no multi-user access |
| V5 Input Validation | Partial | Comment text is assembled from pre-validated data (reasons[], evalResult.comment); no raw user input reaches the write APIs |
| V6 Cryptography | No | No new crypto; API key already handled by existing Basic auth pattern |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Secret leakage via Docker image | Information Disclosure | `--env-file` on host (D-06); `.env` in `.dockerignore` |
| Secret leakage via shell history | Information Disclosure | `--env-file` instead of `-e KEY=value` in crontab (D-06) |
| BambooHR credential exposure in logs | Information Disclosure | Existing pattern: credentials never logged (only mode and stage names) |
| Candidate CV data persisted in image | Information Disclosure | No disk writes; CV text flows only through memory during processing (GDPR) |

### Compliance Note (pre-deployment)

Per REQUIREMENTS.md Compliance Note — before enabling `LIVE_MODE=true` against real candidates:
1. Signed DPA with OpenAI (GDPR — CV personal data sent to OpenAI for soft evaluation)
2. Candidate consent disclosure on job application form

This is a legal requirement, not a code task. Cannot be resolved in Phase 4 implementation.

---

## Sources

### Primary (HIGH confidence)
- `documentation.bamboohr.com/docs/getting-started` — base URL format confirmed: `{companyDomain}.bamboohr.com/api/v1`
- `documentation.bamboohr.com/reference/update-applicant-status` — stage transition endpoint path and `status` integer body field (WebFetch succeeded)
- `docs.docker.com/build/building/best-practices/` — ENTRYPOINT exec form for PID 1 signal handling
- `src/bamboohr/client.ts`, `src/index.ts`, `src/agent/types.ts`, `src/rules/types.ts`, `src/logger/logger.ts` — existing codebase (read directly)
- `.planning/phases/03-agent-evaluation/03-REVIEW.md` — CR-01 fix specification (read directly)

### Secondary (MEDIUM confidence)
- `documentation.bamboohr.com/reference/post-application-comment` — comment endpoint body `{ type, comment }` — multiple search result excerpts quoting this page consistently
- `oneuptime.com/blog/post/2026-01-06-nodejs-multi-stage-dockerfile/view` — multi-stage Dockerfile pattern for Node.js Alpine

### Tertiary (LOW confidence)
- Various search result excerpts referencing BambooHR comment and status endpoints (cross-verified against the official docs WebFetch above)

---

## Metadata

**Confidence breakdown:**
- BambooHR write API (BAMB-02/03): MEDIUM — endpoint paths and body shapes confirmed from official docs and multiple cross-references, but direct HTML page fetch returned 404 for comment endpoint
- Docker/Alpine pattern: HIGH — confirmed from official Docker docs and current multi-stage articles
- Code patterns (CR-01 fix, write guard, summary): HIGH — derived directly from existing codebase + CONTEXT.md decisions
- Environment availability: HIGH — tools verified via Bash

**Research date:** 2026-05-02
**Valid until:** 2026-06-01 (BambooHR API paths are stable; Docker patterns are stable)
