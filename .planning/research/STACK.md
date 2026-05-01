# Stack Research

**Domain:** Automated HR candidate screening agent
**Researched:** 2026-05-01
**Confidence:** MEDIUM — all findings from training data (cutoff Aug 2025); Bash/WebSearch/WebFetch tools were unavailable during this research session. Version numbers must be validated against npm/official docs before pinning in package.json.

---

## Recommended Stack

### Core Technologies

| Technology | Version | Purpose | Why Recommended |
|------------|---------|---------|-----------------|
| Node.js | 22 LTS | Runtime | Active LTS as of 2025; native fetch built-in eliminates `node-fetch` dependency; V8 improvements for async throughput; matches Docker `node:22-alpine` base image |
| TypeScript | ~5.5 | Type safety across all code | Strict null checks catch BambooHR API shape mismatches early; satisfies operator avoids unsafe casts when shaping raw API responses; project constraint |
| `@openai/agents` | latest 0.x | OpenAI Agents SDK — agent loop, tool use, tracing | Official SDK from OpenAI for building tool-using agents in TypeScript; provides `Agent`, `Runner`, `tool()` primitives without needing to hand-wire function-call loop; released March 2025 |
| `openai` | ^4.x | Underlying OpenAI API client | `@openai/agents` depends on this; also useful for direct completions if needed outside the agent loop |

**CONFIDENCE NOTE on `@openai/agents` version:** LOW — package was at `0.x` pre-release as of my training data. Verify current version on npmjs.com before locking.

### Supporting Libraries

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pdf-parse` | ^1.1.1 | PDF text extraction | Parsing candidate CV PDFs downloaded from BambooHR; pure JS, no native binary dependencies (critical for Alpine Docker); handles multi-page PDFs common in resumes |
| `js-yaml` | ^4.1.0 | YAML config parsing | Parsing the mounted `config.yaml` with job ID, pipeline stage IDs, and screening rules; v4 is the current stable series with ESM support |
| `zod` | ^3.x | Runtime schema validation | Validating BambooHR API responses and YAML config against expected shapes; prevents silent failures when API returns unexpected structure; pairs naturally with TypeScript |
| `node-fetch` | NOT needed | — | Node 22 has built-in `fetch`; do not add this dependency |
| `axios` | NOT needed | HTTP client | Built-in fetch is sufficient; adds unnecessary bundle weight |
| `winston` | optional | Structured JSON logging | If structured log middleware is needed; for this project, `console.log(JSON.stringify(...))` to stdout is sufficient and simpler for a short-lived container |

**CONFIDENCE on `pdf-parse`:** MEDIUM — `pdf-parse@1.1.1` is the dominant zero-native-dep option for Node.js PDF text extraction as of Aug 2025. The library is stable but not actively maintained; see Pitfalls section for known quirks.

### Development Tools

| Tool | Purpose | Notes |
|------|---------|-------|
| `tsx` | TypeScript execution without separate compile step | Use for development: `npx tsx src/index.ts`; avoids `ts-node` ESM config pain |
| `esbuild` or `tsc` | Production build | `tsc` for straightforward projects; output to `dist/`; Docker runs compiled JS |
| Docker `node:22-alpine` | Container base image | Alpine keeps image under 200MB; matches Node 22 LTS runtime |
| `@types/node` | Node.js type definitions | Required for `Buffer`, `process.env`, `fs` typings |
| `@types/js-yaml` | YAML library typings | Included in `js-yaml` v4 package itself; no separate install |
| `@types/pdf-parse` | pdf-parse typings | May need `@types/pdf-parse` from DefinitelyTyped |

---

## OpenAI Agents SDK — Key Patterns

**CONFIDENCE: MEDIUM** — based on training data from SDK release docs (March 2025).

### Agent Definition

```typescript
import { Agent, tool, Runner } from "@openai/agents";
import { z } from "zod";

const fetchCandidatesTool = tool({
  name: "fetch_new_candidates",
  description: "Fetch candidates in New stage for the configured job opening",
  parameters: z.object({ jobId: z.string() }),
  execute: async ({ jobId }) => {
    // BambooHR API call here
  },
});

const screenerAgent = new Agent({
  name: "CandidateScreener",
  model: "gpt-4o",
  instructions: "You screen HR candidates against provided criteria...",
  tools: [fetchCandidatesTool, moveCandidateTool, addCommentTool],
});
```

### Runner (agent loop)

```typescript
const result = await Runner.run(screenerAgent, "Screen all new candidates for job X");
```

`Runner.run()` drives the full tool-call loop: model returns tool calls, SDK executes them, feeds results back, repeats until model returns a final text response or `max_turns` is hit.

### Tool pattern for BambooHR calls

Each BambooHR operation becomes a `tool()` with a Zod schema for parameters. The agent decides which tools to invoke and in what order. Tools should be narrow and single-purpose (fetch list, move stage, add comment) so the model has precise control.

---

## BambooHR API — Key Endpoints

**CONFIDENCE: MEDIUM** — based on BambooHR ATS API documentation as of training data. Endpoint paths should be verified against https://documentation.bamboohr.com/reference before implementation.

### Authentication

BambooHR uses HTTP Basic Auth with an API key:

```
Authorization: Basic base64(API_KEY:x)
```

The password is always the literal string `x`. The API key is passed as the username. Base URL pattern: `https://api.bamboohr.com/api/gateway.php/{company_domain}/v1/`

### Relevant ATS Endpoints

| Operation | Method | Path | Notes |
|-----------|--------|------|-------|
| List job openings | GET | `/applicant_tracking/jobs` | Returns all job postings; filter by status |
| Get applicants for job | GET | `/applicant_tracking/jobs/{jobId}/applicants` | Returns candidates; filter by `status` = "New" |
| Get applicant detail | GET | `/applicant_tracking/applicants/{applicantId}` | Full applicant record including application answers |
| Get applicant's files | GET | `/applicant_tracking/applicants/{applicantId}/files` | Lists file attachments including CV |
| Download file | GET | `/applicant_tracking/applicants/{applicantId}/files/{fileId}` | Returns binary PDF |
| Move pipeline stage | POST | `/applicant_tracking/applications/{applicationId}/status` | Body: `{ "status": "stage_name_or_id" }` |
| Add comment | POST | `/applicant_tracking/applications/{applicationId}/comments` | Body: `{ "comment": "..." }` |

**CRITICAL UNCERTAINTY:** BambooHR's ATS API has two variants — the legacy "Applicant Tracking" (older) and a newer "Hiring" API. The exact endpoint paths and how to reference pipeline stages (by name vs. numeric ID) differ between them. The YAML config should store stage IDs as opaque values discovered at setup time (list stages endpoint) rather than hardcoding names. This must be verified against current BambooHR API docs before implementation.

**Listing pipeline stages for a job:**

`GET /applicant_tracking/jobs/{jobId}` typically returns available stages/statuses. Stage IDs should be pulled once at setup and stored in config.yaml.

### Rate Limits

BambooHR enforces a rate limit of ~150 API requests per 15-minute window per API key. For a daily screening run over a single job, this is not a concern. No retry logic needed for MVP, but tool execution should log HTTP status on failure.

---

## PDF Extraction — `pdf-parse`

**CONFIDENCE: MEDIUM**

```typescript
import pdfParse from "pdf-parse";
import fs from "fs";

const dataBuffer = fs.readFileSync("resume.pdf");
const data = await pdfParse(dataBuffer);
const text = data.text; // full text content
```

For in-memory buffers downloaded from BambooHR (no temp file write):

```typescript
const response = await fetch(attachmentUrl, { headers: authHeaders });
const arrayBuffer = await response.arrayBuffer();
const buffer = Buffer.from(arrayBuffer);
const { text } = await pdfParse(buffer);
```

**Known quirk:** `pdf-parse` has a test-mode detection check that can fire unexpectedly when the module is loaded in some test environments (it reads `test/data/05-versions-space.pdf` on import in test mode). This is a non-issue in production Docker runs but can cause confusing errors in Jest. Use `pdf-parse/lib/pdf-parse.js` direct import or mock the module in tests.

---

## YAML Config Parsing — `js-yaml`

**CONFIDENCE: HIGH** — `js-yaml` v4 is the established standard; API is stable.

```typescript
import yaml from "js-yaml";
import fs from "fs";

interface ScreeningConfig {
  bamboohr: {
    jobId: string;
    stageIds: {
      newApplicant: string;
      schedulePhoneScreen: string;
      reviewed: string;
    };
  };
  rules: {
    hardRules: HardRule[];
    softRules: string[];
  };
}

const raw = fs.readFileSync("/config/config.yaml", "utf8");
const config = yaml.load(raw) as ScreeningConfig;
```

Validate the loaded object with Zod immediately after parsing to catch misconfigured YAML before the agent loop starts.

---

## Docker Setup

**CONFIDENCE: HIGH** — patterns are stable and well-established.

### Dockerfile

```dockerfile
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY tsconfig.json ./
COPY src ./src
RUN npx tsc --outDir dist

FROM node:22-alpine AS runtime
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
# Config mounted at runtime via -v flag; not baked in
CMD ["node", "dist/index.js"]
```

### Docker run command (for crontab)

```bash
docker run --rm \
  -e BAMBOOHR_API_KEY=... \
  -e BAMBOOHR_COMPANY_DOMAIN=... \
  -e OPENAI_API_KEY=... \
  -v /path/to/config.yaml:/config/config.yaml:ro \
  bamboohr-screener:latest
```

`--rm` ensures the container is deleted after exit (short-lived pattern). Config is mounted read-only.

### macOS crontab entry

```
0 8 * * 1-5 /usr/local/bin/docker run --rm -e BAMBOOHR_API_KEY=... [rest of command] >> /var/log/screener.log 2>&1
```

Use full Docker path (`/usr/local/bin/docker`) because cron runs with a minimal PATH on macOS. Redirect stdout/stderr to a log file.

---

## Alternatives Considered

| Recommended | Alternative | When to Use Alternative |
|-------------|-------------|-------------------------|
| `@openai/agents` | Plain `openai` SDK with manual function-call loop | If the Agents SDK proves too opaque for debugging, or if the task is simple enough that the agent loop overhead isn't worth it |
| `pdf-parse` | `pdfjs-dist` (Mozilla PDF.js) | If `pdf-parse` fails on heavily formatted or encrypted PDFs; `pdfjs-dist` is more robust but heavier and requires more setup code |
| `pdf-parse` | `pdf2pic` + OCR | If CVs are scanned images embedded in PDFs — pdf-parse extracts only digital text; OCR required for image-based PDFs |
| `js-yaml` | `yaml` (npm package) | Both are fine; `yaml` (by eemeli) has slightly better spec compliance and TypeScript types; either works for this use case |
| `zod` | Manual type assertions | Never use manual `as` casts for external API data — Zod validates at runtime and generates TypeScript types simultaneously |
| Node 22 built-in fetch | `axios` | If complex interceptors, automatic retries, or multipart upload are needed; not needed here |
| `tsx` (dev) | `ts-node` | `ts-node` requires careful ESM/CommonJS configuration in 2025; `tsx` is simpler and faster for scripts |
| External cron + docker run | Node `node-cron` inside a long-running container | External cron is better for this: container stays stateless, no PID management, identical on macOS and Linux server |

---

## What NOT to Use

| Avoid | Why | Use Instead |
|-------|-----|-------------|
| `langchain` / `llamaindex` | Massive dependency tree, frequent breaking changes, abstracts away the Agents SDK primitives; overkill for a single-agent tool-calling loop | `@openai/agents` directly |
| `pdf2json` | Unmaintained, unreliable text extraction order on multi-column layouts | `pdf-parse` |
| `dotenv` for Docker | Env vars should come from `docker run -e` or a secrets manager, not a `.env` file baked in or mounted — security smell | `process.env` directly; validate at startup with Zod |
| `node-schedule` or `node-cron` inside container | Makes the container long-lived; loses the stateless run-and-exit property; harder to deploy to a server | macOS crontab + `docker run --rm` |
| CommonJS (`require()`) | TypeScript 5.x + Node 22 work best with ESM; mixing CJS/ESM in the same project causes hard-to-debug errors | ESM throughout; set `"type": "module"` in package.json |

---

## Version Compatibility

| Package | Compatible With | Notes |
|---------|-----------------|-------|
| `@openai/agents` latest | `openai` ^4.x | `@openai/agents` declares `openai` as a peer dependency; do not install conflicting versions |
| `pdf-parse` ^1.1.1 | Node 18, 20, 22 | Pure JS; no native addons; works in Alpine |
| `js-yaml` ^4.1.0 | Node 14+ | v4 dropped v3's `safeLoad` (now just `load`); do not use v3 API examples from old tutorials |
| `zod` ^3.x | TypeScript ^4.5+ | Zod 3 requires TS 4.5+; no issue with TS 5.x |
| TypeScript ^5.5 | Node 22 | Use `"target": "ES2022"` or higher in tsconfig; enables native async/await without downleveling |

---

## tsconfig.json Baseline

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "outDir": "dist",
    "rootDir": "src",
    "esModuleInterop": true,
    "skipLibCheck": false
  }
}
```

`"module": "NodeNext"` is required for ESM with Node 22. `"noUncheckedIndexedAccess": true` catches array index issues when iterating BambooHR API response arrays.

---

## Sources

- Training knowledge of `@openai/agents` SDK (released March 2025) — MEDIUM confidence; version number requires npm verification
- Training knowledge of BambooHR ATS API documentation — MEDIUM confidence; endpoint paths must be verified at https://documentation.bamboohr.com/reference
- Training knowledge of `pdf-parse`, `js-yaml`, `zod` — HIGH confidence on API; version numbers require npm verification
- Docker multi-stage build patterns for Node.js — HIGH confidence; stable pattern
- macOS crontab + Docker invocation pattern — HIGH confidence; stable pattern

**NOTE:** All external research tools (Bash, WebSearch, WebFetch) were unavailable during this research session. Every version number in this document should be treated as a starting point and validated against npm/official docs before writing package.json. Specifically verify: `@openai/agents` current version, whether BambooHR has a newer Hiring API that supersedes the ATS endpoints documented here, and whether `pdf-parse` still has no active-maintenance successors with better test compatibility.

---
*Stack research for: BambooHR candidate screening agent (TypeScript + OpenAI Agents SDK)*
*Researched: 2026-05-01*
