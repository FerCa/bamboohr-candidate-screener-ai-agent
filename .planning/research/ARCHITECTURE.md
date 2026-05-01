# Architecture Research

**Domain:** Automated HR candidate screening agent (TypeScript, OpenAI Agents SDK, BambooHR)
**Researched:** 2026-05-01
**Confidence:** MEDIUM (no external tool access; based on OpenAI Agents SDK TypeScript docs knowledge through August 2025 training, BambooHR API v1 patterns, and general agentic system patterns)

---

## Standard Architecture

### System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Entry Point (src/index.ts)                                          │
│  Docker ENTRYPOINT — loads config, builds agent, runs, exits        │
└───────────────────────┬─────────────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Bootstrap Layer                                                      │
│  ┌─────────────────────┐   ┌──────────────────────────────────────┐  │
│  │  Config Loader       │   │  BambooHR Client (singleton)         │  │
│  │  YAML → typed obj    │   │  Wraps fetch, injects auth header    │  │
│  └────────┬────────────┘   └──────────────────┬───────────────────┘  │
│           │                                    │                      │
└───────────┼────────────────────────────────────┼──────────────────────┘
            │                                    │
            ▼                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Agent Layer (OpenAI Agents SDK)                                      │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │  ScreeningAgent                                                  │  │
│  │  • system prompt = rules context (hard rules + soft guidelines) │  │
│  │  • tools injected at construction time                          │  │
│  │  • run() called once per candidate                              │  │
│  └───────────────────────────┬────────────────────────────────────┘  │
│                               │ tool calls                            │
│  ┌────────────┐ ┌───────────┐ │ ┌─────────────┐  ┌────────────────┐  │
│  │ list_cands │ │ get_cand  │ │ │ get_cv_text │  │ move_stage /   │  │
│  │ Tool       │ │ Tool      │ │ │ Tool        │  │ add_comment    │  │
│  └────────────┘ └───────────┘ │ └─────────────┘  └────────────────┘  │
└───────────────────────────────┼─────────────────────────────────────┘
                                │ HTTP
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  External Services                                                    │
│  ┌──────────────────────────────────┐  ┌─────────────────────────┐  │
│  │  BambooHR REST API               │  │  OpenAI API (GPT-4o)    │  │
│  │  /ats/v1/applications            │  │  via Agents SDK runner  │  │
│  │  /v1/applicant-tracking/         │  │                         │  │
│  └──────────────────────────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

---

### Component Responsibilities

| Component | Responsibility | Implementation |
|-----------|----------------|----------------|
| `index.ts` | Orchestrates startup: load config, build agent, fetch candidate list, run agent per candidate, exit with code 0/1 | Plain async main() |
| `config/loader.ts` | Parse YAML file → validate → return typed `AppConfig` object | `js-yaml` + `zod` schema |
| `config/schema.ts` | Zod schema for `AppConfig` — hard rules, stage IDs, job ID | Zod |
| `bamboohr/client.ts` | Thin HTTP client: auth header injection, base URL, retry-once on 429 | Native `fetch` with typed response shapes |
| `bamboohr/types.ts` | TypeScript types for BambooHR API response shapes | Plain types/interfaces |
| `pdf/extractor.ts` | Download PDF buffer from URL, parse to plain text | `pdf-parse` npm package |
| `agent/agent.ts` | Constructs the `Agent` with system prompt, tool list, model | `@openai/agents` `Agent` class |
| `agent/tools.ts` | Defines all tool functions with Zod input schemas | `@openai/agents` `tool()` function |
| `agent/prompt.ts` | Builds the system prompt string from `AppConfig` rules | Template string function |
| `agent/runner.ts` | Calls `run(agent, input)` per candidate, captures result, handles errors | `@openai/agents` `run()` |
| `logger.ts` | Structured JSON stdout logging wrapper | `console.log(JSON.stringify(...))` |
| `idempotency.ts` | Checks/writes a local run-state file to skip already-processed candidates | JSON file at `/data/processed.json` |

---

## Recommended Project Structure

```
src/
├── index.ts                 # Entry point — main() orchestrator
├── config/
│   ├── loader.ts            # YAML file → AppConfig (validates on load)
│   └── schema.ts            # Zod schema for full config shape
├── bamboohr/
│   ├── client.ts            # HTTP client (auth, base URL, typed methods)
│   └── types.ts             # API response types (Candidate, Application, etc.)
├── pdf/
│   └── extractor.ts         # Download PDF URL → extract plain text
├── agent/
│   ├── agent.ts             # Agent construction (system prompt + tools)
│   ├── tools.ts             # All tool definitions (list, get, move, comment, cv)
│   ├── prompt.ts            # System prompt builder from AppConfig
│   └── runner.ts            # run() wrapper — per-candidate, error-isolated
├── idempotency.ts           # Processed-candidate tracking (file-based)
└── logger.ts                # Structured JSON logger

config/
└── rules.example.yaml       # Documented example config (checked into repo)

data/                        # Mounted Docker volume
└── processed.json           # Written at runtime — gitignored
```

### Structure Rationale

- **`config/`:** Separates schema definition from loading logic. Zod schema doubles as documentation and catches misconfigured YAML at startup before any API calls.
- **`bamboohr/`:** Isolated behind a typed client so tool implementations never construct raw URLs or handle auth. Easy to mock in tests.
- **`pdf/`:** Isolated because PDF extraction is the most likely dependency to change (library swap, adding OCR fallback). Bounded module with a single function signature.
- **`agent/`:** Split into `agent.ts` (construction), `tools.ts` (definitions), `prompt.ts` (text), and `runner.ts` (execution) so each concern can be tested and modified independently.
- **`data/`:** Runtime volume mount. Separates ephemeral run state from code — survives container restart, excluded from image.

---

## Architectural Patterns

### Pattern 1: Single Agent, Per-Candidate Invocation

**What:** One `Agent` instance is constructed once at startup (shared across all candidates). `run(agent, candidateContext)` is called sequentially for each candidate in the "New" stage. Each run is isolated.

**When to use:** This system has a small, bounded candidate list per daily run (10–50 candidates typically). Sequential processing avoids rate limits and keeps reasoning chains short and focused.

**Trade-offs:** Slower than parallel processing, but BambooHR API has low rate limits and sequential execution makes logs readable and failures attributable to specific candidates.

**Example:**
```typescript
// agent/runner.ts
import { run } from "@openai/agents";
import { screeningAgent } from "./agent";

export async function runForCandidate(
  candidateId: string,
  context: CandidateContext
): Promise<ScreeningResult> {
  const input = buildCandidateInput(context); // structured text summary
  const result = await run(screeningAgent, input);
  return parseAgentResult(result.finalOutput);
}
```

---

### Pattern 2: Rules as System Prompt Context, Not Separate Service

**What:** Hard rules (from YAML config) and soft guidelines are serialized into the agent's system prompt at construction time. The rules engine is not a separate module the agent calls — the rules live in the agent's context window.

**When to use:** When rules are small enough to fit in the context window (they will be — a few dozen rules), this is simpler than a separate tool call. Hard rules are pre-checked *before* the agent runs (in `index.ts`) to short-circuit obvious rejects cheaply.

**Trade-offs:** Rules live in the prompt, so changes require rebuilding the agent (fine — agent is rebuilt on each container start). If rules grow to hundreds of entries, consider moving to a tool-based lookup.

**Example:**
```typescript
// agent/prompt.ts
export function buildSystemPrompt(config: AppConfig): string {
  return `
You are a recruitment screening agent. Evaluate candidates against these criteria:

HARD RULES (already pre-checked — provided for your reasoning context):
${config.hardRules.map(r => `- ${r.description}`).join("\n")}

SOFT EVALUATION CRITERIA (use your judgment):
${config.softRules.map(r => `- ${r.description}`).join("\n")}

Your job: call tools to get CV text and application answers, then decide:
- PASS → call move_to_phone_screen with a comment listing matched criteria
- REJECT → call move_to_reviewed with a comment listing unmet criteria

Be specific in your comments. Never say "does not meet criteria" without naming the criterion.
  `.trim();
}
```

---

### Pattern 3: Hard Rules Pre-Filter Before Agent

**What:** Before invoking the agent, `index.ts` evaluates all hard rules against the structured candidate data (no LLM needed). Candidates that fail hard rules are moved and commented without burning an agent run.

**When to use:** Always. Hard rules are deterministic and cheap. LLM calls cost money and time. Reserve the agent for candidates who cleared the objective criteria.

**Trade-offs:** Slightly more code paths to maintain (hard rule evaluator + agent for soft rules). Worth it — eliminates most LLM calls in practice.

**Example:**
```typescript
// index.ts (partial)
for (const candidate of newCandidates) {
  const hardResult = evaluateHardRules(candidate, config.hardRules);
  if (!hardResult.pass) {
    await bamboohr.moveStage(candidate.id, config.stages.reviewed);
    await bamboohr.addComment(candidate.id, buildRejectionComment(hardResult.failedRules));
    logger.info({ event: "hard_reject", candidateId: candidate.id, reasons: hardResult.failedRules });
    continue;
  }
  // Only reaches agent if hard rules pass
  await runnerForCandidate(candidate.id, buildContext(candidate));
}
```

---

### Pattern 4: Tool Definitions Co-Located with BambooHR Client

**What:** Each tool in `agent/tools.ts` closes over the BambooHR client and PDF extractor. Tools are thin wrappers: validate input, call the service, return a string result for the agent.

**When to use:** Standard pattern for OpenAI Agents SDK tool definition. Tools return strings (or JSON-stringified objects) that the agent reads.

**Trade-offs:** Tools are coupled to the BambooHR client instance. This is fine for a single-process application. Use dependency injection (pass client as a parameter to a tool factory) to enable testing.

**Example:**
```typescript
// agent/tools.ts
import { tool } from "@openai/agents";
import { z } from "zod";
import type { BambooHRClient } from "../bamboohr/client";
import type { PDFExtractor } from "../pdf/extractor";

export function buildTools(bamboohr: BambooHRClient, pdf: PDFExtractor) {
  const getCVText = tool({
    name: "get_cv_text",
    description: "Download and extract text from a candidate's CV PDF.",
    parameters: z.object({ candidateId: z.string() }),
    execute: async ({ candidateId }) => {
      const url = await bamboohr.getCVAttachmentUrl(candidateId);
      if (!url) return "No CV attached.";
      const text = await pdf.extractFromUrl(url);
      return text.slice(0, 8000); // guard against oversized CVs
    },
  });

  const moveToPhoneScreen = tool({
    name: "move_to_phone_screen",
    description: "Move candidate to 'Schedule Phone Screen' stage with a comment.",
    parameters: z.object({
      candidateId: z.string(),
      comment: z.string().describe("Specific criteria matched, listed clearly."),
    }),
    execute: async ({ candidateId, comment }) => {
      await bamboohr.moveStage(candidateId, config.stages.phoneScreen);
      await bamboohr.addComment(candidateId, comment);
      return "moved";
    },
  });

  return [getCVText, moveToPhoneScreen /*, ...others */];
}
```

---

## Data Flow

### Full Per-Candidate Processing Flow

```
Container starts
    │
    ▼
Load YAML config → validate with Zod → AppConfig
    │
    ▼
Build BambooHRClient (injects API key + subdomain from env)
Build PDFExtractor
Build tools(bamboohr, pdf) → tool array
Build systemPrompt(config) → string
Build Agent(model, systemPrompt, tools)
    │
    ▼
bamboohr.listCandidates(jobId, stage="New") → Candidate[]
    │
    ▼
For each Candidate:
    │
    ├─→ [Hard rule pre-filter]
    │       evaluateHardRules(candidate, config.hardRules)
    │       FAIL → moveStage(reviewed) + addComment → log → next candidate
    │       PASS → continue
    │
    ├─→ [Idempotency check]
    │       isProcessed(candidate.id) → skip if true
    │
    ├─→ [Agent run]
    │       run(agent, candidateSummary)
    │       Agent calls tools in a loop:
    │         1. get_cv_text(candidateId) → PDF downloaded, text extracted
    │         2. Agent reasons over CV + soft rules
    │         3. move_to_phone_screen(id, comment) OR move_to_reviewed(id, comment)
    │         4. Agent returns final output
    │
    ├─→ markProcessed(candidate.id) → write to /data/processed.json
    │
    └─→ log result (structured JSON to stdout)
    │
    ▼
All candidates processed
    │
    ▼
Log run summary (total, passed, rejected, errors)
    │
    ▼
Process exits (code 0 if no unhandled errors, code 1 if fatal)
```

### Tool Call Sequence (Agent Internal Loop)

```
Agent receives: "Evaluate candidate {id}: {name}, {applied_role}, {salary_ask}"
    │
    ▼
Agent calls: get_cv_text(candidateId)
    │   BambooHRClient.getCVAttachmentUrl(id) → URL
    │   fetch(URL) → PDF buffer
    │   pdf-parse(buffer) → plain text
    │   return text (truncated to 8000 chars)
    │
    ▼
Agent reads CV text, applies soft rules in reasoning
    │
    ▼
Agent calls: move_to_phone_screen(id, "Matched: 3+ years Node.js, salary within range, clear communication in cover letter")
    OR
Agent calls: move_to_reviewed(id, "Not matched: salary ask $180k exceeds ceiling $140k; no relevant backend experience")
    │
    ▼
Tool executes: bamboohr.moveStage() + bamboohr.addComment()
    │
    ▼
Agent returns final output (text confirmation)
```

---

## Answers to Key Architectural Questions

### 1. Agent Structure — Tools and Loop

The agent is constructed with 5 tools:

| Tool Name | Purpose | Returns |
|-----------|---------|---------|
| `get_cv_text` | Download + extract CV PDF text | String (plain text, truncated) |
| `get_application_answers` | Fetch structured application form answers | JSON string |
| `move_to_phone_screen` | Move stage + add pass comment | `"moved"` |
| `move_to_reviewed` | Move stage + add reject comment | `"moved"` |
| `log_no_cv` | Record that no CV was attached (agent still decides) | `"logged"` |

The agent loop is intentionally short: get CV text, reason, take one action (move). No multi-step loops needed. The agent should complete in 2–3 tool calls maximum. Set `maxTurns: 5` as a safety cap to prevent runaway loops.

### 2. Rules Engine Location

Rules engine is **not a separate service**. It is split into two tiers:

- **Hard rules** live in `src/hardRules.ts` — a pure function `evaluateHardRules(candidate, rules[])` that runs before the agent, requires no LLM, costs nothing.
- **Soft rules** live in the agent's system prompt as text instructions. No separate function needed — the LLM is the evaluator.

This avoids over-engineering: a "rules engine service" is unnecessary for this scale.

### 3. PDF Handling

PDF download and parsing is synchronous within the tool's `execute` function (awaited). Key decisions:

- **Truncate at 8000 tokens** (approximately 32,000 characters) before sending to the LLM. Most CVs are 1–3 pages; truncation protects against edge cases.
- **No caching** needed — each container run processes candidates once. PDFs are not stored.
- **Rate limit protection**: BambooHR API allows ~100 requests/minute. With 1 PDF per candidate and sequential processing, this is never a problem.
- **Error handling**: If PDF download fails (404, timeout), the tool returns `"No CV available"`. The agent can still decide based on application answers.

```typescript
// pdf/extractor.ts
export async function extractFromUrl(url: string): Promise<string> {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`PDF fetch failed: ${response.status}`);
  const buffer = Buffer.from(await response.arrayBuffer());
  const result = await pdfParse(buffer);
  return result.text;
}
```

### 4. Config Loading Architecture

```
/config/rules.yaml (Docker volume mount)
    │
    ▼
js-yaml.load() → unknown
    │
    ▼
AppConfigSchema.parse() (Zod) → AppConfig (typed, validated)
    │  Throws ZodError with field-level messages if invalid
    │
    ▼
AppConfig passed into: BambooHRClient constructor, prompt builder,
                       hard rules evaluator, tool factory
```

The config is loaded once at startup and passed explicitly — no global config singleton. This makes dependencies visible and simplifies testing.

**AppConfig shape:**
```typescript
interface AppConfig {
  bamboohr: { jobId: string; stages: { new: string; phoneScreen: string; reviewed: string } };
  hardRules: Array<{ field: string; operator: "lte" | "gte" | "eq" | "present"; value?: unknown; description: string }>;
  softRules: Array<{ description: string }>;
}
```

### 5. Error Handling and Partial Failure

**Per-candidate isolation:** Each candidate is processed in a `try/catch`. One candidate failing does not stop processing of others.

```typescript
for (const candidate of candidates) {
  try {
    await processCandidate(candidate, agent, config);
  } catch (err) {
    logger.error({ event: "candidate_error", candidateId: candidate.id, error: String(err) });
    errorCount++;
  }
}

if (errorCount > 0) {
  logger.warn({ event: "run_complete_with_errors", errorCount });
  process.exit(1); // Non-zero exit signals cron/monitoring that review is needed
}
```

**Fatal vs. recoverable errors:**

| Error | Handling |
|-------|---------|
| Config validation fails | `process.exit(1)` immediately — no partial run |
| BambooHR auth fails (401) | `process.exit(1)` — credential issue, nothing to process |
| BambooHR 429 rate limit | Retry once after 60s delay, then log error and skip candidate |
| PDF download fails | Tool returns "No CV available", agent continues |
| Agent run throws | Caught per-candidate, logged, continue to next |
| Agent returns ambiguous output | Parse failure → log error, skip candidate (do NOT write unknown state to BambooHR) |

### 6. Idempotency

The container is short-lived and cron-triggered. Without idempotency, re-running after a partial failure would re-process candidates already moved.

**Strategy: processed.json file on mounted volume**

```
/data/processed.json  ← mounted Docker volume, persists between runs
```

```typescript
// idempotency.ts
interface ProcessedStore { processedIds: string[] }

export async function isProcessed(id: string, storePath: string): Promise<boolean> {
  try {
    const store: ProcessedStore = JSON.parse(await fs.readFile(storePath, "utf8"));
    return store.processedIds.includes(id);
  } catch { return false; } // file doesn't exist yet = nothing processed
}

export async function markProcessed(id: string, storePath: string): Promise<void> {
  let store: ProcessedStore = { processedIds: [] };
  try { store = JSON.parse(await fs.readFile(storePath, "utf8")); } catch {}
  store.processedIds.push(id);
  await fs.writeFile(storePath, JSON.stringify(store, null, 2));
}
```

**Why file-based and not BambooHR stage check:** Stage-based idempotency (skip if candidate is no longer in "New") is cleaner but requires an extra API call per candidate to re-fetch stage. File-based is free and explicit. Both can coexist: check file first (fast), verify stage second if the file check passes.

---

## Anti-Patterns

### Anti-Pattern 1: Single Agent Run for All Candidates

**What people do:** Pass the full list of candidates as one big prompt to a single agent run.

**Why it's wrong:** Context window fills up fast. If one candidate causes a tool error, the entire run fails. Reasoning quality degrades when the agent juggles 20 candidates simultaneously. Output parsing becomes fragile.

**Do this instead:** One `run(agent, candidateContext)` call per candidate. Sequential, isolated, easy to debug.

---

### Anti-Pattern 2: Rules Engine as a Separate Agent or Tool

**What people do:** Create a "rules evaluator" agent that the screening agent calls as a sub-agent.

**Why it's wrong:** Unnecessary complexity for this scale. Hard rules are pure functions. Soft rules are just instructions in the prompt. Adding a second agent adds latency, cost, and a new failure point.

**Do this instead:** Hard rules as a plain function pre-filter. Soft rules as system prompt context.

---

### Anti-Pattern 3: Storing State in Agent Memory Between Candidates

**What people do:** Reuse the same `run()` continuation across candidates, hoping the agent "remembers" previous decisions.

**Why it's wrong:** OpenAI Agents SDK `run()` contexts are not designed for cross-candidate state. This would pollute the context window and produce inconsistent decisions based on candidate ordering.

**Do this instead:** Fresh `run()` call per candidate. The agent constructs its own context by calling tools.

---

### Anti-Pattern 4: Writing to BambooHR Before Agent Confirms

**What people do:** Optimistically move the stage, then run the agent to get the comment.

**Why it's wrong:** If the agent fails mid-run, the candidate is in the wrong stage with no comment. Recruiters see a moved candidate with no explanation.

**Do this instead:** The move-stage and add-comment operations are inside the tool's `execute` function. The agent only calls the tool when it has a decision and a comment ready. Both operations happen atomically within the tool.

---

### Anti-Pattern 5: Trusting Agent Output Strings Blindly

**What people do:** Let the agent return `"PASS"` or `"REJECT"` as a string and parse it with `.includes()`.

**Why it's wrong:** LLMs produce inconsistent output formats. Parsing breaks silently.

**Do this instead:** The agent's action is the tool call itself. The agent's final text output is not the decision — the tool execution is. This is the correct use of tool-based agents: the tool call IS the side effect, not the text output.

---

## Integration Points

### External Services

| Service | Integration Pattern | Notes |
|---------|---------------------|-------|
| BambooHR REST API | HTTP client with `Authorization: Basic base64(apikey:x)` header | API key is `apikey`, password is literal `"x"`. Rate limit ~100 req/min. No official SDK for Node — use raw fetch. |
| OpenAI API | Via `@openai/agents` `run()` | SDK handles streaming, retries, tool call loop. Do not call OpenAI API directly. |
| Docker volume | File system read/write at `/data/` | Mounted at runtime. Code uses configurable path via env var `DATA_DIR` defaulting to `/data`. |

### Internal Boundaries

| Boundary | Communication | Notes |
|----------|---------------|-------|
| `index.ts` ↔ `agent/runner.ts` | Direct function call, passes `AppConfig` and `Candidate` | Runner returns `ScreeningResult` — a plain typed object |
| `agent/tools.ts` ↔ `bamboohr/client.ts` | Factory pattern — tools close over client instance | Never import BambooHR client directly into tools; receive via `buildTools(client)` |
| `agent/tools.ts` ↔ `pdf/extractor.ts` | Factory pattern — same as above | `buildTools(client, pdfExtractor)` |
| `config/loader.ts` ↔ rest of system | One-way: load once, pass down explicitly | No global config object. Every module that needs config receives it as a parameter. |
| `idempotency.ts` ↔ `index.ts` | Direct calls at two points: check before agent run, mark after success | Path to `processed.json` comes from env var `DATA_DIR` |

---

## Suggested Build Order

Build in this order to validate integration at each step before adding complexity:

1. **Config loader** — `config/schema.ts` + `config/loader.ts`. Validate YAML parsing works and Zod catches bad config. No external dependencies. Can test immediately.

2. **BambooHR client** — `bamboohr/client.ts` + `bamboohr/types.ts`. Get `listCandidates()` working against real API. This validates credentials and API shape before any agent work.

3. **Hard rules evaluator** — `src/hardRules.ts`. Pure function, no external deps. Write unit tests. This is your cheapest screening path.

4. **PDF extractor** — `pdf/extractor.ts`. Validate `pdf-parse` works with a real BambooHR CV attachment URL.

5. **Agent tools** — `agent/tools.ts` using the already-tested BambooHR client and PDF extractor.

6. **System prompt builder** — `agent/prompt.ts`. Output the prompt to stdout and review it manually before connecting to LLM.

7. **Agent + runner** — `agent/agent.ts` + `agent/runner.ts`. Wire up the `@openai/agents` `Agent` and `run()`. Test with a single candidate.

8. **Idempotency** — `idempotency.ts`. Add after single-candidate flow works end-to-end.

9. **Main orchestrator** — `index.ts`. Wire all components together, add per-candidate error isolation, exit codes.

10. **Docker packaging** — `Dockerfile` + `docker-compose.yml`. Validate volume mounting for config and data.

---

## Scaling Considerations

This is a batch tool, not a web service. Scaling questions are about batch throughput, not concurrent users.

| Scale | Architecture Adjustment |
|-------|------------------------|
| 1–20 candidates/day | Sequential processing, current architecture — no changes needed |
| 20–200 candidates/day | Add `p-limit` concurrency control (e.g., 3 parallel agent runs). BambooHR rate limits will become the constraint first. |
| 200+ candidates/day | Sequential becomes impractical. Move to parallel fan-out with controlled concurrency. Consider BambooHR API quotas carefully. |
| Multiple job openings | Config supports array of jobs; `index.ts` iterates over jobs then candidates. No architectural change needed. |

**First bottleneck:** PDF download latency (1–5 seconds per CV). Not a problem at 20 candidates; becomes relevant at 100+. Solution: pre-fetch all PDFs in parallel before starting agent runs.

---

## Sources

- OpenAI Agents SDK TypeScript documentation (training knowledge through August 2025) — MEDIUM confidence. SDK was in active development; verify tool definition API and `run()` signature against current `@openai/agents` package docs.
- BambooHR API v1 documentation (training knowledge) — MEDIUM confidence. Endpoint paths and auth pattern are stable; verify specific ATS endpoint URLs against `documentation.bamboohr.com`.
- `pdf-parse` npm package patterns — HIGH confidence. Stable, widely used, well-understood interface.
- Idempotency patterns for cron batch jobs — HIGH confidence. Standard pattern.

---
*Architecture research for: BambooHR Candidate Screener (TypeScript, OpenAI Agents SDK)*
*Researched: 2026-05-01*
