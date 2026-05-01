# Phase 1: Foundation - Research

**Researched:** 2026-05-01
**Domain:** BambooHR ATS API, TypeScript ESM NodeNext, Zod config validation, hard-rule evaluation
**Confidence:** MEDIUM — BambooHR response field schema unverifiable without live credentials; all structural API info (endpoints, query params, pagination) is HIGH confidence from Crystal wrapper source code and official doc fragments

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Hard rules use named typed fields (`maxSalary`, `requiredFields`, `requiredBoolean`, `requiredKeyword`), not a generic operator list.
- **D-02:** Each rule type carries an explicit human-readable `label` field used verbatim as the rejection reason in log output.
- **D-03:** Rule evaluation is collect-all — every rule is evaluated; all unmet labels accumulated into `reasons[]`. No fail-fast.
- **D-04:** Single flat `config.yaml` with both `job:` section (openingId, stage IDs/names) and `hardRules:` section.
- **D-05:** Phase 1 implements four rule types: salary ceiling, required fields present, boolean/yes-no criteria, location/keyword match.
- **D-06:** Expected salary field origin is UNKNOWN — could be custom application form field or standard BambooHR field. Researcher must verify.
- **D-07:** Boolean and keyword rule fields are a mix of custom application questions and standard BambooHR fields. `fieldMap` section decouples readable names from BambooHR field IDs/paths.
- **D-08:** Config uses human-readable names (e.g., `rightToWork`, `city`). `fieldMap` maps those names to BambooHR API field paths.
- **D-09:** Testing strategy is real BambooHR API with `DRY_RUN=true`. No fixture files needed for Phase 1.
- **D-10:** Project supports a `.env` file for local dev (via `dotenv`) alongside Docker env vars. `.env` in `.gitignore`. Credentials: `BAMBOOHR_API_KEY`, `BAMBOOHR_SUBDOMAIN`, `OPENAI_API_KEY`, `DRY_RUN`, `CONFIG_PATH`.
- **D-11:** Local run command: `npx tsx src/index.ts`. Production uses compiled JS inside Docker.

### Claude's Discretion

- TypeScript project structure within `src/` (suggested: `src/config/`, `src/bamboohr/`, `src/rules/`, `src/logger/`)
- Zod schema design for config validation
- Exact pagination implementation (cursor vs. offset — researcher determines from API variant)
- HTTP client choice: `fetch` (Node 22 built-in) preferred over `axios`/`node-fetch`

### Deferred Ideas (OUT OF SCOPE)

- None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONF-01 | Load YAML config, validate with Zod at startup; fail fast before any API call if invalid | Zod v4 `safeParse` + js-yaml `load()` pattern documented |
| CONF-02 | Cross-reference configured stage IDs against live BambooHR pipeline stages at startup | `GET /v1/applicant_tracking/statuses` endpoint confirmed; returns `{ id, name, ... }` array |
| CONF-03 | Credentials via env vars only (`BAMBOOHR_API_KEY`, `BAMBOOHR_SUBDOMAIN`, etc.) | `dotenv` v17 or Node 22 `--env-file` flag; never in config |
| CONF-04 | Dry-run default (`DRY_RUN=true`); live writes require `LIVE_MODE=true` | Simple env var guard; no write calls in Phase 1 anyway |
| BAMB-01 | Fetch all candidates in "New" stage for configured job opening with full pagination | `GET /v1/applicant_tracking/applications?applicationStatusId=X&jobId=Y&page=N`; `paginationComplete` boolean terminates loop |
| RULE-01 | Evaluate hard rules (salary ceiling, required fields, boolean, keyword) before LLM; collect-all | Deterministic evaluation; field values via `fieldMap` lookup from application detail response |
| SAFE-01 | Per-candidate try/catch; one failure does not abort remaining candidates | Standard `for...of` with inner `try/catch`, log error record, `continue` |
| INFRA-02 | Structured JSON log per candidate: `candidateId`, `outcome`, `reasons`, `timestamp` | `console.log(JSON.stringify({...}))` pattern; no log library needed for Phase 1 |
</phase_requirements>

---

## Summary

Phase 1 establishes the project skeleton: config loading/validation, BambooHR ATS connectivity, hard-rule evaluation, and structured JSON logging — all without touching GPT-4o. The primary technical risk is BambooHR ATS field schema opacity: the official documentation portal requires authentication to view full response schemas, so exact field names for custom application questions (salary, right-to-work, city) cannot be verified from public sources. This is expected and is why `fieldMap` was designed into the config — the implementer will run with `DRY_RUN=true` against real credentials on first run and map actual field paths from the live response.

The BambooHR ATS API uses a straightforward REST design. Endpoints live under `https://{companyDomain}.bamboohr.com/api/v1/applicant_tracking/`. Authentication is Basic auth (API key as username, literal string `"x"` as password). The API defaults to XML; every request must send `Accept: application/json`. Pagination uses a `page` integer query parameter and a `paginationComplete: boolean` field in the response. There is no cursor-based pagination.

The TypeScript project setup is well-understood: `"module": "NodeNext"` in tsconfig + `"type": "module"` in package.json + `.js` extensions on all relative imports. `tsx` handles local dev with zero compile step. Zod v4 `safeParse` gives structured errors for clear startup failure messages.

**Primary recommendation:** Do a first-run exploration script (5 lines) before implementing the full client: call `GET /applicant_tracking/statuses` and `GET /applicant_tracking/applications/{firstId}` with real credentials, log the raw JSON, and paste the actual field names into the `fieldMap` section of `config.yaml`. Then build the type-safe client around real field names. This prevents writing a full evaluator against assumed field paths that diverge from actual API responses.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| YAML config loading + Zod validation | Node.js process (startup) | — | Runs once at startup before any I/O; all synchronous |
| BambooHR API key auth | API / HTTP client | — | API key is a credential; never reaches frontend |
| Fetching candidate list | API / HTTP client | — | BambooHR REST → Node `fetch`; pure I/O |
| Stage ID cross-reference (CONF-02) | API / HTTP client (startup) | — | Fetch live statuses, compare to config |
| Hard rule evaluation | Rules engine (in-process) | — | Pure function; no I/O; deterministic |
| fieldMap resolution | Rules engine (in-process) | — | Maps config names → raw API field paths at evaluation time |
| Structured JSON log output | Logger (stdout) | — | `console.log(JSON.stringify(...))` to stdout; Docker captures |
| Env var credential injection | Docker / OS env | dotenv (.env) | Credentials arrive via env, never via config file |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | 6.0.3 [VERIFIED: npm registry 2026-04-16] | Type safety, compile to JS | Mandated by CLAUDE.md |
| tsx | 4.21.0 [VERIFIED: npm registry] | Run `.ts` files directly during dev | Zero-config, esbuild-powered, respects NodeNext ESM |
| js-yaml | 4.1.1 [VERIFIED: npm registry 2025-11-12] | Parse YAML config file | Specified in CLAUDE.md; zero deps |
| zod | 4.4.1 [VERIFIED: npm registry 2026-04-29] | Runtime schema validation | Specified in CLAUDE.md; TypeScript-first |
| dotenv | 17.4.2 [VERIFIED: npm registry 2026-04-12] | Load `.env` for local dev | Industry standard; D-10 requires `.env` support |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| @tsconfig/node22 | 22.0.5 [VERIFIED: npm registry] | Baseline tsconfig preset for Node 22 | Extend from it to avoid tsconfig boilerplate |
| @types/node | latest | Node.js type definitions | Required for `fs`, `process`, `Buffer` in TypeScript |
| @types/js-yaml | latest | Types for js-yaml | js-yaml ships no built-in types |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| js-yaml | `yaml` (eemeli) | `yaml` has better ESM-native exports but CLAUDE.md locked js-yaml |
| dotenv | Node 22 `--env-file` flag | `--env-file` is native but requires wrapper for `npx tsx` invocation; dotenv is simpler to add to any entry point |
| Node built-in `fetch` | `axios` / `node-fetch` | `fetch` is available in Node 22 with no install; D-11 prefers it |

**Installation:**

```bash
npm install js-yaml zod dotenv
npm install -D typescript tsx @tsconfig/node22 @types/node @types/js-yaml
```

**Version verification:** All versions confirmed against npm registry on 2026-05-01.

---

## Architecture Patterns

### System Architecture Diagram

```
.env / Docker env vars
        │
        ▼
┌─────────────────────┐
│   src/index.ts      │  Entry point
│   (startup checks)  │
└──────────┬──────────┘
           │ readFileSync + yaml.load()
           ▼
┌─────────────────────┐
│  src/config/        │  ConfigLoader
│  loader.ts          │  ─ parse YAML
│                     │  ─ zod.safeParse()
│                     │  ─ exit(1) on error
└──────────┬──────────┘
           │ validated Config object
           ▼
┌─────────────────────┐
│  src/bamboohr/      │  BambooHR client
│  client.ts          │  ─ Basic auth header
│                     │  ─ Accept: application/json
└────────┬────────────┘
         │
    ┌────┴───────────────────────────┐
    │                                │
    ▼                                ▼
GET /statuses                 GET /applications
(startup CONF-02)             ?applicationStatusId=X
                              &jobId=Y&page=N
    │                                │
    │ compare to config              │ paginationComplete loop
    │ exit(1) if mismatch            │
    │                                ▼
    │                    for each application:
    │                    GET /applications/:id
    │                         │
    │                         ▼
    │                  ┌─────────────────┐
    │                  │ src/rules/      │
    │                  │ evaluator.ts    │
    │                  │ ─ fieldMap      │
    │                  │ ─ maxSalary     │
    │                  │ ─ requiredFields│
    │                  │ ─ requiredBool  │
    │                  │ ─ requiredKw    │
    │                  │ collect-all     │
    │                  └────────┬────────┘
    │                           │ { outcome, reasons[] }
    │                           ▼
    │                  ┌─────────────────┐
    └─────────────────▶│ src/logger/     │
                       │ logger.ts       │
                       │ JSON.stringify  │
                       │ → stdout        │
                       └─────────────────┘
```

### Recommended Project Structure

```
src/
├── index.ts            # Entry: load config, run startup checks, iterate candidates
├── config/
│   ├── loader.ts       # yaml.load() + zod.safeParse(); exits on failure
│   ├── schema.ts       # Zod schema definition for Config type
│   └── types.ts        # Config TypeScript interface (derived via z.infer)
├── bamboohr/
│   ├── client.ts       # fetch wrapper with Basic auth + Accept: application/json
│   └── types.ts        # BambooHRApplication, BambooHRStatus interfaces
├── rules/
│   ├── evaluator.ts    # evaluate(config, application) → { outcome, reasons[] }
│   └── types.ts        # RuleResult, HardRuleOutcome interfaces
└── logger/
    └── logger.ts       # logDecision(record: DecisionRecord): void
```

### Pattern 1: Config Loading with Fail-Fast Validation

**What:** Load YAML synchronously at startup, validate with Zod, exit immediately if invalid — before any network call.

**When to use:** Always — this is the CONF-01 requirement.

```typescript
// src/config/loader.ts
// Source: Zod v4 docs (zod.dev/api), js-yaml README
import { readFileSync } from 'node:fs';
import yaml from 'js-yaml';
import { configSchema } from './schema.js';

export function loadConfig(configPath: string) {
  let raw: unknown;
  try {
    raw = yaml.load(readFileSync(configPath, 'utf8'));
  } catch (err) {
    console.error('Failed to read config file:', configPath, err);
    process.exit(1);
  }

  const result = configSchema.safeParse(raw);
  if (!result.success) {
    console.error('Invalid config:', JSON.stringify(result.error.format(), null, 2));
    process.exit(1);
  }
  return result.data;
}
```

### Pattern 2: BambooHR API Client with Node Built-in Fetch

**What:** Thin fetch wrapper that sets auth and JSON headers on every call.

**When to use:** All BambooHR HTTP calls — never build raw fetch calls outside this client.

```typescript
// src/bamboohr/client.ts
// Source: BambooHR API docs (documentation.bamboohr.com/docs/getting-started)
// [CITED: documentation.bamboohr.com/docs/getting-started]

export class BambooHRClient {
  private readonly baseUrl: string;
  private readonly authHeader: string;

  constructor(subdomain: string, apiKey: string) {
    this.baseUrl = `https://${subdomain}.bamboohr.com/api/v1`;
    // Basic auth: apiKey as username, "x" as password [CITED: official docs]
    this.authHeader = 'Basic ' + Buffer.from(`${apiKey}:x`).toString('base64');
  }

  async get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    }
    const res = await fetch(url, {
      headers: {
        Authorization: this.authHeader,
        Accept: 'application/json',  // Required — API defaults to XML
      },
    });
    if (!res.ok) {
      throw new Error(`BambooHR API error ${res.status} on ${path}`);
    }
    return res.json() as Promise<T>;
  }
}
```

### Pattern 3: Paginated Candidate Fetch

**What:** Loop until `paginationComplete: true` using the `page` integer parameter.

**When to use:** BAMB-01 — fetching all candidates in a stage.

```typescript
// Source: Crystal wrapper source (github.com/mdwagner/bamboozled-cr) [CITED]
// Pagination: page integer, paginationComplete boolean in response

async function fetchCandidates(
  client: BambooHRClient,
  jobId: string,
  statusId: string,
): Promise<BambooHRApplication[]> {
  const all: BambooHRApplication[] = [];
  let page = 1;
  while (true) {
    const data = await client.get<ApplicationsResponse>('/applicant_tracking/applications', {
      jobId,
      applicationStatusId: statusId,
      page: String(page),
    });
    all.push(...data.applications);
    if (data.paginationComplete) break;
    page++;
  }
  return all;
}
```

### Pattern 4: Stage ID Cross-Reference (CONF-02)

**What:** At startup, fetch live statuses, compare configured stage names to API names.

**When to use:** Once at startup — must run before candidate loop.

```typescript
// Source: [CITED: bamboozled-cr applicant_tracking.cr — GET /applicant_tracking/statuses]

async function validateStages(client: BambooHRClient, config: Config): Promise<void> {
  const statuses = await client.get<BambooHRStatus[]>('/applicant_tracking/statuses');
  const nameMap = new Map(statuses.map(s => [s.name, s.id]));

  for (const [key, stageName] of Object.entries(config.job.stages)) {
    if (!nameMap.has(stageName)) {
      const known = [...nameMap.keys()].join(', ');
      console.error(`Stage "${stageName}" (${key}) not found in BambooHR. Available: ${known}`);
      process.exit(1);
    }
  }
}
```

### Pattern 5: Per-Candidate Error Isolation (SAFE-01)

**What:** `for...of` with inner `try/catch`; failures emit an error log record and `continue`.

**When to use:** Main candidate processing loop — never `Promise.all` in Phase 1 (sequential is correct for rate-limit safety).

```typescript
// [ASSUMED] Standard Node.js pattern — no external source needed
for (const application of candidates) {
  try {
    const result = evaluateHardRules(config, application);
    logDecision({
      candidateId: application.applicant.id,
      applicationId: application.id,
      outcome: result.outcome,
      reasons: result.reasons,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logDecision({
      candidateId: application?.applicant?.id ?? 'unknown',
      applicationId: application?.id ?? 'unknown',
      outcome: 'error',
      reasons: [err instanceof Error ? err.message : String(err)],
      timestamp: new Date().toISOString(),
    });
    // continue to next candidate
  }
}
```

### Pattern 6: Zod Config Schema

**What:** Zod v4 nested schema matching the D-01/D-05 config shape.

```typescript
// src/config/schema.ts
// Source: [CITED: zod.dev/api]
import { z } from 'zod';

const maxSalaryRuleSchema = z.object({
  value: z.number().positive(),
  label: z.string().min(1),
});

const requiredFieldsRuleSchema = z.object({
  fields: z.array(z.string().min(1)).min(1),
  label: z.string().min(1),
});

const requiredBooleanRuleSchema = z.object({
  field: z.string().min(1),
  expectedValue: z.boolean(),
  label: z.string().min(1),
});

const requiredKeywordRuleSchema = z.object({
  field: z.string().min(1),
  expectedValue: z.string().min(1),
  label: z.string().min(1),
});

export const configSchema = z.object({
  job: z.object({
    openingId: z.string().min(1),
    stages: z.object({
      pass: z.string().min(1),
      fail: z.string().min(1),
    }),
  }),
  hardRules: z.object({
    maxSalary: maxSalaryRuleSchema.optional(),
    requiredFields: requiredFieldsRuleSchema.optional(),
    requiredBoolean: z.array(requiredBooleanRuleSchema).optional(),
    requiredKeyword: z.array(requiredKeywordRuleSchema).optional(),
  }),
  fieldMap: z.record(z.string(), z.string()),
});

export type Config = z.infer<typeof configSchema>;
```

### Pattern 7: Structured JSON Logger

**What:** Single function that emits one JSON line per candidate decision.

```typescript
// src/logger/logger.ts
// [ASSUMED] Standard pattern; no external source
export interface DecisionRecord {
  candidateId: string | number;
  applicationId: string | number;
  outcome: 'pass' | 'fail' | 'error';
  reasons: string[];
  timestamp: string;
  [key: string]: unknown;  // allows downstream phases to extend
}

export function logDecision(record: DecisionRecord): void {
  process.stdout.write(JSON.stringify(record) + '\n');
}
```

### Anti-Patterns to Avoid

- **Fail-fast rule evaluation:** If the first rule fails, stop evaluating. Violates D-03 — all rules must run so the candidate gets a complete list of unmet criteria.
- **Using `applicantId` for writes:** BambooHR stages, comments, and CVs live on the Application entity. Always use `applicationId`. [CITED: CLAUDE.md key constraints]
- **Hardcoding BambooHR field names:** Custom application form field IDs vary per account. Always resolve through `fieldMap` config section. [CITED: getknit.dev — "ATS schema can vary across accounts"]
- **Omitting `Accept: application/json` header:** BambooHR API defaults to XML. Omitting this header causes XML parse failures. [VERIFIED: BambooHR community issue + official docs]
- **Using `.ts` import extensions in source:** NodeNext requires `.js` extensions in relative imports (`import './foo.js'` not `import './foo'`). [CITED: TypeScript ESM Node.js docs]
- **`yaml.safeLoad()` call:** Removed in js-yaml v4. Use `yaml.load()` which is safe by default in v4. [CITED: js-yaml migrate_v3_to_v4.md]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| YAML parsing | Custom string parser | `js-yaml` | Handles multiline, anchors, types, edge cases |
| Schema validation | Manual type checks | `zod` | Type inference, composable schemas, formatted error output |
| TypeScript execution (dev) | Compile step for every run | `tsx` | esbuild-powered, zero config, watches tsconfig |
| Base64 encoding for auth | Hand-rolled base64 | `Buffer.from('key:x').toString('base64')` | Node built-in; zero deps |
| JSON output | Custom serializer | `JSON.stringify` | Handles all types; deterministic for structured logs |

**Key insight:** The only truly custom code in Phase 1 is the hard-rule evaluation logic — everything else maps to well-established primitives.

---

## BambooHR API Reference

### Base URL and Auth

```
Base URL:    https://{BAMBOOHR_SUBDOMAIN}.bamboohr.com/api/v1
Auth:        Basic base64("{API_KEY}:x")
Accept:      application/json   ← required on every request (default is XML)
```

**Note on URL discrepancy:** Third-party guides reference `api.bamboohr.com/api/gateway.php/{domain}/v1/...`. This appears to be a legacy format. Official docs and the Update Status endpoint reference `{domain}.bamboohr.com/api/v1/...`. [CITED: documentation.bamboohr.com — Update Applicant Status endpoint] Use the subdomain format. [VERIFIED: official doc Update Status endpoint]

### ATS Endpoints (Phase 1 relevant)

| Method | Path | Purpose | Key Params |
|--------|------|---------|------------|
| GET | `/applicant_tracking/statuses` | List all pipeline stages | — |
| GET | `/applicant_tracking/applications` | List applications (paginated) | `jobId`, `applicationStatusId`, `page`, `sortBy`, `sortOrder` |
| GET | `/applicant_tracking/applications/:id` | Full application detail | — |

[VERIFIED: Crystal wrapper source github.com/mdwagner/bamboozled-cr/blob/master/src/bamboozled/api/applicant_tracking.cr]

### Pagination

- Query parameter: `page` (integer, 1-based)
- Response field: `paginationComplete` (boolean)
- Loop: increment `page` until `paginationComplete === true`
- Response envelope: `{ applications: [...], paginationComplete: boolean }`

[CITED: bamboozled-cr source — `paginationComplete` field access]

### Stage Cross-Reference Flow (CONF-02)

```
GET /applicant_tracking/statuses
→ [{ id: 123, name: "New", code: "...", description: "...", enabled: true, ... }, ...]

Config stages.pass = "Schedule Phone Screen"
Config stages.fail = "Reviewed"

→ Find matching name in statuses array → get id
→ Any configured name not found → exit(1) with list of available names
```

The statuses response includes: `id`, `name`, `code`, `description`, `enabled`, `manageability`, `translatedName`.
[CITED: BambooHR search result quoting statuses response structure — MEDIUM confidence on exact field names]

### Application Detail Response (MEDIUM confidence — schema not publicly documented)

The `GET /applicant_tracking/applications/:id` response includes:
- Applied date, status, rating
- Resume and cover letter file IDs (separate fetch for binary)
- Applicant info: email, phone, address, education
- Job details
- Questions and answers array (custom application form fields)
- Status history

[CITED: multiple BambooHR integration guide sources — exact field names unverifiable without live credentials]

**Critical unknown:** Where does expected salary live?

Options to check on first real API call:
1. A field in the `questions` array with a label like "Desired Salary" or "Expected Compensation"
2. A top-level field on the application object

**Resolution strategy:** The `fieldMap` in config decouples this. On first run with `DRY_RUN=true`, log the raw application JSON and identify the salary field path. Then set `fieldMap.salary` to that path. No code change required.

### Application List Response Envelope

```typescript
// [ASSUMED] — structure inferred from Crystal wrapper + multiple integration guides
interface ApplicationsResponse {
  applications: BambooHRApplication[];
  paginationComplete: boolean;
}

interface BambooHRApplication {
  id: number;           // applicationId — use for writes (not applicantId)
  applicant: {
    id: number;         // applicantId — for reference/logging only
    firstName: string;
    lastName: string;
    email: string;
  };
  status: {
    id: number;
    label: string;      // e.g., "New"
  };
  // ... questions[], resume file ID, etc. — verify against live response
}
```

[ASSUMED] — field names assumed from integration guide descriptions. Must verify on first `DRY_RUN=true` run.

---

## TypeScript Project Setup

### Minimum tsconfig.json

```json
{
  "extends": "@tsconfig/node22/tsconfig.json",
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

[CITED: TypeScript ESM Node.js docs + community best practices]

### Minimum package.json structure

```json
{
  "type": "module",
  "name": "bamboohr-screener",
  "version": "1.0.0",
  "main": "dist/index.js",
  "scripts": {
    "dev": "tsx src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

`"type": "module"` enables ESM throughout. Required for NodeNext. [CITED: TypeScript ESM Node.js docs]

### ESM Import Rules (NodeNext)

All relative imports MUST use `.js` extension, even for `.ts` source files:

```typescript
// Correct (NodeNext requires .js extension):
import { loadConfig } from './config/loader.js';
import { BambooHRClient } from './bamboohr/client.js';

// Wrong (will fail at runtime with NodeNext):
import { loadConfig } from './config/loader';
```

[CITED: TypeScript docs/handbook/esm-node.html]

### tsx Local Dev

`tsx` is powered by esbuild. It:
- Requires no tsconfig to run
- Respects NodeNext ESM correctly
- Is invoked as `npx tsx src/index.ts`
- Supports `node --env-file=.env` passthrough: `node --env-file=.env $(which tsx) src/index.ts` OR use dotenv in the entry file

[CITED: tsx.is docs]

### dotenv with ESM

Import at the top of `src/index.ts` before any other imports:

```typescript
// src/index.ts — first line
import 'dotenv/config';   // ESM-compatible dotenv auto-config
```

Alternative (Node 22 native, no package needed):
```bash
node --env-file=.env $(which tsx) src/index.ts
# or simply:
tsx --env-file=.env src/index.ts   # tsx passes node flags through
```

[CITED: tsx docs (tsx supports all Node.js CLI flags including --env-file)]

---

## Common Pitfalls

### Pitfall 1: `applicationId` vs `applicantId`

**What goes wrong:** Stage transitions and comment writes use `applicationId` as the path param. Using `applicantId` returns 404 or writes to the wrong entity.

**Why it happens:** BambooHR has two separate IDs — the Applicant (person) and the Application (submission for a job). Writes happen on the Application entity.

**How to avoid:** Always use `application.id` (the application entity ID) in write paths. Log both IDs for debugging but only use `applicationId` for BambooHR API write operations.

**Warning signs:** 404 errors on stage update calls; updates appearing on wrong candidates.

[CITED: CLAUDE.md key constraints]

### Pitfall 2: XML Response (Missing Accept Header)

**What goes wrong:** BambooHR returns XML by default. `JSON.parse()` of XML throws a SyntaxError.

**Why it happens:** The API is XML-first; JSON is opt-in per request.

**How to avoid:** Set `Accept: 'application/json'` on every fetch call in the client. Never set `Accept: '*/*'`.

**Warning signs:** `SyntaxError: Unexpected token '<'` when calling `res.json()`.

[VERIFIED: BambooHR developer forum issue + official docs "JSON is returned when you add Accept: application/json header"]

### Pitfall 3: Missing `.js` Extensions in ESM Imports

**What goes wrong:** TypeScript compiles without error but Node.js throws `ERR_MODULE_NOT_FOUND` at runtime.

**Why it happens:** NodeNext resolution requires explicit extensions. TypeScript accepts the import but emits it verbatim — if you wrote `.ts` or no extension, the emitted JS has the same extensionless import, which Node won't resolve.

**How to avoid:** Write `import './foo.js'` in TypeScript source. With NodeNext, TypeScript maps `.js` → `.ts` for type-checking. It looks wrong but is correct.

**Warning signs:** `Error [ERR_MODULE_NOT_FOUND]: Cannot find module '...' imported from '...'`

[CITED: TypeScript ESM Node.js docs]

### Pitfall 4: `yaml.safeLoad()` Removed in js-yaml v4

**What goes wrong:** `TypeError: yaml.safeLoad is not a function` at startup.

**Why it happens:** js-yaml v3 had `safeLoad`/`safeDump` as the safe variants. In v4, `load()` is safe by default; `safeLoad` was removed.

**How to avoid:** Use `yaml.load(rawString)` — no separate "safe" variant needed.

[CITED: github.com/nodeca/js-yaml/blob/master/migrate_v3_to_v4.md + kubernetes-client/javascript issue #638]

### Pitfall 5: Hardcoded BambooHR Field Names

**What goes wrong:** Field paths in the rule evaluator reference paths that don't exist in this account's API response. All candidates appear to fail every rule, or rules are silently skipped.

**Why it happens:** BambooHR custom application form fields are per-account. The salary field, right-to-work checkbox, and city question all have account-specific IDs or labels.

**How to avoid:** Log the full raw JSON of one real application on first DRY_RUN before writing the evaluator. Map actual paths into `fieldMap` in config.yaml. Use `fieldMap` lookup everywhere — never access `application.somePath` directly in rule code.

**Warning signs:** `undefined` values when evaluating rules; all candidates pass or all fail on a specific rule type.

[CITED: getknit.dev — "BambooHR's ATS schema can vary across accounts"]

### Pitfall 6: Silent Salary Type Mismatch

**What goes wrong:** Salary comparison fails or evaluates incorrectly because the API returns salary as a string (e.g., `"55000"` or `"55,000"`) not a number.

**Why it happens:** API form fields often return strings for all values. Comparing `"55000" > 60000` evaluates to `false` in JS due to coercion to `NaN`.

**How to avoid:** In the `maxSalary` rule evaluator, always `parseFloat(String(raw).replace(/,/g, ''))` before numeric comparison. Log the raw value in the `reasons` output.

**Warning signs:** No candidates ever fail the salary rule regardless of stated salary.

[ASSUMED] — Type handling risk; standard API integration pitfall.

### Pitfall 7: Rate Limiting Without Backoff

**What goes wrong:** BambooHR returns HTTP 403 (repeated invalid API key attempts) or 429 on rapid requests.

**Why it happens:** BambooHR throttles API access, and repeated 403s temporarily disable the key.

**How to avoid:** Phase 1 processes candidates sequentially (not parallel). Keep the `for...of` loop sequential. Add a small `await new Promise(r => setTimeout(r, 100))` between application detail fetches if throttling occurs. Full retry logic is v2 (BAMB-05).

**Warning signs:** Sudden 403 Forbidden responses mid-run; `"Your API key is missing or invalid"` error messages.

[CITED: documentation.bamboohr.com/docs/getting-started — "Repeated invalid API key attempts trigger temporary disablement"]

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `yaml.safeLoad()` | `yaml.load()` (safe by default) | js-yaml v4 (2021) | Remove `safeLoad` calls; `load` is the only needed variant |
| `ts-node` for local dev | `tsx` | 2022-present | tsx is faster (esbuild), zero-config, no separate loader flags |
| `module: "Node16"` | `module: "NodeNext"` | TS 4.7+ | NodeNext auto-adopts future Node module resolution; prefer it |
| dotenv `require()` | `import 'dotenv/config'` | dotenv v16+ | ESM-compatible auto-import pattern |
| `api.bamboohr.com/api/gateway.php/{domain}` | `{domain}.bamboohr.com/api/v1` | Unknown (legacy vs. current) | Official docs now reference subdomain format |

**Deprecated/outdated:**
- `yaml.safeLoad`: Removed in js-yaml v4 — use `yaml.load`
- `ts-node` for ESM: Major friction with NodeNext; use `tsx` instead
- `@types/js-yaml` as a peer dep in older guides: Still needed because js-yaml v4 ships no built-in `.d.ts`

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Runtime | ✓ (system) | v14.21.3 [VERIFIED: local] | Upgrade to 22 LTS for Docker target parity |
| npm | Package manager | ✓ | bundled with Node | — |
| BambooHR account | BAMB-01, CONF-02 | Unknown | — | Dry-run with real credentials required |
| BambooHR API key | Auth | Unknown (user must generate) | — | See BambooHR account settings |

**Note:** Local Node.js is v14.21.3, but Docker target is `node:22-alpine`. Local dev works via `tsx` which handles ESM regardless of Node version; however, some built-in `fetch` behavior and `--env-file` flag require Node 18/20/22. The plan should include either upgrading local Node.js to 22 LTS or accepting that `tsx` + `dotenv/config` handles the local compatibility gap.

**Missing dependencies with no fallback:**
- BambooHR account with API access — required before Phase 1 can be tested at all

**Missing dependencies with fallback:**
- Local Node.js 14 vs. 22 target — `tsx` + dotenv handles compatibility for local dev; Docker ensures 22 in production

---

## Open Questions (DEFERRED TO FIRST RUN — unresolvable without live credentials)

1. **Where does salary live in the BambooHR ATS response?**
   - What we know: Application detail returns "questions and answers" for custom form fields, plus some standard fields (status, rating, resume ID, applicant info)
   - What's unclear: Is salary a top-level field, a named field in a `questions[]` array, or in an "employment" sub-object?
   - Recommendation: On first DRY_RUN, log `JSON.stringify(application, null, 2)` for one candidate and inspect. Then populate `fieldMap.salary` in config. This is by design — D-06 acknowledges this uncertainty.

2. **What is the exact field name for application answers/custom questions?**
   - What we know: The API returns "questions and answers" per the official endpoint description; `requiredBoolean` and `requiredKeyword` rules depend on this
   - What's unclear: Is it `questions[].answer`, `answers[]`, or a flat object?
   - Recommendation: Same first-run inspection as salary. The `fieldMap` abstracts this — once the path is known (`questions.0.answer` or similar), it goes in config, not code.

3. **Are pipeline stage names globally consistent or per-job?**
   - What we know: `GET /applicant_tracking/statuses` returns company-wide statuses per the docs
   - What's unclear: Whether custom pipeline stages (created per job posting) are included, or only global stages
   - Recommendation: Fetch statuses at startup and log them so the user can verify their specific stage names. The CONF-02 check catches any mismatch.

4. **Does the application list response include full applicant data, or require detail fetch per application?**
   - What we know: A list endpoint and a detail endpoint both exist; attachments require separate fetches
   - What's unclear: Whether `questions[]` (needed for rule evaluation) is in the list response or only in the detail response
   - Recommendation: Always call the detail endpoint per application. The list endpoint likely returns summary data only. This makes pagination independent of rule evaluation.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | BambooHR application list response envelope is `{ applications: [...], paginationComplete: boolean }` | Architecture Patterns (Pagination) | Pagination loop does not terminate; or field name is different |
| A2 | Application detail `id` field is the `applicationId` (the one used for writes, not `applicantId`) | BambooHR API Reference | Writes go to wrong entity; violates "applicationId not applicantId" constraint |
| A3 | BambooHR statuses response is a flat array of `{ id, name, ... }` objects | Stage Cross-Reference Flow | CONF-02 validation logic breaks; startup check fails incorrectly |
| A4 | Custom form fields (salary, right-to-work, city) live in a `questions[]` or similar array in the detail response | Open Questions | `fieldMap` paths can't be constructed; rule evaluator can't access values |
| A5 | Salary values come back as strings that require `parseFloat` coercion | Pitfall 6 | Salary rule always passes or always fails for all candidates |
| A6 | `{domain}.bamboohr.com/api/v1/applicant_tracking/` is the correct base path | BambooHR API Reference | All requests 404; legacy `api.bamboohr.com/api/gateway.php/{domain}/v1/` path may be needed |

**Resolution for all A1–A6:** A first-run exploration step with `DRY_RUN=true` against real credentials, logging raw JSON responses, resolves every assumption before writing rule evaluation code. This should be the first task in the plan (before building the full evaluator).

---

## Project Constraints (from CLAUDE.md)

- **Dry-run is default:** `DRY_RUN=true` unless `LIVE_MODE=true` is explicitly set. Phase 1 has no writes, so this is informational for the exit guard added now.
- **Credentials via env vars only:** `BAMBOOHR_API_KEY`, `BAMBOOHR_SUBDOMAIN`, `OPENAI_API_KEY` — never in config files or code.
- **`applicationId` for writes:** Not `applicantId`; stage, comments, CV live on Application entity. Must be enforced in type definitions from day one.
- **Hard rules before LLM:** Phase 1 implements deterministic pre-filter only. No GPT-4o invocation in this phase.
- **ESM NodeNext:** All imports use `.js` extensions. `"module": "NodeNext"` in tsconfig.
- **Node:22-alpine target:** No native npm dependencies. All chosen packages (js-yaml, zod, dotenv, tsx) are pure JavaScript — Alpine compatible.
- **No openai/agents in Phase 1:** Deferred to Phase 3. Do not install in this phase.

---

## Validation Architecture

> `nyquist_validation: false` in `.planning/config.json` — this section is SKIPPED per config.

---

## Security Domain

Phase 1 handles credentials (API keys) and may process personal data (candidate names, emails) from BambooHR. No LLM calls in this phase.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No — no user login | — |
| V3 Session Management | No | — |
| V4 Access Control | No — single-tenant, API key controlled | — |
| V5 Input Validation | Yes — YAML config parsing | Zod schema validation at startup |
| V6 Cryptography | No — API key stored in env var, not encrypted at rest by this code | — |
| V7 Error Handling | Yes | Per-candidate try/catch; no stack traces in production JSON output |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| API key leakage in logs | Information disclosure | Never log `process.env.BAMBOOHR_API_KEY`; log a `[REDACTED]` marker if auth headers are traced |
| YAML injection via config file | Tampering | `yaml.load()` with default schema is safe; do not use `yaml.load(input, { schema: FAILSAFE_SCHEMA })` or custom types |
| Candidate PII in logs | Information disclosure | Log `candidateId` and `applicationId`; do not log full candidate name/email in the `reasons[]` array |

---

## Sources

### Primary (HIGH confidence)

- [BambooHR Authentication docs](https://documentation.bamboohr.com/docs/getting-started) — API key Basic auth format, subdomain URL structure confirmed
- [BambooHR Update Applicant Status](https://documentation.bamboohr.com/reference/update-applicant-status) — Confirmed `{companyDomain}.bamboohr.com/api/v1/applicant_tracking/applications/{applicationId}/status` URL pattern
- [BambooHR Create Job Opening](https://documentation.bamboohr.com/reference/create-job-opening) — Confirmed `/api/v1/applicant_tracking/` path prefix
- [bamboozled-cr Crystal wrapper](https://github.com/mdwagner/bamboozled-cr/blob/master/src/bamboozled/api/applicant_tracking.cr) — All 6 ATS endpoints, query params, `paginationComplete` field, response envelope confirmed
- [Zod v4 docs](https://zod.dev/api) — `z.object()`, `safeParse()`, nested schema, array patterns verified
- npm registry — All package versions verified on 2026-05-01

### Secondary (MEDIUM confidence)

- BambooHR statuses response shape (`id`, `name`, `code`, `description`, `enabled`, `manageability`, `translatedName`) — from BambooHR integration guide search results quoting official docs; confirmed structure but not verified against live response
- `Accept: application/json` requirement — confirmed by BambooHR community issue and docs; XML default confirmed
- Application detail response includes "questions and answers" — from official endpoint description (paraphrased in multiple search results)

### Tertiary (LOW confidence — verify on first run)

- Application response field names (`id`, `applicant.id`, `status.id`, `status.label`) — inferred from integration guides; not confirmed from official schema
- Salary field location (custom `questions[]` vs. top-level field) — unknown; requires live API exploration
- Specific custom form field paths for `rightToWork`, `city` — account-specific, cannot be researched

---

## Metadata

**Confidence breakdown:**
- BambooHR API endpoints and URL structure: HIGH — confirmed from official doc endpoint pages and Crystal wrapper source
- BambooHR response field names: LOW — official schema not publicly accessible without auth; documented as assumptions
- TypeScript NodeNext ESM setup: HIGH — confirmed from TypeScript official docs + community
- Zod v4 schema patterns: HIGH — verified from zod.dev official docs
- js-yaml v4 API: HIGH — v4 migration guide confirms `load()` replaces `safeLoad()`
- Pagination mechanism: MEDIUM — confirmed `paginationComplete` + `page` from Crystal wrapper; not verified against official OpenAPI schema

**Research date:** 2026-05-01
**Valid until:** 2026-06-01 for stable stack details; BambooHR API details should be re-verified against live credentials on implementation
