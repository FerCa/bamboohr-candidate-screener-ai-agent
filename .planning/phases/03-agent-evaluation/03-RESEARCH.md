# Phase 3: Agent Evaluation - Research

**Researched:** 2026-05-02
**Domain:** OpenAI Agents SDK (TypeScript) — structured output, Agent/Runner API, error handling
**Confidence:** HIGH (core SDK verified from installed type definitions; secondary findings from official GitHub examples)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01** Each soft rule has `label` (human-readable, used verbatim in log/comment) and `description` (evaluation criterion sent to GPT-4o).

**D-02** `softRules` in config split into `required` and `optional` sections. `required` criteria are dealbreakers; `optional` are nice-to-haves.

**D-03** Pass logic: all `required` must pass → `pass`. Any `required` fails → `fail`. GPT-4o parse failure → `needsReview`.

**D-04** GPT-4o outputs pass/fail + one-line rationale per criterion, grounded in actual candidate CV/answers.

**D-05** `optional` criteria evaluations included in `EvaluationResult` output and in recruiter comment (separate "Optional" section).

**D-06** Recruiter comment: structured list with fixed sections: outcome header, Met (required), Unmet (required if any), Optional results, footer `[Auto-screened by AI — final decision rests with recruiter]`.

**D-07** Comment covers soft evaluation only. Hard-rule pass is implicit.

**D-08** Per-criterion rationale in comment is GPT-4o generated, not the rule description.

**D-09** `EvaluationResult` type in `src/agent/types.ts`:
```typescript
{
  applicationId: number;
  applicantId: number;
  outcome: 'pass' | 'fail' | 'needsReview';
  required: Array<{ label: string; met: boolean; rationale: string }>;
  optional: Array<{ label: string; met: boolean; rationale: string }>;
  comment: string;
  timestamp: string;
}
```

**D-10** `EvaluationResult` logged to stdout for soft-evaluated candidates (replacing Phase 2 placeholder for the `pass` branch). `CandidateDecision` continues for all other paths.

**D-11** `EvaluationResult` is the Phase 4 input for BambooHR writes.

**Agent Architecture (Claude's discretion):**
- SDK used for `Runner.run()` / `maxTurns ≤ 5` loop abstraction (SAFE-02). No tools needed.
- File layout: `src/agent/` directory (types.ts, evaluator.ts, prompt.ts).
- `softRules` optional top-level key in `configSchema` (backward-compatible).
- If `softRules` absent: skip GPT-4o, log `pass` with empty arrays + comment `'No soft rules configured'`.
- GPT-4o parse failure → `needsReview`, not throw.
- Comment pre-formatted by GPT-4o as ready-to-post string (not assembled in code).
- `[Auto-screened by AI — final decision rests with recruiter]` footer hardcoded in system prompt.

### Claude's Discretion

- Internal file split within `src/agent/` (types.ts, evaluator.ts, prompt.ts).
- Whether `logEvaluation()` is a second function or overload of `logDecision()` in logger.ts.
- Zod schema shape for the GPT-4o structured output (same schema drives both the SDK call and `EvaluationResult` interface).

### Deferred Ideas (OUT OF SCOPE)

None.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BAMB-02 | System moves candidate pipeline stage to "Schedule Phone Screen" (pass) or "Reviewed" (fail/review) | `EvaluationResult.outcome` is the drive signal; actual write deferred to Phase 4 — Phase 3 produces the value |
| BAMB-03 | System posts structured comment on each processed application | `EvaluationResult.comment` is the ready-to-post string; Phase 3 produces it; Phase 4 posts it |
| RULE-02 | GPT-4o soft evaluation with structured JSON output; criteria in YAML config | Agent with Zod `outputType` on SDK v0.8.5; `run()` function with `maxTurns` option |
| SAFE-02 | Each per-candidate agent run has `maxTurns` cap ≤ 5 | `maxTurns` is a `SharedRunOptions` field passed to `run(agent, input, { maxTurns: 5 })`; `MaxTurnsExceededError` thrown on breach |
</phase_requirements>

---

## Summary

Phase 3 adds GPT-4o soft evaluation to the existing pipeline. Candidates that passed hard rules and have a valid CV text (non-null `ctx.cvText`) are fed into an OpenAI Agents SDK agent that receives the full `CandidateContext` as a structured prompt and returns a typed `EvaluationResult` via the SDK's Zod `outputType` feature. The agent is single-turn in practice (no tools, structured output forces one-shot completion), so the `maxTurns ≤ 5` cap is a safety ceiling only.

The SDK version is `@openai/agents@0.8.5` (current as of 2026-04-21). The package requires Zod v4 as a peer dependency (`"zod": "^4.0.0"`) — the project already has `zod@^4.4.1` installed, so no version conflict exists. The SDK reads `OPENAI_API_KEY` from the environment automatically via `getDefaultOpenAIKey()`, aligning with CONF-03.

The default model for the SDK is `gpt-4.1` (not `gpt-4o`). The agent constructor must specify `model: 'gpt-4o'` explicitly — or set the `OPENAI_DEFAULT_MODEL` environment variable — otherwise the wrong model is used. This is a critical pitfall for the planner.

**Primary recommendation:** Use the top-level `run()` function (not `new Runner()`) with `{ maxTurns: 5 }`. Pass `outputType: EvaluationOutputSchema` (a `z.object(...)`) to the `Agent` constructor to get typed structured output. Catch `MaxTurnsExceededError` and return `needsReview`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Soft rule evaluation (GPT-4o) | API/Backend (Node.js process) | — | CPU-bound LLM call; no browser involvement |
| Structured output schema | API/Backend (Node.js process) | — | Zod schema lives in src/agent/types.ts; validated at runtime |
| Prompt construction | API/Backend (Node.js process) | — | Built from CandidateContext + config.softRules in src/agent/prompt.ts |
| EvaluationResult logging | API/Backend (src/logger/) | — | stdout JSON line — same pattern as CandidateDecision |
| Config schema extension | API/Backend (src/config/schema.ts) | — | softRules added as optional Zod key |
| BambooHR writes (stage, comment) | API/Backend (Phase 4) | — | Phase 3 produces the data; Phase 4 executes writes |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@openai/agents` | 0.8.5 | Agent loop, structured output, run orchestration | Project requirement; current latest [VERIFIED: npm registry] |
| `zod` | ^4.4.1 (already installed) | Output schema definition + runtime validation | Required peer dep of SDK (`"zod": "^4.0.0"`); already in package.json [VERIFIED: npm view] |
| `openai` | ^6.26.0 (transitive) | Underlying OpenAI HTTP client used by agents-openai | Pulled in by SDK — no direct install needed [VERIFIED: @openai/agents package.json] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `dotenv` | already installed | Loads OPENAI_API_KEY from .env | Already wired in index.ts via `import 'dotenv/config'` — no new setup needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `@openai/agents` + `run()` | Raw `openai` SDK + `response_format: { type: 'json_schema' }` | Raw SDK avoids agent abstraction overhead; however project requirement locks in @openai/agents |
| `new Runner()` | Top-level `run()` | `Runner` constructor allows shared config across runs; top-level `run()` is simpler and sufficient for per-candidate isolation |

**Installation:**
```bash
npm install @openai/agents
```

**Version verification (done):**
- `@openai/agents`: 0.8.5 — published 2026-04-21 [VERIFIED: npm registry]
- `zod` peer requirement: `^4.0.0` — project uses `^4.4.1` — compatible [VERIFIED: installed package.json]

---

## Architecture Patterns

### System Architecture Diagram

```
src/index.ts (candidate loop)
    │
    ├─ evaluateHardRules(config, detail)
    │       │ outcome === 'fail'
    │       └──> logDecision(CandidateDecision) → stdout
    │
    └─ outcome === 'pass'
            │
            ├─ buildCandidateContext(client, detail, result)
            │       │ ctx.needsReviewReason !== null
            │       └──> logDecision(needsReview CandidateDecision) → stdout
            │
            └─ ctx.cvText is non-null
                    │
                    ├─ [softRules absent in config]
                    │       └──> logEvaluation(EvaluationResult{outcome:'pass', comment:'No soft rules configured'}) → stdout
                    │
                    └─ [softRules present]
                            │
                            ▼
                    evaluateSoftRules(ctx, config.softRules)
                            │
                            ├─ buildPrompt(ctx, softRules)    ← src/agent/prompt.ts
                            │
                            ├─ new Agent({ model:'gpt-4o', outputType: EvaluationOutputSchema })
                            │
                            ├─ run(agent, userMessage, { maxTurns: 5 })
                            │       │
                            │       ├─ success → result.finalOutput  (typed EvaluationOutput)
                            │       │       └──> assemble EvaluationResult → logEvaluation() → stdout
                            │       │
                            │       └─ MaxTurnsExceededError / parse error
                            │               └──> EvaluationResult{outcome:'needsReview'} → logEvaluation() → stdout
                            │
                            └─ (network / auth error re-thrown → caught by outer try/catch in index.ts)
```

### Recommended Project Structure

```
src/
├── agent/
│   ├── types.ts          # EvaluationResult interface + EvaluationOutputSchema (Zod)
│   ├── evaluator.ts      # evaluateSoftRules(ctx, softRules): Promise<EvaluationResult>
│   └── prompt.ts         # buildSystemPrompt(), buildUserMessage()
├── config/
│   └── schema.ts         # extend configSchema with softRules optional key
├── logger/
│   └── logger.ts         # add logEvaluation(result: EvaluationResult)
└── index.ts              # wire evaluateSoftRules into pass branch
```

### Pattern 1: Agent with Structured Zod Output

**What:** Pass a `z.object(...)` schema as `outputType` to `Agent`. The SDK uses OpenAI structured outputs to force the model response to match the schema. `result.finalOutput` is typed as `z.infer<typeof schema>`.

**When to use:** Any time you need a typed JSON response from an agent without tool calls.

**Example:**
```typescript
// Source: https://github.com/openai/openai-agents-js/blob/main/examples/docs/agents/agentWithAodOutputType.ts
import { Agent, run } from '@openai/agents';
import { z } from 'zod';

const EvaluationOutputSchema = z.object({
  required: z.array(z.object({
    label: z.string(),
    met: z.boolean(),
    rationale: z.string(),
  })),
  optional: z.array(z.object({
    label: z.string(),
    met: z.boolean(),
    rationale: z.string(),
  })),
  comment: z.string(),
  outcome: z.enum(['pass', 'fail', 'needsReview']),
});

const agent = new Agent({
  name: 'Candidate Evaluator',
  model: 'gpt-4o',          // MUST be explicit — default is gpt-4.1
  instructions: systemPrompt,
  outputType: EvaluationOutputSchema,
});

const result = await run(agent, userMessage, { maxTurns: 5 });
// result.finalOutput is z.infer<typeof EvaluationOutputSchema>
```

### Pattern 2: MaxTurnsExceededError Handling

**What:** `MaxTurnsExceededError` extends `AgentsError` which extends `Error`. It is thrown by `run()` when the turn limit is breached. Catch it and map to `needsReview`.

**Example:**
```typescript
// Source: verified from /tmp/node_modules/@openai/agents-core/dist/errors.d.ts
import { run, MaxTurnsExceededError } from '@openai/agents';

try {
  const result = await run(agent, userMessage, { maxTurns: 5 });
  return mapToEvaluationResult(result.finalOutput, ctx);
} catch (err) {
  if (err instanceof MaxTurnsExceededError) {
    return needsReviewResult(ctx, 'agent-max-turns-exceeded');
  }
  throw err; // re-throw network/auth errors → caught by outer try/catch in index.ts
}
```

### Pattern 3: Zod Schema as Dual-Purpose Type

**What:** The same Zod schema (`EvaluationOutputSchema`) drives both the SDK structured output call and the TypeScript `EvaluationResult` type via `z.infer<>`. No second type definition that can drift.

**Example:**
```typescript
// src/agent/types.ts
import { z } from 'zod';

export const CriterionResultSchema = z.object({
  label: z.string(),
  met: z.boolean(),
  rationale: z.string(),
});

// This schema is BOTH the GPT-4o response schema AND the EvaluationResult's inner types
export const EvaluationOutputSchema = z.object({
  required: z.array(CriterionResultSchema),
  optional: z.array(CriterionResultSchema),
  comment: z.string(),
  outcome: z.enum(['pass', 'fail', 'needsReview']),
});

// Top-level EvaluationResult (adds IDs and timestamp — not from GPT-4o)
export interface EvaluationResult {
  applicationId: number;
  applicantId: number;
  outcome: 'pass' | 'fail' | 'needsReview';
  required: z.infer<typeof CriterionResultSchema>[];
  optional: z.infer<typeof CriterionResultSchema>[];
  comment: string;
  timestamp: string;
}
```

### Pattern 4: tool() Registration (reference — not used in Phase 3)

**What:** `tool()` creates a `FunctionTool`. Phase 3 does not use tools (structured output only), but the API shape is documented here per the research flag.

**Example:**
```typescript
// Source: verified from /tmp/node_modules/@openai/agents-core/dist/tool.d.ts
import { tool } from '@openai/agents';
import { z } from 'zod';

const myTool = tool({
  name: 'get_data',
  description: 'Fetch some data',
  parameters: z.object({ query: z.string() }),
  execute: async (input) => {
    return `result for ${input.query}`;
  },
});
// Add to agent: new Agent({ tools: [myTool], ... })
```

### Anti-Patterns to Avoid

- **Missing `model: 'gpt-4o'`:** Default model is `gpt-4.1`. Always specify `model: 'gpt-4o'` explicitly on the Agent constructor, or set `OPENAI_DEFAULT_MODEL=gpt-4o` in env.
- **Importing from `@openai/agents-core` directly:** Always import from `@openai/agents`. The monorepo internals (`@openai/agents-core`, `@openai/agents-openai`) are sub-packages re-exported by the main package.
- **Forgetting ESM `.js` extensions on new imports:** `src/agent/types.ts` must be imported as `'../agent/types.js'` per project's NodeNext ESM requirement.
- **Passing full candidate list to one agent run:** CLAUDE.md constraint — one `run()` call per candidate only.
- **Catching all errors as `needsReview`:** Only catch `MaxTurnsExceededError` and Zod parse failures as `needsReview`. Network / auth errors must re-throw so the outer `try/catch` in `index.ts` can emit `logDecision({ outcome: 'error' })`.
- **Building comment string in TypeScript code:** The comment must be generated by GPT-4o as part of structured output (locked in D-06/D-08). Code assembles only the `EvaluationResult` wrapper, not the comment text.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Structured JSON response from GPT-4o | Manual `JSON.parse()` of LLM text + try/catch | `outputType: EvaluationOutputSchema` on Agent | SDK handles response_format injection, schema enforcement, parse errors |
| Turn limit enforcement | Custom turn counter | `run(agent, input, { maxTurns: 5 })` | SDK counts turns and throws `MaxTurnsExceededError` automatically |
| OpenAI API key management | Manual header injection | SDK reads `OPENAI_API_KEY` from env automatically | `getDefaultOpenAIKey()` reads `process.env.OPENAI_API_KEY` — no extra setup |
| Agent loop retry / error state | Custom retry logic | `err.state` on `AgentsError` for resume; or re-throw to outer handler | SDK preserves run state on errors for optional resume |

**Key insight:** The SDK's structured output feature (`outputType` with Zod) eliminates the entire class of "LLM returned malformed JSON" bugs — the only failure mode becomes a hard parse error that maps cleanly to `needsReview`.

---

## Common Pitfalls

### Pitfall 1: Wrong Default Model

**What goes wrong:** Agent silently uses `gpt-4.1` instead of `gpt-4o`. Evaluations may have different capability/cost profile than intended.

**Why it happens:** `getDefaultModel()` in `@openai/agents-core` defaults to `'gpt-4.1'` unless `OPENAI_DEFAULT_MODEL` env var is set or `model` is specified in the Agent constructor.

**How to avoid:** Always specify `model: 'gpt-4o'` in the Agent constructor. Do not rely on the default.

**Warning signs:** Check logs — if `model` is omitted from Agent config, the default takes effect silently.

### Pitfall 2: `@openai/agents` Not in package.json

**What goes wrong:** `import { Agent, run } from '@openai/agents'` fails at runtime with module not found.

**Why it happens:** The package is not yet in the project's `package.json` (it is listed in CLAUDE.md as deferred to Phase 3). `npm install @openai/agents` must happen before any code that imports from it.

**How to avoid:** Wave 0 plan must `npm install @openai/agents` and commit `package.json` / `package-lock.json`.

**Warning signs:** `Error: Cannot find module '@openai/agents'` at startup.

### Pitfall 3: MaxTurnsExceededError Not Caught → Bubbles to Outer Handler

**What goes wrong:** If `MaxTurnsExceededError` is not caught inside `evaluateSoftRules()`, it propagates to the outer `try/catch` in `index.ts` which logs `{ outcome: 'error' }` and continues. Functionally safe (SAFE-01 is honoured), but the wrong outcome — these candidates should be `needsReview`, not `error`.

**Why it happens:** Forgetting to catch `MaxTurnsExceededError` specifically.

**How to avoid:** Wrap `run()` in its own try/catch inside `evaluateSoftRules()`. Catch `MaxTurnsExceededError` → return `needsReview`. Re-throw everything else.

**Warning signs:** Candidates logging `outcome: 'error'` with message `'Max turns (5) exceeded'`.

### Pitfall 4: Zod Schema Doesn't Include `outcome` Field

**What goes wrong:** GPT-4o must compute the `outcome` field as part of its response. If `outcome` is omitted from `EvaluationOutputSchema`, it must be computed in TypeScript code from the `required` array — which adds complexity and a code/prompt divergence.

**Why it happens:** Attempting to separate "GPT-4o computes criteria" from "code computes outcome".

**How to avoid:** Include `outcome: z.enum(['pass', 'fail', 'needsReview'])` in `EvaluationOutputSchema`. Let GPT-4o compute it based on the pass logic in the system prompt. TypeScript code can validate/override for `needsReview` cases (parse failure, max turns) but should trust GPT-4o for normal pass/fail.

**Warning signs:** Code contains post-hoc outcome computation from `required.every(r => r.met)`.

### Pitfall 5: GPT-4o Comment Contains Hard-Rule Summary

**What goes wrong:** The system prompt accidentally asks GPT-4o to include hard rule results in the comment, violating D-07.

**Why it happens:** `CandidateContext.hardRuleResult` is available in the context and might be included in the user message.

**How to avoid:** System prompt must explicitly state "Comment covers soft evaluation only. Do not include hard rule results." The `hardRuleResult` field in `CandidateContext` should be omitted from the user message, or the prompt must explicitly exclude it from the comment.

### Pitfall 6: Missing `.js` Extension on New Agent Imports

**What goes wrong:** TypeScript compiles but Node.js fails at runtime with `ERR_MODULE_NOT_FOUND`.

**Why it happens:** Project uses `"module": "NodeNext"` ESM which requires explicit `.js` extensions in import paths even for `.ts` source files.

**How to avoid:** All new imports in Phase 3 files must end in `.js`: `import { evaluateSoftRules } from './agent/evaluator.js'`.

---

## Code Examples

Verified patterns from official sources:

### Agent Constructor with Structured Output
```typescript
// Source: https://github.com/openai/openai-agents-js/blob/main/examples/docs/agents/agentWithAodOutputType.ts
// and verified from /tmp/node_modules/@openai/agents-core/dist/agent.d.ts
import { Agent } from '@openai/agents';
import { z } from 'zod';

const MySchema = z.object({
  name: z.string(),
  date: z.string(),
  participants: z.array(z.string()),
});

const agent = new Agent({
  name: 'My Agent',
  instructions: 'Your system prompt here',
  model: 'gpt-4o',        // explicit — default is gpt-4.1
  outputType: MySchema,   // Zod z.object() — typed structured output
});
```

### run() with maxTurns
```typescript
// Source: verified from /tmp/node_modules/@openai/agents-core/dist/run.d.ts
import { run } from '@openai/agents';

// Non-streaming (default):
const result = await run(agent, 'user message string', {
  maxTurns: 5,   // SharedRunOptions.maxTurns: number (optional, default unlimited)
});
// result.finalOutput is z.infer<typeof MySchema> when agent has outputType set
console.log(result.finalOutput?.name);
```

### Error Hierarchy
```typescript
// Source: verified from /tmp/node_modules/@openai/agents-core/dist/errors.d.ts
import {
  MaxTurnsExceededError,  // thrown when maxTurns is exceeded
  AgentsError,             // base class for all SDK errors
  ModelBehaviorError,      // unexpected model behavior
  ToolCallError,           // tool invocation failed (not used in Phase 3)
} from '@openai/agents';

try {
  const result = await run(agent, input, { maxTurns: 5 });
  return result.finalOutput;
} catch (err) {
  if (err instanceof MaxTurnsExceededError) {
    // Map to needsReview — do not re-throw
    return null; // handled upstream
  }
  throw err; // re-throw to outer handler
}
```

### tool() Registration (Phase 3 reference — not used)
```typescript
// Source: verified from /tmp/node_modules/@openai/agents-core/dist/tool.d.ts
import { tool } from '@openai/agents';
import { z } from 'zod';

const myTool = tool({
  name: 'tool_name',
  description: 'What the tool does',
  parameters: z.object({ input: z.string() }),
  execute: async (args) => `result: ${args.input}`,
});
// Attach to agent: new Agent({ tools: [myTool], ... })
```

### softRules Zod Schema Extension
```typescript
// src/config/schema.ts — extend configSchema with optional softRules key
const softRuleEntrySchema = z.object({
  label: z.string().min(1),
  description: z.string().min(1),
});

const softRulesSchema = z.object({
  required: z.array(softRuleEntrySchema).optional().default([]),
  optional: z.array(softRuleEntrySchema).optional().default([]),
}).optional();
// Add to configSchema: softRules: softRulesSchema
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `openai` SDK `chat.completions.create` + manual JSON parse | `@openai/agents` with `outputType: ZodSchema` | 2025 (agents SDK launch) | Structured output + turn management in one abstraction |
| Zod v3 peer dependency | Zod v4 peer dependency (`^4.0.0`) | @openai/agents@0.8.5 (2026-04-21) | Project must use Zod v4 — already the case |
| Default model `gpt-4o` (prior versions) | Default model `gpt-4.1` | agents SDK v0.8.x | Must specify `model: 'gpt-4o'` explicitly |

**Deprecated/outdated:**
- `new Runner()` for simple use cases: Prefer top-level `run()` — simpler, equivalent for single-configuration runs.
- Zod v3 with `@openai/agents`: Not supported in v0.8.5; peer dep is `^4.0.0`.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | GPT-4o supports structured output via `outputType` Zod schema in this SDK | Standard Stack | If gpt-4o doesn't support Responses API structured outputs, fall back to `response_format: json_schema` pattern — but SDK handles this internally; LOW risk |
| A2 | Default model changed to `gpt-4.1` in v0.8.x (not a named version) | Common Pitfalls #1 | If default is still gpt-4o, the explicit `model: 'gpt-4o'` is harmless but unnecessary — no execution risk |

---

## Open Questions

1. **GPT-4o structured output: Responses API vs Chat Completions**
   - What we know: `@openai/agents-openai` wraps both; `OpenAIProvider.useResponses` controls which path is used; default behavior auto-selects.
   - What's unclear: Whether the SDK defaults to Responses API or Chat Completions for gpt-4o with structured outputs (affects latency/feature set).
   - Recommendation: Accept the SDK default; do not configure `useResponses` explicitly. If structured output fails in testing, check if `useResponses: false` resolves it.

2. **`outcome` field in GPT-4o schema: trust vs. override**
   - What we know: D-03 defines pass logic as "all required must pass". GPT-4o could compute it independently.
   - What's unclear: Whether to include `outcome` in `EvaluationOutputSchema` (trusting GPT-4o to compute it) or compute it in TypeScript from the `required` array.
   - Recommendation: Include `outcome` in the schema and in the system prompt instructions. TypeScript should override with `needsReview` only for parse/maxTurns failures — not re-compute for normal pass/fail. This matches D-09.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `@openai/agents` (npm) | RULE-02, SAFE-02 | Not installed yet | 0.8.5 (current) | None — must install in Wave 0 |
| `OPENAI_API_KEY` env var | run() API calls | Present in .env.example; must be set | — | None — crashes at first run() call |
| Node.js ≥ 22 | @openai/agents supported environments | 22 (project requirement) | ≥22 | — |

**Missing dependencies with no fallback:**
- `@openai/agents` not in `package.json` — Wave 0 plan must run `npm install @openai/agents` and commit updated `package.json` + `package-lock.json`.
- `OPENAI_API_KEY` must be set in `.env` for local dry-run testing.

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | — |
| V3 Session Management | No | Stateless run — no sessions |
| V4 Access Control | No | — |
| V5 Input Validation | Yes | Zod `outputType` schema validates GPT-4o response; CandidateContext.cvText truncated at 8000 chars (Phase 2) |
| V6 Cryptography | No | OPENAI_API_KEY via env var only (CONF-03) — not stored |

### Known Threat Patterns for Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| CV content prompt injection | Tampering | `cvText` is inserted into user message as literal text (not system prompt); system prompt is hardcoded; GPT-4o structured output limits response shape |
| PII exfiltration via logs | Information Disclosure | `EvaluationResult` logged to stdout must not include raw `cvText` — only criteria results and comment |
| Unbounded LLM cost | Denial of Service | `maxTurns: 5` cap (SAFE-02); single-turn structured output means in practice ≤ 1 turn per candidate |
| API key in config or code | Information Disclosure | CONF-03 enforcement — `OPENAI_API_KEY` from env var only, never in config.yaml or source |

---

## Sources

### Primary (HIGH confidence)
- `/tmp/node_modules/@openai/agents-core/dist/run.d.ts` — `Runner.run()` signature, `RunConfig`, `SharedRunOptions`, `maxTurns`, `NonStreamRunOptions`
- `/tmp/node_modules/@openai/agents-core/dist/result.d.ts` — `RunResult`, `RunResultBase`, `finalOutput` accessor
- `/tmp/node_modules/@openai/agents-core/dist/agent.d.ts` — `Agent` class, `AgentConfiguration`, `outputType: AgentOutputType`
- `/tmp/node_modules/@openai/agents-core/dist/errors.d.ts` — `MaxTurnsExceededError`, `AgentsError`, all error class hierarchy
- `/tmp/node_modules/@openai/agents-core/dist/tool.d.ts` — `tool()` function signature, `ToolOptions`, `StrictToolOptions`
- `/tmp/node_modules/@openai/agents-core/dist/utils/zodCompat.d.ts` — `ZodObjectLike = ZodObject<any, any>` (what `outputType` accepts)
- `/tmp/node_modules/@openai/agents/package.json` — version 0.8.5, `peerDependencies: { zod: '^4.0.0' }`
- `/tmp/node_modules/@openai/agents-openai/dist/openaiProvider.d.ts` — `OpenAIProvider`, auto API key reading
- `npm view @openai/agents` — version 0.8.5, published 2026-04-21

### Secondary (MEDIUM confidence)
- https://github.com/openai/openai-agents-js/blob/main/examples/docs/agents/agentWithAodOutputType.ts — `outputType: ZodSchema` pattern (confirmed structure)
- https://github.com/openai/openai-agents-js/blob/main/examples/docs/running-agents/exceptions1.ts — error handling patterns, `outputType` with guardrails

### Tertiary (LOW confidence)
- None — all claims verified from installed package types or official GitHub examples.

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — version verified from npm registry; type definitions inspected from installed package
- Architecture: HIGH — patterns derived from actual type definitions, not documentation
- Pitfalls: HIGH — default model pitfall verified from source; missing package verified from project package.json
- Error handling: HIGH — error class hierarchy verified from errors.d.ts

**Research date:** 2026-05-02
**Valid until:** 2026-06-01 (SDK is actively developed; check npm for new version before implementing)
