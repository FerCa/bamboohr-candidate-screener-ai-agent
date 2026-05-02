# Phase 3: Agent Evaluation - Pattern Map

**Mapped:** 2026-05-02
**Files analyzed:** 7 (3 new, 4 modified)
**Analogs found:** 7 / 7

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/agent/types.ts` (new) | model/types | transform | `src/rules/types.ts` | role-match |
| `src/agent/evaluator.ts` (new) | service | request-response | `src/pipeline/extract-cv.ts` | role-match |
| `src/agent/prompt.ts` (new) | utility | transform | `src/rules/evaluator.ts` | partial-match |
| `src/config/schema.ts` (modify) | config | transform | `src/config/schema.ts` itself | exact (extension) |
| `config.yaml` (modify) | config | — | `config.yaml` itself | exact (extension) |
| `src/index.ts` (modify) | controller | request-response | `src/index.ts` itself | exact (extension) |
| `src/logger/logger.ts` (modify) | utility | request-response | `src/logger/logger.ts` itself | exact (extension) |

---

## Pattern Assignments

### `src/agent/types.ts` (new — model/types, transform)

**Analog:** `src/rules/types.ts`

**Imports pattern** (lines 1-9 of analog):
```typescript
// src/rules/types.ts — model file uses only inline type definitions; no imports needed.
// Pattern: zero imports in pure-type files. Use `export interface` and string literal unions.
// Phase 3 adds Zod import because EvaluationOutputSchema drives the SDK structured output call.
import { z } from 'zod';
```

**Core type pattern** — interface shape (analog lines 8-29):
```typescript
// src/rules/types.ts — two interfaces: one for internal result, one for log record.
// Phase 3 mirrors this split: EvaluationOutputSchema (GPT-4o response shape)
// + EvaluationResult (log record shape with applicationId/applicantId/timestamp added).

export interface RuleResult {
  outcome: 'pass' | 'fail';
  reasons: string[];
}

export interface CandidateDecision {
  candidateId: number | string;
  applicationId: number | string;
  outcome: 'pass' | 'fail' | 'needsReview' | 'error';
  reasons: string[];
  timestamp: string;  // ISO 8601
}
```

**Phase 3 adaptation — Zod dual-purpose schema pattern** (from RESEARCH.md Pattern 3):
```typescript
// src/agent/types.ts — same z.object() drives both SDK outputType AND z.infer<> TypeScript type.
// Do NOT define a separate interface that can drift from the Zod schema.
import { z } from 'zod';

export const CriterionResultSchema = z.object({
  label: z.string(),
  met: z.boolean(),
  rationale: z.string(),
});

// This schema is passed as outputType to the Agent constructor AND used for z.infer<>.
export const EvaluationOutputSchema = z.object({
  required: z.array(CriterionResultSchema),
  optional: z.array(CriterionResultSchema),
  comment: z.string(),
  outcome: z.enum(['pass', 'fail', 'needsReview']),
});

// Top-level log record: GPT-4o output + IDs + timestamp (IDs/timestamp NOT from GPT-4o).
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

**ESM import convention** (from CONTEXT.md established patterns):
```typescript
// All imports in this project use .js extension even for .ts source files (NodeNext ESM).
// Example from src/rules/evaluator.ts line 6:
import type { Config } from '../config/schema.js';
// Phase 3 downstream callers must import as: import type { EvaluationResult } from '../agent/types.js'
```

---

### `src/agent/evaluator.ts` (new — service, request-response)

**Analog:** `src/pipeline/extract-cv.ts`

**Imports pattern** (analog lines 1-13):
```typescript
// src/pipeline/extract-cv.ts — service file imports types from sibling directories with .js ext.
import pdfParse from 'pdf-parse';
import type { BambooHRClient } from '../bamboohr/client.js';
import type { BambooHRApplication } from '../bamboohr/types.js';
import type { RuleResult } from '../rules/types.js';
import type { CandidateContext, NeedsReviewReason } from './types.js';
```

**Function signature pattern** (analog lines 32-36):
```typescript
// src/pipeline/extract-cv.ts — async function exported by name, typed return Promise<T>.
// Accepts typed dependencies, not raw primitives.
export async function buildCandidateContext(
  client: BambooHRClient,
  detail: BambooHRApplication,
  hardRuleResult: RuleResult,
): Promise<CandidateContext> {
```

**Recoverable-failure / needsReview return pattern** (analog lines 79-86):
```typescript
// src/pipeline/extract-cv.ts — recoverable failures return early with a needsReview object.
// They NEVER throw. Only network/auth errors propagate.
let buffer: Buffer;
let contentType: string;
try {
  ({ buffer, contentType } = await client.downloadPdf(applicationId, applicantId, resumeFileId));
} catch (downloadErr) {
  const message = downloadErr instanceof Error ? downloadErr.message : String(downloadErr);
  console.error(`[extract-cv] PDF download failed for applicationId=${applicationId}: ${message}`);
  return makeNeedsReview(applicationId, applicantId, hardRuleResult, applicationAnswers, 'extraction-failed');
}
```

**Phase 3 adaptation — SDK call with MaxTurnsExceededError catch** (from RESEARCH.md Pattern 2):
```typescript
// evaluateSoftRules() follows the same recoverable/rethrow split as buildCandidateContext():
// - MaxTurnsExceededError + Zod parse failures → return EvaluationResult{outcome:'needsReview'}
// - Network / auth errors → re-throw (caught by outer try/catch in index.ts)
import { run, MaxTurnsExceededError } from '@openai/agents';

try {
  const result = await run(agent, userMessage, { maxTurns: 5 });
  return assembleEvaluationResult(result.finalOutput, ctx);
} catch (err) {
  if (err instanceof MaxTurnsExceededError) {
    return needsReviewResult(ctx, 'agent-max-turns-exceeded');
  }
  throw err;  // network/auth — propagates to outer try/catch in index.ts
}
```

**Agent constructor pattern** (from RESEARCH.md code examples):
```typescript
// MUST specify model: 'gpt-4o' — default is gpt-4.1 (Pitfall 1 in RESEARCH.md).
// outputType accepts z.object() schema — result.finalOutput is typed automatically.
import { Agent } from '@openai/agents';

const agent = new Agent({
  name: 'Candidate Evaluator',
  model: 'gpt-4o',
  instructions: systemPrompt,
  outputType: EvaluationOutputSchema,
});
```

**Helper function pattern for failure cases** (analog lines 138-153):
```typescript
// src/pipeline/extract-cv.ts — small private helper constructs the failure return value.
// Phase 3 mirrors this with a private needsReviewResult() helper.
function makeNeedsReview(
  applicationId: number,
  applicantId: number,
  hardRuleResult: RuleResult,
  applicationAnswers: Record<string, unknown>,
  reason: NeedsReviewReason,
): CandidateContext {
  return {
    applicationId,
    applicantId,
    hardRuleResult,
    cvText: null,
    needsReviewReason: reason,
    applicationAnswers,
  };
}
```

---

### `src/agent/prompt.ts` (new — utility, transform)

**Analog:** `src/rules/evaluator.ts` (pure-function utility, no async, no external calls)

**Imports pattern** (analog lines 1-8):
```typescript
// src/rules/evaluator.ts — utility file imports only types (no runtime deps other than own logic).
import type { Config } from '../config/schema.js';
import type { BambooHRApplication } from '../bamboohr/types.js';
import type { RuleResult } from './types.js';
```

**Pure-function export pattern** (analog lines 50-53):
```typescript
// src/rules/evaluator.ts — single exported function, typed inputs, typed return.
export function evaluateHardRules(
  config: Config,
  application: BambooHRApplication,
): RuleResult {
```

**Phase 3 adaptation — prompt builders are pure string-return functions**:
```typescript
// src/agent/prompt.ts — two named exports, no async, no side effects.
// buildSystemPrompt(): string — accepts softRules shape, returns hardcoded system instructions.
// buildUserMessage(ctx: CandidateContext): string — serializes ctx fields into the user turn.
// The [Auto-screened by AI — final decision rests with recruiter] footer is hardcoded in
// buildSystemPrompt() — not configurable (locked by D-specifics in CONTEXT.md).
export function buildSystemPrompt(softRules: SoftRulesConfig): string { ... }
export function buildUserMessage(ctx: CandidateContext): string { ... }
```

**Comment about what NOT to include in user message** (CONTEXT.md Pitfall 5 / D-07):
```typescript
// The hardRuleResult field of CandidateContext MUST NOT appear in the user message.
// D-07: Comment covers soft evaluation only — hard-rule pass is implicit.
// Either omit hardRuleResult from the serialized context, or explicitly state in
// buildSystemPrompt() "Do not include hard rule results in your comment."
```

---

### `src/config/schema.ts` (modify — config, transform)

**Analog:** `src/config/schema.ts` itself (extension of existing pattern)

**Existing sub-schema pattern** (lines 1-26):
```typescript
// src/config/schema.ts — each rule type has its own named sub-schema.
// Phase 3 follows the same pattern: softRuleEntrySchema for individual rule entries,
// softRulesSchema for the container object.
import { z } from 'zod';

const maxSalaryRuleSchema = z.object({
  value: z.number().positive(),
  label: z.string().min(1),
});

const requiredFieldsRuleSchema = z.object({
  fields: z.array(z.string().min(1)).min(1),
  label: z.string().min(1),
});
```

**Top-level configSchema extension pattern** (lines 28-58):
```typescript
// src/config/schema.ts — new keys added to the existing z.object() block.
// hardRules uses .refine() for cross-field validation.
// Phase 3 adds softRules as an OPTIONAL top-level key (backward-compatible).
export const configSchema = z.object({
  job: z.object({ ... }),
  hardRules: z.object({ ... }).refine(...),
  fieldMap: z.record(z.string(), z.string()),
  // Phase 3 adds here:
  // softRules: softRulesSchema,
});

export type Config = z.infer<typeof configSchema>;
// Config type is re-exported — adding softRules here automatically propagates to all consumers.
```

**Phase 3 softRules sub-schema** (from RESEARCH.md code example):
```typescript
// Mirrors the hard-rule entry pattern: label + description (D-01).
const softRuleEntrySchema = z.object({
  label: z.string().min(1),
  description: z.string().min(1),
});

const softRulesSchema = z.object({
  required: z.array(softRuleEntrySchema).optional().default([]),
  optional: z.array(softRuleEntrySchema).optional().default([]),
}).optional();
// optional() at top level = backward-compatible (existing configs without softRules stay valid).
```

---

### `config.yaml` (modify — config)

**Analog:** `config.yaml` itself (extension of existing block structure)

**Existing block structure** (full file):
```yaml
# config.yaml — existing peer-level blocks: job, hardRules, fieldMap.
# Phase 3 adds softRules as a new peer-level block (same indentation as hardRules).

hardRules:
  maxSalary:
    value: 100000
    label: "Salary above ceiling"
  requiredFields:
    fields:
      - resume
    label: "CV not attached"
```

**Phase 3 softRules block to add** (from CONTEXT.md D-01/D-02 example):
```yaml
softRules:
  required:
    - label: "Strong technical experience"
      description: "Candidate demonstrates 3+ years of relevant engineering experience based on CV"
    - label: "Clear written communication"
      description: "Application answers are articulate, specific, and professional"
  optional:
    - label: "Open-source contributions"
      description: "Candidate has personal or open-source projects relevant to the role"
```

---

### `src/index.ts` (modify — controller, request-response)

**Analog:** `src/index.ts` itself (targeted replacement of lines 119-127)

**Integration point — the pass branch** (lines 98-127):
```typescript
// src/index.ts lines 98-127 — the exact block Phase 3 modifies.
// Lines 119-127 (the placeholder logDecision for pass candidates) are REPLACED.
// Lines 98-118 (ctx construction and needsReviewReason check) are UNCHANGED.

if (result.outcome === 'pass') {
  const ctx: CandidateContext = await buildCandidateContext(client, detail, result);

  if (ctx.needsReviewReason !== null) {
    logDecision({                          // UNCHANGED — stays as-is
      candidateId: detail.applicant.id,
      applicationId: detail.id,
      outcome: 'needsReview',
      reasons: [ctx.needsReviewReason],
      timestamp: new Date().toISOString(),
    });
    needsReview++;
    processed++;
    continue;
  }

  // Lines 119-127 are replaced by Phase 3:
  logDecision({                            // THIS BLOCK IS REPLACED
    candidateId: detail.applicant.id,
    applicationId: detail.id,
    outcome: 'pass',
    reasons: ['CV extracted; pending Phase 3 agent evaluation'],
    timestamp: new Date().toISOString(),
  });
  passed++;
}
```

**Replacement pattern — counter increment based on EvaluationResult.outcome** (from CONTEXT.md integration points):
```typescript
// Phase 3 replacement for lines 119-127:
// evaluateSoftRules() returns EvaluationResult (never throws for recoverable failures).
// Counter increments use result.outcome, not a hardcoded 'pass'.
const evalResult = await evaluateSoftRules(ctx, config.softRules);
logEvaluation(evalResult);
if (evalResult.outcome === 'pass') passed++;
else if (evalResult.outcome === 'fail') failed++;
else needsReview++;
```

**Outer try/catch error pattern** (lines 142-154 — UNCHANGED):
```typescript
// src/index.ts lines 142-154 — outer SAFE-01 catch block. Not modified by Phase 3.
// Network/auth errors from evaluateSoftRules() re-throw and land here.
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
}
```

**ESM import additions needed at top of file** (following lines 9-14 pattern):
```typescript
// Existing imports (lines 9-14) — new Phase 3 imports follow the same pattern.
import { loadConfig, isDryRun } from './config/loader.js';
import { evaluateHardRules } from './rules/evaluator.js';
import { logDecision } from './logger/logger.js';
// Add:
import { evaluateSoftRules } from './agent/evaluator.js';
import { logEvaluation } from './logger/logger.js';
```

---

### `src/logger/logger.ts` (modify — utility, request-response)

**Analog:** `src/logger/logger.ts` itself (add second log function alongside `logDecision`)

**Existing function pattern** (lines 1-16 — full file):
```typescript
// src/logger/logger.ts — single function, process.stdout.write, JSON.stringify + '\n'.
import type { CandidateDecision } from '../rules/types.js';

export type { CandidateDecision };

export function logDecision(record: CandidateDecision): void {
  process.stdout.write(JSON.stringify(record) + '\n');
}
```

**Phase 3 addition pattern** — `logEvaluation()` follows the identical signature and body shape:
```typescript
// Add after logDecision() — same stdout pattern, different type parameter.
// Import EvaluationResult from the new types file (with .js extension per NodeNext ESM).
import type { EvaluationResult } from '../agent/types.js';

export type { EvaluationResult };

export function logEvaluation(record: EvaluationResult): void {
  process.stdout.write(JSON.stringify(record) + '\n');
}
// IMPORTANT: logDecision() is NOT removed or changed. It continues to serve hard-rule fails,
// needsReview-from-PDF, and error paths (D-10).
```

---

## Shared Patterns

### ESM NodeNext `.js` Import Extension
**Source:** Every existing source file — e.g., `src/rules/evaluator.ts` lines 6-8, `src/index.ts` lines 9-14
**Apply to:** All Phase 3 files (`src/agent/types.ts`, `src/agent/evaluator.ts`, `src/agent/prompt.ts`)
```typescript
// Correct (all existing files use this pattern):
import type { Config } from '../config/schema.js';
import { evaluateHardRules } from './rules/evaluator.js';

// Wrong (will fail at Node.js runtime with ERR_MODULE_NOT_FOUND):
import type { Config } from '../config/schema';
import { evaluateHardRules } from './rules/evaluator';
```

### `process.stdout.write` for JSON Log Lines
**Source:** `src/logger/logger.ts` line 15
**Apply to:** `logEvaluation()` in `src/logger/logger.ts`
```typescript
// Use process.stdout.write (not console.log) — avoids any buffering prefix.
// Append '\n' manually — every log line is a complete JSON record.
process.stdout.write(JSON.stringify(record) + '\n');
```

### `console.error` for Diagnostic Messages
**Source:** `src/index.ts` lines 29, 36, 44; `src/pipeline/extract-cv.ts` lines 45, 64, 84
**Apply to:** `src/agent/evaluator.ts` diagnostic logs
```typescript
// stdout is reserved for machine-parseable JSON lines only.
// All human-readable diagnostics go to stderr via console.error with a module prefix.
console.error(`[evaluator] GPT-4o parse failure for applicationId=${applicationId}: ${message}`);
```

### `process.env['VAR_NAME']` Environment Variable Access
**Source:** `src/index.ts` lines 25-26; `src/config/loader.ts` line 39
**Apply to:** `src/agent/evaluator.ts` (OPENAI_API_KEY is read automatically by the SDK — no explicit read needed, but if a guard is added it must follow this pattern)
```typescript
// Bracket notation required — project lint convention from existing code.
const apiKey = process.env['BAMBOOHR_API_KEY'];
// SDK equivalent: OPENAI_API_KEY is read automatically by getDefaultOpenAIKey() in @openai/agents.
// Do NOT pass it manually — CONF-03 compliance is automatic.
```

### Recoverable-Failure Return vs. Re-throw
**Source:** `src/pipeline/extract-cv.ts` lines 79-86, 100-107
**Apply to:** `src/agent/evaluator.ts` — MaxTurnsExceededError and Zod parse failures
```typescript
// Pattern: inner try/catch for recoverable failures → return needsReview result.
// Outer try/catch in index.ts catches everything else (network, auth) → logs 'error'.
try {
  const result = await run(agent, userMessage, { maxTurns: 5 });
  return assembleResult(result.finalOutput, ctx);
} catch (err) {
  if (err instanceof MaxTurnsExceededError) {
    return needsReviewResult(ctx);  // recoverable — return, don't throw
  }
  throw err;  // unrecoverable — propagates to index.ts outer catch
}
```

### `timestamp: new Date().toISOString()` Pattern
**Source:** `src/index.ts` lines 110, 122, 134, 147
**Apply to:** `EvaluationResult` assembly in `src/agent/evaluator.ts`
```typescript
// Consistent ISO 8601 timestamp on every log record.
timestamp: new Date().toISOString(),
```

---

## No Analog Found

All Phase 3 files have analogs in the codebase. No file requires falling back to RESEARCH.md patterns exclusively.

| File | Closest Analog | Gap |
|---|---|---|
| `src/agent/evaluator.ts` | `src/pipeline/extract-cv.ts` | SDK-specific call pattern (Agent, run, MaxTurnsExceededError) has no codebase precedent — use RESEARCH.md Patterns 1 and 2 for those specific lines |

---

## Metadata

**Analog search scope:** `/path/to/project/src/` (all 11 source files)
**Files scanned:** 11 source files + `config.yaml`
**Pattern extraction date:** 2026-05-02
