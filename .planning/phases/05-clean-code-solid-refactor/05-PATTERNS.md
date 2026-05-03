# Phase 5: Clean Code & SOLID Refactor - Pattern Map

**Mapped:** 2026-05-03
**Files analyzed:** 17 (7 modified + 10 new, counting interface file and 4 test files)
**Analogs found:** 17 / 17 (all new files have strong analogs in the existing codebase)

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/index.ts` (modify) | entry-point | request-response | self (decompose) | self |
| `src/bamboohr/client.ts` (modify) | service | request-response | self | self |
| `src/config/loader.ts` (modify) | utility | transform | self | self |
| `src/rules/evaluator.ts` (read-only) | utility | transform | self | self |
| `src/agent/evaluator.ts` (modify) | service | request-response | self | self |
| `src/pipeline/extract-cv.ts` (read-only) | pipeline | file-I/O | self | self |
| `src/logger/logger.ts` (modify) | utility | transform | self | self |
| `src/screener/screening-pipeline.ts` (new) | orchestrator | request-response | `src/index.ts` | exact (extracted from) |
| `src/pipeline/candidate-processor.ts` (new) | pipeline | request-response | `src/index.ts` loop body (lines 89–241) | exact (extracted from) |
| `src/pipeline/live-mode-writer.ts` (new) | service | request-response | `src/index.ts` write blocks (lines 125–139, 176–189, 210–224) | exact (extracted from) |
| `src/pipeline/comment-builder.ts` (new) | utility | transform | `src/index.ts` inline comment strings + `src/agent/prompt.ts` | exact (extracted from) |
| `src/bamboohr/errors.ts` (new) | utility | — | `src/config/loader.ts` error pattern | role-match |
| `src/config/errors.ts` (new) | utility | — | `src/config/loader.ts` error pattern | role-match |
| `src/interfaces/IBambooHRClient.ts` (new) | interface | — | `src/bamboohr/client.ts` method signatures | exact |
| `src/interfaces/ISoftEvaluator.ts` (new) | interface | — | `src/agent/evaluator.ts` function signature | exact |
| `src/interfaces/ILogger.ts` (new) | interface | — | `src/logger/logger.ts` function signatures | exact |
| Test files (new, 4 files) | test | — | `src/rules/evaluator.ts`, `src/pipeline/extract-cv.ts` (pure-function patterns) | role-match |

---

## Pattern Assignments

### `src/index.ts` (modify — thin wiring script after refactor)

**Goal:** Strip all business logic. Becomes ~15-line wiring script. The only remaining
responsibilities are: load env vars, throw on missing vars, construct dependencies, call
`pipeline.run()`, and catch top-level fatal errors for `process.exit(1)`.

**Current imports pattern** (lines 1–18 — keep `dotenv/config` as first import):
```typescript
import 'dotenv/config';  // MUST be first — loads .env before any env var reads

import { loadConfig, isDryRun } from './config/loader.js';
import { BambooHRClient } from './bamboohr/client.js';
```

**After-refactor imports** (replace all existing imports with):
```typescript
import 'dotenv/config';

import { loadConfig, isDryRun } from './config/loader.js';
import { BambooHRClient } from './bamboohr/client.js';
import { JsonLogger } from './logger/logger.js';
import { ScreeningPipeline } from './screener/screening-pipeline.js';
```

**Env-var validation pattern to keep** (lines 32–42):
```typescript
const missingVars = [
  !apiKey && 'BAMBOOHR_API_KEY',
  !subdomain && 'BAMBOOHR_SUBDOMAIN',
  !openaiApiKey && 'OPENAI_API_KEY',
].filter(Boolean);

if (missingVars.length > 0) {
  console.error(`[main] Missing required environment variables: ${missingVars.join(', ')}`);
  console.error('[main] Copy .env.example to .env and fill in your credentials.');
  process.exit(1);
}
```

**Fatal-error catch pattern to keep** (lines 256–259):
```typescript
main().catch((err) => {
  console.error('[main] Fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
```

**D-08 addition — catch named errors before the generic handler:**
```typescript
main().catch((err) => {
  if (err instanceof ConfigError || err instanceof StageValidationError) {
    console.error('[main]', err.message);
  } else {
    console.error('[main] Fatal error:', err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
});
```

---

### `src/bamboohr/client.ts` (modify — add `IBambooHRClient`, replace `process.exit`)

**Analog:** self

**Import pattern** (lines 1–11 — no change):
```typescript
import type { Config } from '../config/schema.js';
import type {
  BambooHRApplication,
  BambooHRStatus,
  ApplicationsResponse,
} from './types.js';
```

**Add import for error class:**
```typescript
import { StageValidationError } from './errors.js';
```

**`validateStages()` — replace `process.exit(1)` with throws** (lines 116–146):

Current pattern at lines 120–124 (fetch failure):
```typescript
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[bamboohr] Failed to fetch pipeline stages: ${message}`);
      process.exit(1);
    }
```
Replace with:
```typescript
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new StageValidationError(`Failed to fetch pipeline stages: ${message}`);
    }
```

Current pattern at lines 140–142 (name mismatch):
```typescript
    if (hasError) {
      process.exit(1);
    }
```
Replace with:
```typescript
    if (hasError) {
      throw new StageValidationError(
        `One or more configured stage names were not found in BambooHR. Available stages: ${available}`,
      );
    }
```

**Variable rename in `fetchCandidates()`** (line 201): rename `all` → `applications`:
```typescript
// Before:
const all: BambooHRApplication[] = [];
// After:
const applications: BambooHRApplication[] = [];
```

---

### `src/config/loader.ts` (modify — replace `process.exit` with `ConfigError` throws)

**Analog:** self

**Add import:**
```typescript
import { ConfigError } from './errors.js';
```

**Current pattern — file-read failure** (lines 17–22):
```typescript
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[config] Failed to read or parse config file: ${configPath}`);
    console.error(`[config] Error: ${message}`);
    process.exit(1);
  }
```
Replace with:
```typescript
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`Failed to read or parse config file "${configPath}": ${message}`);
  }
```

**Current pattern — schema validation failure** (lines 26–31):
```typescript
  if (!result.success) {
    console.error(`[config] Invalid configuration in: ${configPath}`);
    console.error('[config] Validation errors:');
    console.error(JSON.stringify(result.error.format(), null, 2));
    process.exit(1);
  }
```
Replace with:
```typescript
  if (!result.success) {
    const details = JSON.stringify(result.error.format(), null, 2);
    throw new ConfigError(`Invalid configuration in "${configPath}":\n${details}`);
  }
```

---

### `src/rules/evaluator.ts` (read-only — no changes to internals)

**Role:** Pure function — directly testable without mocks. No interface needed (D-07).

**Signature to copy for test file** (lines 50–53):
```typescript
export function evaluateHardRules(
  config: Config,
  application: BambooHRApplication,
): RuleResult {
```

**Collect-all invariant** (critical — verified by tests): Every rule block runs to completion.
No `return` inside any rule block. The `reasons.push(label)` calls accumulate before the
single `return` at lines 141–144:
```typescript
  return {
    outcome: reasons.length === 0 ? 'pass' : 'fail',
    reasons,
  };
```

---

### `src/agent/evaluator.ts` (modify — wrap behind `ISoftEvaluator`)

**Analog:** self + `src/pipeline/extract-cv.ts` (same recoverable-vs-rethrow split)

**D-05 decision:** `ISoftEvaluator` is a class-shaped interface with an `evaluate()` method.
`evaluateSoftRules` becomes a concrete class `SoftEvaluator` implementing `ISoftEvaluator`.

**Variable rename** (line 77): rename `out` → `agentOutput`:
```typescript
// Before:
const out = result.finalOutput;
// After:
const agentOutput = result.finalOutput;
```

**Recoverable-vs-rethrow split to preserve** (lines 93–104):
```typescript
  } catch (err) {
    if (err instanceof MaxTurnsExceededError) {
      console.error(
        `[evaluator] Max turns (5) exceeded for applicationId=${ctx.applicationId}`,
      );
      return needsReviewResult(ctx);
    }
    // Network / auth / unexpected errors — re-throw
    throw err;
  }
```

**`SoftRulesInput` local interface** (lines 21–24) — preserve as-is for decoupling:
```typescript
interface SoftRulesInput {
  required: Array<{ label: string; description: string }>;
  optional: Array<{ label: string; description: string }>;
}
```

---

### `src/pipeline/extract-cv.ts` (read-only — no changes)

**Role:** Pure-ish async function — directly testable with a mocked `IBambooHRClient`.

**Recoverable-vs-rethrow split** (lines 79–86 — canonical pattern for this codebase):
```typescript
  try {
    ({ buffer, contentType } = await client.downloadPdf(applicationId, applicantId, resumeFileId));
  } catch (downloadErr) {
    const message = downloadErr instanceof Error ? downloadErr.message : String(downloadErr);
    console.error(`[extract-cv] PDF download failed for applicationId=${applicationId}: ${message}`);
    return makeNeedsReview(applicationId, applicantId, hardRuleResult, applicationAnswers, 'extraction-failed');
  }
```

**`makeNeedsReview` factory** (lines 138–153) — pattern for `CandidateProcessor` result factories:
```typescript
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

### `src/logger/logger.ts` (modify — extract `JsonLogger` class implementing `ILogger`)

**Analog:** self

**Current function signatures to preserve as class methods** (lines 15–17, 29–31):
```typescript
export function logDecision(record: CandidateDecision): void {
  process.stdout.write(JSON.stringify(record) + '\n');
}

export function logEvaluation(record: EvaluationResult): void {
  process.stdout.write(JSON.stringify(record) + '\n');
}
```

**After-refactor shape** — keep free functions as thin wrappers or rename to class:
```typescript
import type { ILogger } from '../interfaces/ILogger.js';

export class JsonLogger implements ILogger {
  logDecision(record: CandidateDecision): void {
    process.stdout.write(JSON.stringify(record) + '\n');
  }
  logEvaluation(record: EvaluationResult): void {
    process.stdout.write(JSON.stringify(record) + '\n');
  }
}
```

Note: `process.stdout.write` (not `console.log`) — avoids any buffering prefix. Keep this.

---

### `src/screener/screening-pipeline.ts` (new — orchestrator)

**Analog:** `src/index.ts` — the startup/fetch/loop/summary logic (lines 19–253)

**Constructor pattern** — D-01 from CONTEXT.md, using full descriptive names (D-12/D-13):
```typescript
export class ScreeningPipeline {
  constructor(private readonly bambooHrClient: IBambooHRClient,
              private readonly candidateProcessor: CandidateProcessor,
              private readonly logger: ILogger,
              private readonly config: Config,
              private readonly dryRun: boolean) {}

  async run(): Promise<void> { ... }
}
```

**Startup-log pattern from `index.ts`** (lines 46–48 — `console.error` not `ILogger`):
```typescript
console.error(`[main] Mode: ${dryRun ? 'DRY_RUN (no writes)' : 'LIVE MODE — writes enabled'}`);
console.error(`[main] Config: ${configPath}`);
console.error(`[main] Job opening: ${config.job.openingId}`);
```

**`validateStages` call pattern** (lines 55–58):
```typescript
console.error('[main] Validating pipeline stages against BambooHR...');
const stageMap = await client.validateStages(config);
console.error('[main] Pipeline stages validated.');
```

**`fetchCandidates` call pattern** (lines 62–74):
```typescript
const intakeStageName = config.job.stages.intake;
const intakeId = stageMap.get(intakeStageName);
if (intakeId === undefined) {
  // Now throws instead of process.exit — StageValidationError propagates to main()
  throw new StageValidationError(`Intake stage "${intakeStageName}" not found in stageMap.`);
}
const applications = await bambooHrClient.fetchCandidates(
  config.job.openingId,
  String(intakeId),
);
```

**Counter aggregation pattern** (lines 78–82 — preserve field names):
```typescript
let processed = 0;
let passed = 0;
let failed = 0;
let errors = 0;
let needsReview = 0;
```

**SAFE-01 per-candidate loop** (lines 89–242 — the loop structure moves to `ScreeningPipeline`,
the body moves to `CandidateProcessor`):
```typescript
for (const application of applications) {
  try {
    const outcome = await this.candidateProcessor.process(application, stageMap);
    // increment counters from outcome
    processed++;
  } catch (err) {
    // SAFE-01: log error, continue — never re-throw from this loop
    const message = err instanceof Error ? err.message : String(err);
    this.logger.logDecision({
      candidateId: application?.applicant?.id ?? 'unknown',
      applicationId: application?.id ?? 'unknown',
      outcome: 'error',
      reasons: [message],
      timestamp: new Date().toISOString(),
    });
    errors++;
  }
}
```

**Summary pattern** (lines 245–252 — preserve stdout/stderr split):
```typescript
console.error(
  `[main] Done. processed=${processed} pass=${passed} fail=${failed} needsReview=${needsReview} errors=${errors}`,
);
console.log(
  JSON.stringify({ processed, pass: passed, fail: failed, needsReview, errors }),
);
```

---

### `src/pipeline/candidate-processor.ts` (new — per-candidate pipeline)

**Analog:** `src/index.ts` loop body (lines 89–241) — the try block inside the for-of loop

**Constructor pattern** — inject all dependencies (D-02 from CONTEXT.md):
```typescript
export class CandidateProcessor {
  constructor(
    private readonly bambooHrClient: IBambooHRClient,
    private readonly softEvaluator: ISoftEvaluator,
    private readonly logger: ILogger,
    private readonly liveWriter: LiveModeWriter,
    private readonly config: Config,
    private readonly dryRun: boolean,
  ) {}

  async process(
    application: BambooHRApplication,
    stageMap: Map<string, number>,
  ): Promise<CandidateOutcome> { ... }
}
```

**`CandidateOutcome` typed return** — define alongside the class:
```typescript
export type CandidateOutcome = 'pass' | 'fail' | 'needsReview' | 'error';
```

**Hard-rule → CV → soft pipeline sequence** (from `index.ts` lines 93–198):
```typescript
const applicationDetail = await this.bambooHrClient.fetchApplicationDetails(application.id);
const hardRuleResult = evaluateHardRules(this.config, applicationDetail);

if (hardRuleResult.outcome === 'pass') {
  const candidateContext = await buildCandidateContext(
    this.bambooHrClient, applicationDetail, hardRuleResult,
  );

  if (candidateContext.needsReviewReason !== null) {
    // needsReview path — log + optional write
    this.logger.logDecision({ ... outcome: 'needsReview' });
    if (!this.dryRun) {
      await this.liveWriter.write(
        applicationDetail.id,
        CommentBuilder.needsReview(candidateContext.needsReviewReason),
        stageMap.get(this.config.job.stages.fail)!,
      );
    }
    return 'needsReview';
  }

  // soft eval
  let evalResult: EvaluationResult;
  if (this.dryRun) {
    evalResult = { /* dry-run stub */ };
  } else {
    evalResult = await this.softEvaluator.evaluate(candidateContext, this.config.softRules);
  }
  this.logger.logEvaluation(evalResult);

  if (!this.dryRun) {
    await this.liveWriter.write(
      evalResult.applicationId,
      evalResult.comment,
      stageMap.get(targetStageName)!,
    );
  }
  return evalResult.outcome;
} else {
  // hard-rule fail path
  this.logger.logDecision({ ... outcome: 'fail' });
  if (!this.dryRun) {
    await this.liveWriter.write(
      applicationDetail.id,
      CommentBuilder.hardRuleFail(hardRuleResult.reasons),
      stageMap.get(this.config.job.stages.fail)!,
    );
  }
  return 'fail';
}
```

**Dry-run EvaluationResult stub** (from `index.ts` lines 157–165 — copy verbatim):
```typescript
evalResult = {
  applicationId: candidateContext.applicationId,
  applicantId: candidateContext.applicantId,
  outcome: 'pass',
  required: [],
  optional: [],
  comment: '[DRY_RUN] Soft evaluation skipped — no API call made.',
  timestamp: new Date().toISOString(),
};
```

---

### `src/pipeline/live-mode-writer.ts` (new — atomicity owner)

**Analog:** `src/index.ts` write blocks (lines 125–139, 176–189, 210–224)

**Class shape** — thin; enforces comment-before-stage invariant:
```typescript
export class LiveModeWriter {
  constructor(private readonly bambooHrClient: IBambooHRClient) {}

  /**
   * Post comment then move stage. Atomicity: if postComment throws, moveStage never runs.
   * Any throw propagates to CandidateProcessor's per-candidate try/catch (SAFE-01).
   */
  async write(applicationId: number, comment: string, stageId: number): Promise<void> {
    await this.bambooHrClient.postComment(applicationId, comment);
    await this.bambooHrClient.moveStage(applicationId, stageId);
  }
}
```

**The three write call-sites in `index.ts` that become `liveWriter.write(...)` calls:**

needsReview write (lines 125–139):
```typescript
await client.postComment(detail.id, needsReviewComment);
await client.moveStage(detail.id, reviewedStageId);
```

soft-eval write (lines 187–188):
```typescript
await client.postComment(evalResult.applicationId, evalResult.comment);
await client.moveStage(evalResult.applicationId, targetStageId);
```

hard-rule-fail write (lines 222–223):
```typescript
await client.postComment(detail.id, hardRuleComment);
await client.moveStage(detail.id, failStageId);
```

---

### `src/pipeline/comment-builder.ts` (new — static comment factories)

**Analog:** `src/index.ts` inline comment template literals (lines 126–130, 211–215) +
`src/agent/prompt.ts` (pure-function, no side effects, local interface pattern)

**Class shape** — all static, no constructor:
```typescript
export class CommentBuilder {
  static softEval(result: EvaluationResult): string { ... }
  static hardRuleFail(reasons: string[]): string { ... }
  static needsReview(reason: NeedsReviewReason): string { ... }
}
```

**`hardRuleFail` source string** (from `index.ts` lines 211–215 — copy exactly):
```typescript
const hardRuleComment = [
  'FAIL — Hard rules',
  result.reasons.map((r) => `• ${r}`).join('\n'),
  '[Auto-screened by AI — final decision rests with recruiter]',
].join('\n\n');
```

**`needsReview` source string** (from `index.ts` lines 126–130 — copy exactly):
```typescript
const needsReviewComment = [
  'NEEDS REVIEW — Automated screening incomplete',
  ctx.needsReviewReason,
  '[Auto-screened by AI — final decision rests with recruiter]',
].join('\n\n');
```

**`softEval` source:** `evalResult.comment` — this is already the complete formatted string
built by GPT-4o (see `src/agent/types.ts` line 69: "Recruiter-ready formatted comment").
`CommentBuilder.softEval(result)` simply returns `result.comment` unchanged.

---

### `src/bamboohr/errors.ts` (new — named error class)

**Analog:** Standard `Error` subclass — no direct analog in the codebase yet, but the
error-message conventions (`[bamboohr]` prefix) come from `src/bamboohr/client.ts` lines
121–123.

**Pattern** (D-09 from CONTEXT.md):
```typescript
// src/bamboohr/errors.ts
export class StageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StageValidationError';
  }
}
```

Note: `this.name = 'StageValidationError'` required for correct `instanceof` + `err.name`
in Node.js ESM. TypeScript strict mode requires calling `super(message)` first.

---

### `src/config/errors.ts` (new — named error class)

**Analog:** Same pattern as `src/bamboohr/errors.ts` above. Error-message conventions come
from `src/config/loader.ts` lines 19–21 (`[config]` prefix).

```typescript
// src/config/errors.ts
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}
```

---

### `src/interfaces/IBambooHRClient.ts` (new — structural interface)

**Analog:** `src/bamboohr/client.ts` — every public method becomes an interface member

**All public methods to mirror** (from `client.ts`):
```typescript
export interface IBambooHRClient {
  get<T>(path: string, params?: Record<string, string>): Promise<T>;
  postComment(applicationId: number, comment: string): Promise<void>;
  moveStage(applicationId: number, stageId: number): Promise<void>;
  validateStages(config: Config): Promise<Map<string, number>>;
  fetchApplicationDetails(id: number): Promise<BambooHRApplication>;
  downloadPdf(applicationId: number, applicantId: number, fileId: number): Promise<{ buffer: Buffer; contentType: string }>;
  fetchCandidates(jobId: string, statusId: string): Promise<BambooHRApplication[]>;
}
```

Note: No `implements IBambooHRClient` on `BambooHRClient` — TypeScript structural typing
satisfies the interface implicitly (D-05 from CONTEXT.md). A JSDoc comment on the class
should document this relationship.

---

### `src/interfaces/ISoftEvaluator.ts` (new — structural interface)

**Analog:** `src/agent/evaluator.ts` function signature (lines 37–40)

**D-05 decision:** Interface uses method shape (`evaluate`), not function shape, so it is
injectable as a class constructor parameter.

```typescript
import type { CandidateContext } from '../pipeline/types.js';
import type { EvaluationResult } from '../agent/types.js';

// Mirrors Config['softRules'] shape — local type to avoid coupling to Zod config
interface SoftRulesInput {
  required: Array<{ label: string; description: string }>;
  optional: Array<{ label: string; description: string }>;
}

export interface ISoftEvaluator {
  evaluate(
    candidateContext: CandidateContext,
    softRules: SoftRulesInput | undefined,
  ): Promise<EvaluationResult>;
}
```

The existing `evaluateSoftRules` function becomes `SoftEvaluator.evaluate()` — same
parameter names (using full names per D-12: `candidateContext` not `ctx`).

---

### `src/interfaces/ILogger.ts` (new — structural interface)

**Analog:** `src/logger/logger.ts` function signatures (lines 15, 29)

```typescript
import type { CandidateDecision } from '../rules/types.js';
import type { EvaluationResult } from '../agent/types.js';

export interface ILogger {
  logDecision(record: CandidateDecision): void;
  logEvaluation(record: EvaluationResult): void;
}
```

---

### Test files — `src/__tests__/` (4 new files)

**Analog (structure):** `src/rules/evaluator.ts` (pure-function, no mocks needed) and
`src/pipeline/extract-cv.ts` (dependency-injected, mockable `client` param).

**No vitest config exists yet.** Vitest works with the existing `"type": "module"` in
`package.json` and `NodeNext` resolution in `tsconfig.json`. The planner must add:
- `vitest` to `devDependencies`
- A `"test": "vitest run"` script in `package.json`
- A `vitest.config.ts` with `{ test: { environment: 'node' } }` (or inline config in
  `package.json` as `"vitest"` key)

**Test file: `src/__tests__/evaluateHardRules.test.ts`**
Analog: the function itself (`src/rules/evaluator.ts`) — pure function, no mocks.
Pattern: import `evaluateHardRules` directly, pass fabricated `Config` + `BambooHRApplication`
objects. All 4 rule types, pass/fail branches, collect-all behavior (multiple rules, all
reasons accumulated).

**Test file: `src/__tests__/CommentBuilder.test.ts`**
Analog: `src/agent/prompt.ts` — pure-function module, no async, no side effects.
Pattern: import `CommentBuilder`, call each static method with known inputs, assert exact
output strings match the `index.ts` source templates (lines 126–130, 211–215).

**Test file: `src/__tests__/CandidateProcessor.test.ts`**
Analog: `src/pipeline/extract-cv.ts` (injectable `client: BambooHRClient` param).
Pattern: construct `CandidateProcessor` with `vi.fn()` mocks for `IBambooHRClient`,
`ISoftEvaluator`, `ILogger`, `LiveModeWriter`. Test all outcome paths: pass, fail,
needsReview (from CV), needsReview (from agent), error propagation.

Mock shape for `IBambooHRClient` in tests:
```typescript
const mockClient: IBambooHRClient = {
  fetchApplicationDetails: vi.fn().mockResolvedValue(fakeApplicationDetail),
  postComment: vi.fn().mockResolvedValue(undefined),
  moveStage: vi.fn().mockResolvedValue(undefined),
  // ... other methods as vi.fn() stubs
};
```

**Test file: `src/__tests__/ScreeningPipeline.test.ts`**
Pattern: mock `bambooHrClient.fetchCandidates` to return N applications. Mock
`bambooHrClient.validateStages` to return a stub `stageMap`. Mock
`CandidateProcessor.process` with `vi.fn()`. Assert it is called N times and summary
counters match the mocked return values.

---

## Shared Patterns

### ESM Import Extensions
**Apply to:** Every new `.ts` file in this project.
**Rule:** All imports of project-internal modules must end in `.js` (NodeNext resolution).
**Source:** All existing files — e.g., `src/index.ts` line 9:
```typescript
import { loadConfig, isDryRun } from './config/loader.js';
```

### `console.error` vs `ILogger`
**Apply to:** `ScreeningPipeline`, `CandidateProcessor`, all infrastructure code.
**Rule:** `console.error` for diagnostic/operational messages (mode, counts, warnings).
`ILogger` (`logDecision` / `logEvaluation`) for per-candidate structured JSON records to stdout.
**Source:** `src/index.ts` lines 46 (`console.error`) vs line 116 (`logDecision`).

### Error Message Pattern (`err instanceof Error ? err.message : String(err)`)
**Apply to:** Every `catch` block.
**Source:** `src/index.ts` line 231, `src/bamboohr/client.ts` line 122, `src/pipeline/extract-cv.ts` line 83:
```typescript
const message = err instanceof Error ? err.message : String(err);
```

### Recoverable-vs-Rethrow Split
**Apply to:** `CandidateProcessor.process()`, `SoftEvaluator.evaluate()`.
**Rule:** SDK/domain-specific recoverable errors → return `needsReview` result.
Network/auth/unexpected errors → re-throw to outer `try/catch`.
**Source (canonical):** `src/pipeline/extract-cv.ts` lines 79–86 and `src/agent/evaluator.ts` lines 93–104.

### `process.stdout.write` for JSON Records
**Apply to:** `JsonLogger` implementation.
**Rule:** Use `process.stdout.write(JSON.stringify(record) + '\n')` — NOT `console.log`.
**Source:** `src/logger/logger.ts` lines 16, 30.

### TypeScript Strict + No `any`
**Apply to:** All new files.
**Rule:** `tsconfig.json` has `"strict": true`. No `any` casts in new code. Use `unknown`
for untyped external data and narrow with `instanceof` or type guards.
**Source:** `tsconfig.json` line 8 + existing files use `Record<string, unknown>` throughout.

### Full Descriptive Variable Names (D-12/D-13)
**Apply to:** All new and modified files.
**Substitution table:**
| Short name | Full name |
|---|---|
| `client` | `bambooHrClient` |
| `detail` | `applicationDetail` |
| `ctx` | `candidateContext` |
| `all` | `applications` |
| `out` | `agentOutput` |
| `result` (for `RuleResult`) | `hardRuleResult` |

---

## No Analog Found

All files in this phase have analogs. No entries.

---

## Metadata

**Analog search scope:** `/Users/ferrancaellas/projects/bamboohr-candidate-screener-ai-agent/src/`
**Files scanned:** 14 source files (all existing `.ts` files)
**Pattern extraction date:** 2026-05-03
