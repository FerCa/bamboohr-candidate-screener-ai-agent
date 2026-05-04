# Phase 6: Multi-Job Refactor - Pattern Map

**Mapped:** 2026-05-04
**Files analyzed:** 8 (4 create/rename, 4 modify)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/screener/job-runner.ts` | orchestrator | request-response | `src/screener/screening-pipeline.ts` | exact (rename + Config shape update) |
| `src/screener/multi-job-orchestrator.ts` | orchestrator | batch | `src/screener/screening-pipeline.ts` | role-match (same DI pattern, loop wraps it) |
| `src/__tests__/JobRunner.test.ts` | test | request-response | `src/__tests__/ScreeningPipeline.test.ts` | exact (rename + Config shape update) |
| `src/__tests__/MultiJobOrchestrator.test.ts` | test | batch | `src/__tests__/ScreeningPipeline.test.ts` | role-match (same mock helpers, new test cases) |
| `src/config/schema.ts` | config | transform | `src/config/schema.ts` (self) | self-extension |
| `src/config/loader.ts` | config | transform | `src/config/loader.ts` (self) | self-extension |
| `src/config/types.ts` | config | transform | `src/config/types.ts` (self) | self-extension |
| `src/index.ts` | entrypoint | request-response | `src/index.ts` (self) | self-modification |

---

## Pattern Assignments

### `src/screener/job-runner.ts` (orchestrator, request-response)

**Analog:** `src/screener/screening-pipeline.ts`

This file IS the renamed `screening-pipeline.ts`. The class is renamed from `ScreeningPipeline` to
`JobRunner`. The Config shape changes (`config.job.*` → `config.jobs[i].*` or a per-job slice).
All other logic — constructor signature, run() body, counter pattern, SAFE-01 catch — is preserved
exactly.

**Decision (Claude's Discretion):** `JobRunner` should accept a single per-job config slice
(`JobConfig`) rather than the full `Config` + an index. This keeps `MultiJobOrchestrator`
responsible for slicing and keeps `JobRunner` independent. The per-job slice type is extracted from
the `jobsSchema` Zod definition (see schema.ts pattern below).

**Imports pattern** (lines 1–16 of analog):
```typescript
import type { IBambooHRClient } from '../interfaces/IBambooHRClient.js';
import type { ILogger } from '../interfaces/ILogger.js';
import { CandidateProcessor } from '../pipeline/candidate-processor.js';
import { StageValidationError } from '../bamboohr/errors.js';
```

New import to add (replaces `import type { Config } from '../config/schema.js'`):
```typescript
import type { JobConfig } from '../config/schema.js';
```

**Constructor signature pattern** (lines 18–25 of analog):
```typescript
export class JobRunner {
  constructor(
    private readonly bambooHrClient: IBambooHRClient,
    private readonly candidateProcessor: CandidateProcessor,
    private readonly logger: ILogger,
    private readonly job: JobConfig,   // ← per-job slice, not full Config
    private readonly dryRun: boolean,
  ) {}
```

**run() return type change** — returns `JobResult` instead of `void`:
```typescript
async run(): Promise<JobResult> {
  // ... same pipeline body ...
  return { openingId: this.job.openingId, processed, pass: passed, fail: failed, needsReview, errors };
}
```

Where `JobResult` is a plain object type defined locally or in a shared types file:
```typescript
export type JobResult =
  | { openingId: string; processed: number; pass: number; fail: number; needsReview: number; errors: number }
  | { openingId: string; error: true; errorReason: string };
```

**Config reference update** — replace all `this.config.job.*` with `this.job.*`:
- `this.config.job.openingId` → `this.job.openingId`
- `this.config.job.stages.intake` → `this.job.stages.intake`
- `this.config.job.stages.pass` → `this.job.stages.pass`
- `this.config.job.stages.fail` → `this.job.stages.fail`

**validateStages call** — `validateStages(config: Config)` currently takes a full `Config`. After
the schema refactor, this signature must also accept the new shape. See IBambooHRClient.ts pattern
below for the interface update.

**SAFE-01 per-candidate catch pattern** (lines 70–93 of analog — preserve exactly):
```typescript
for (const application of applications) {
  try {
    const outcome = await this.candidateProcessor.process(application, stageMap);
    if (outcome === 'pass') { passed++; }
    else if (outcome === 'fail') { failed++; }
    else { needsReview++; }
    processed++;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    this.logger.logDecision({
      candidateId: application?.applicant?.id ?? 'unknown',
      applicationId: application?.id ?? 'unknown',
      outcome: 'error',
      reasons: [message],
      timestamp: new Date().toISOString(),
    });
    errors++;
    // NOTE: do NOT re-throw — continue to next candidate (SAFE-01)
  }
}
```

---

### `src/screener/multi-job-orchestrator.ts` (orchestrator, batch)

**Analog:** `src/screener/screening-pipeline.ts`

New file. Follows the exact same DI-via-constructor pattern as `ScreeningPipeline`. Loops over
`config.jobs[]`, instantiates one `JobRunner` per job, runs them sequentially, catches
`StageValidationError` per job to prevent abort propagation (D-09), aggregates results, and emits
the multi-job JSON summary (D-08/D-09) to stdout.

`process.exit` is NOT called here — only in `src/index.ts` (established constraint from Phase 5).

**Imports pattern** (copy and extend from screening-pipeline.ts analog):
```typescript
import type { IBambooHRClient } from '../interfaces/IBambooHRClient.js';
import type { ISoftEvaluator } from '../interfaces/ISoftEvaluator.js';
import type { ILogger } from '../interfaces/ILogger.js';
import type { Config } from '../config/schema.js';
import { CandidateProcessor } from '../pipeline/candidate-processor.js';
import { LiveModeWriter } from '../pipeline/live-mode-writer.js';
import { JobRunner } from './job-runner.js';
import { StageValidationError } from '../bamboohr/errors.js';
```

**Constructor signature** (mirrors ScreeningPipeline pattern — full Config + shared deps):
```typescript
export class MultiJobOrchestrator {
  constructor(
    private readonly bambooHrClient: IBambooHRClient,
    private readonly softEvaluator: ISoftEvaluator,
    private readonly logger: ILogger,
    private readonly liveWriter: LiveModeWriter,
    private readonly config: Config,
    private readonly dryRun: boolean,
  ) {}
```

**run() pattern** (per-job loop, SAFE at job level, aggregate result):
```typescript
async run(): Promise<void> {
  const jobResults: JobResult[] = [];

  for (const job of this.config.jobs) {
    try {
      const candidateProcessor = new CandidateProcessor(
        this.bambooHrClient,
        this.softEvaluator,
        this.logger,
        this.liveWriter,
        job,
        this.dryRun,
      );
      const runner = new JobRunner(
        this.bambooHrClient,
        candidateProcessor,
        this.logger,
        job,
        this.dryRun,
      );
      const result = await runner.run();
      jobResults.push(result);
    } catch (err) {
      // D-09: per-job error isolation — StageValidationError and other throws
      // do not abort remaining jobs.
      const errorReason = err instanceof Error ? err.message : String(err);
      jobResults.push({ openingId: job.openingId, error: true, errorReason });
    }
  }

  // D-08/D-09: aggregate totals (exclude error jobs from totals)
  const successJobs = jobResults.filter((r): r is SuccessJobResult => !('error' in r));
  const totals = {
    processed: sum(successJobs, 'processed'),
    pass:      sum(successJobs, 'pass'),
    fail:      sum(successJobs, 'fail'),
    needsReview: sum(successJobs, 'needsReview'),
    errors:    sum(successJobs, 'errors'),
  };

  // stderr: human-readable summary
  console.error(`[main] Done. jobs=${jobResults.length} totals=${JSON.stringify(totals)}`);
  // stdout: machine-readable JSON (INFRA-03, D-08)
  console.log(JSON.stringify({ jobs: jobResults, totals }));
  // D-10: always exit 0 — run() resolves, never rejects
}
```

**Error handling** — `StageValidationError` caught at job level (not propagated). Any other
unexpected throw is also caught by the same catch block and recorded as `error: true`. The run
itself never rejects — `main()` in index.ts should not need to catch `MultiJobOrchestrator.run()`.

---

### `src/__tests__/JobRunner.test.ts` (test, request-response)

**Analog:** `src/__tests__/ScreeningPipeline.test.ts`

This file IS the renamed `ScreeningPipeline.test.ts`. Changes are mechanical:
1. `import { ScreeningPipeline }` → `import { JobRunner }`
2. `makeConfig()` returns a config with a per-job slice shape (`job` key still used only for
   constructing the fixture — the `JobRunner` constructor receives `config.jobs[0]`)
3. All `new ScreeningPipeline(...)` → `new JobRunner(...)`
4. `describe('ScreeningPipeline.run', ...)` → `describe('JobRunner.run', ...)`

**makeConfig() helper** (lines 15–22 of analog — update shape):
```typescript
function makeJobConfig(): JobConfig {
  return {
    openingId: 'job-1',
    stages: { intake: 'New', pass: 'Schedule Phone Screen', fail: 'Reviewed' },
    hardRules: { maxSalary: { value: 100000, label: 'Salary above ceiling' } },
    fieldMap: { salary: 'desiredSalary' },
    softRules: undefined,
  } as JobConfig;
}
```

**makeBambooMock() helper** (lines 41–50 of analog — preserve exactly):
```typescript
function makeBambooMock(applications: BambooHRApplication[] = []): IBambooHRClient {
  return {
    get: vi.fn(),
    postComment: vi.fn(),
    moveStage: vi.fn(),
    validateStages: vi.fn().mockResolvedValue(makeStageMap()),
    fetchApplicationDetails: vi.fn(),
    downloadPdf: vi.fn(),
    fetchCandidates: vi.fn().mockResolvedValue(applications),
  } as unknown as IBambooHRClient;
}
```

**makeLoggerMock() helper** (lines 52–54 of analog — preserve exactly):
```typescript
function makeLoggerMock(): ILogger {
  return { logDecision: vi.fn(), logEvaluation: vi.fn() };
}
```

**makeProcessorMock() helper** (lines 56–67 of analog — update Config reference to JobConfig):
```typescript
function makeProcessorMock(processImpl: ...): CandidateProcessor {
  const bambooMock = makeBambooMock();
  const softMock: ISoftEvaluator = { evaluate: vi.fn() };
  const loggerMock = makeLoggerMock();
  const liveWriter = new LiveModeWriter(bambooMock);
  const proc = new CandidateProcessor(
    bambooMock, softMock, loggerMock, liveWriter, makeJobConfig(), true,
  );
  proc.process = vi.fn(processImpl) as unknown as CandidateProcessor['process'];
  return proc;
}
```

**Test spy pattern** (lines 70–79 of analog — preserve exactly):
```typescript
let stdoutSpy: ReturnType<typeof vi.spyOn>;
let stderrSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  stdoutSpy.mockRestore();
  stderrSpy.mockRestore();
});
```

**Existing test cases** — all 4 existing cases transfer directly, with updated JSON shape. The
`JSON.stringify` assertion for the zero-candidate case changes from the flat single-job shape to the
per-job `JobResult` shape returned by `JobRunner.run()`:
```typescript
// Old (ScreeningPipeline emits flat JSON to stdout)
expect(stdoutSpy).toHaveBeenCalledWith(
  JSON.stringify({ processed: 0, pass: 0, fail: 0, needsReview: 0, errors: 0 }),
);
// New (JobRunner returns a JobResult object — stdout is emitted by MultiJobOrchestrator)
// JobRunner.run() no longer calls console.log — it returns the JobResult
// So stdoutSpy assertions are REMOVED from JobRunner tests
```

---

### `src/__tests__/MultiJobOrchestrator.test.ts` (test, batch)

**Analog:** `src/__tests__/ScreeningPipeline.test.ts`

New file. Uses the same mock helper factories as the analog. Tests cover:
1. N-job iteration — all jobs processed when none throw
2. Per-job failure isolation — one job throwing `StageValidationError` does not abort others
3. Aggregate count correctness — `totals` matches sum of successful job results
4. Error job representation — failed jobs appear with `error: true, errorReason` (D-09)
5. Exit code 0 — `run()` resolves (does not reject) even when all jobs fail

**Imports pattern** (extend from ScreeningPipeline.test.ts analog):
```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MultiJobOrchestrator } from '../screener/multi-job-orchestrator.js';
import { JobRunner } from '../screener/job-runner.js';
import { StageValidationError } from '../bamboohr/errors.js';
import type { IBambooHRClient } from '../interfaces/IBambooHRClient.js';
import type { ISoftEvaluator } from '../interfaces/ISoftEvaluator.js';
import type { ILogger } from '../interfaces/ILogger.js';
import type { Config } from '../config/schema.js';
```

**makeConfig() helper for multi-job** (2-job fixture):
```typescript
function makeConfig(jobCount = 2): Config {
  const jobs = Array.from({ length: jobCount }, (_, i) => ({
    openingId: `job-${i + 1}`,
    stages: { intake: 'New', pass: 'Pass', fail: 'Fail' },
    hardRules: { maxSalary: { value: 100000, label: 'Salary ceiling' } },
    fieldMap: { salary: 'desiredSalary' },
    softRules: undefined,
  }));
  return { jobs } as Config;
}
```

**Mock strategy (Claude's Discretion):** Mock `JobRunner.run` at the class level using `vi.spyOn`
or by injecting a factory function. Preferred approach: spy on `JobRunner.prototype.run` before
construction so the orchestrator's internal `new JobRunner(...)` picks up the mock:
```typescript
const runSpy = vi.spyOn(JobRunner.prototype, 'run').mockResolvedValue({
  openingId: 'job-1', processed: 3, pass: 2, fail: 1, needsReview: 0, errors: 0,
});
```

**stdout assertion pattern** (D-08 JSON shape):
```typescript
expect(stdoutSpy).toHaveBeenCalledWith(
  JSON.stringify({
    jobs: [
      { openingId: 'job-1', processed: 3, pass: 2, fail: 1, needsReview: 0, errors: 0 },
      { openingId: 'job-2', processed: 2, pass: 1, fail: 1, needsReview: 0, errors: 0 },
    ],
    totals: { processed: 5, pass: 3, fail: 2, needsReview: 0, errors: 0 },
  }),
);
```

---

### `src/config/schema.ts` (config, transform)

**Analog:** `src/config/schema.ts` (self-extension)

Current schema exports `configSchema` with a `job:` key. Phase 6 adds a `jobEntrySchema` for a
single per-job entry and changes the top-level shape to `jobs: z.array(jobEntrySchema).min(1)`.
The individual sub-schemas (`maxSalaryRuleSchema`, etc.) are unchanged and reused inside
`jobEntrySchema`.

**Current top-level shape** (lines 47–82):
```typescript
export const configSchema = z.object({
  job: z.object({
    openingId: z.string().min(1).refine(...),
    stages: z.object({ intake: ..., pass: ..., fail: ... }),
  }),
  hardRules: z.object({ ... }).refine(...),
  fieldMap: z.record(z.string(), z.string()),
  softRules: softRulesSchema,
});
export type Config = z.infer<typeof configSchema>;
```

**New shape to produce** (extract per-job fields into `jobEntrySchema`, then wrap):
```typescript
export const jobEntrySchema = z.object({
  openingId: z.string().min(1).refine(
    (v) => !v.startsWith('REPLACE_WITH'),
    { message: 'openingId must be set to a real BambooHR job opening ID' },
  ),
  stages: z.object({
    intake: z.string().min(1),
    pass: z.string().min(1),
    fail: z.string().min(1),
  }),
  hardRules: z.object({
    maxSalary: maxSalaryRuleSchema.optional(),
    requiredFields: requiredFieldsRuleSchema.optional(),
    requiredBoolean: z.array(requiredBooleanRuleSchema).optional(),
    requiredKeyword: z.array(requiredKeywordRuleSchema).optional(),
  }).refine(
    (rules) =>
      rules.maxSalary !== undefined ||
      rules.requiredFields !== undefined ||
      (rules.requiredBoolean !== undefined && rules.requiredBoolean.length > 0) ||
      (rules.requiredKeyword !== undefined && rules.requiredKeyword.length > 0),
    { message: 'hardRules must contain at least one rule' },
  ),
  fieldMap: z.record(z.string(), z.string()),
  softRules: softRulesSchema,
});

export type JobConfig = z.infer<typeof jobEntrySchema>;

export const configSchema = z.object({
  jobs: z.array(jobEntrySchema).min(1),
});

export type Config = z.infer<typeof configSchema>;
```

**Zod refine pattern** (lines 68–75 of analog — reuse exactly inside `jobEntrySchema`):
```typescript
.refine(
  (rules) =>
    rules.maxSalary !== undefined ||
    rules.requiredFields !== undefined ||
    (rules.requiredBoolean !== undefined && rules.requiredBoolean.length > 0) ||
    (rules.requiredKeyword !== undefined && rules.requiredKeyword.length > 0),
  { message: 'hardRules must contain at least one rule' },
)
```

---

### `src/config/loader.ts` (config, transform)

**Analog:** `src/config/loader.ts` (self-extension)

Add normalization logic (D-02) between YAML parse and Zod validation. The existing
`configSchema.safeParse(raw)` / `ConfigError` error pattern is preserved exactly.

**Existing structure** (lines 11–35 — preserve all):
```typescript
export function loadConfig(configPath: string): Config {
  // Step 1: Read YAML from disk
  let raw: unknown;
  try {
    const fileContent = readFileSync(configPath, 'utf8');
    raw = yaml.load(fileContent);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new ConfigError(`Failed to read or parse config file "${configPath}": ${message}`);
  }

  // Step 2: Validate schema with Zod safeParse
  const result = configSchema.safeParse(raw);
  if (!result.success) {
    const details = JSON.stringify(result.error.format(), null, 2);
    throw new ConfigError(`Invalid configuration in "${configPath}":\n${details}`);
  }

  return result.data;
}
```

**Normalization block to insert** (between Step 1 and Step 2, from D-02 decision):
```typescript
  // Step 1b: Backward-compatible normalization — legacy single-job shape → jobs array (D-02)
  if (
    raw !== null &&
    typeof raw === 'object' &&
    'job' in raw &&
    !('jobs' in raw)
  ) {
    const r = raw as Record<string, unknown>;
    raw = {
      jobs: [{
        openingId: (r['job'] as Record<string, unknown>)['openingId'],
        stages:    (r['job'] as Record<string, unknown>)['stages'],
        hardRules: r['hardRules'],
        fieldMap:  r['fieldMap'],
        softRules: r['softRules'],
      }],
    };
  }
```

**ConfigError pattern** (lines 19–23 of analog — reuse unchanged for any normalization errors):
```typescript
throw new ConfigError(`Failed to read or parse config file "${configPath}": ${message}`);
```

**isDryRun() export** (lines 38–41 of analog — preserve exactly, no changes needed):
```typescript
export function isDryRun(): boolean {
  return process.env['LIVE_MODE'] !== 'true';
}
```

---

### `src/config/types.ts` (config, transform)

**Analog:** `src/config/types.ts` (self-extension)

Currently re-exports `Config` from `schema.ts`. Add `JobConfig` to the re-exports.

**Current content** (lines 1–5):
```typescript
export type { Config } from './schema.js';
export type { Config as AppConfig } from './schema.js';
```

**New content:**
```typescript
export type { Config } from './schema.js';
export type { Config as AppConfig } from './schema.js';
export type { JobConfig } from './schema.js';
```

---

### `src/index.ts` (entrypoint, request-response)

**Analog:** `src/index.ts` (self-modification)

Replace `ScreeningPipeline` construction with `MultiJobOrchestrator`. The DI wiring pattern is
preserved exactly — leaf dependencies constructed first, orchestrator last.

**Current import to remove:**
```typescript
import { ScreeningPipeline } from './screener/screening-pipeline.js';
```

**New import to add:**
```typescript
import { MultiJobOrchestrator } from './screener/multi-job-orchestrator.js';
```

**Current construction block** (lines 50–71 of analog):
```typescript
const bambooHrClient = new BambooHRClient(subdomain!, apiKey!);
const softEvaluator = new SoftEvaluator();
const jsonLogger = new JsonLogger();
const liveWriter = new LiveModeWriter(bambooHrClient);
const dryRun = isDryRun();
const candidateProcessor = new CandidateProcessor(
  bambooHrClient, softEvaluator, jsonLogger, liveWriter, config, dryRun,
);
const pipeline = new ScreeningPipeline(
  bambooHrClient, candidateProcessor, jsonLogger, config, dryRun,
);
await pipeline.run();
```

**New construction block** (MultiJobOrchestrator owns per-job CandidateProcessor instantiation):
```typescript
const bambooHrClient = new BambooHRClient(subdomain!, apiKey!);
const softEvaluator = new SoftEvaluator();
const jsonLogger = new JsonLogger();
const liveWriter = new LiveModeWriter(bambooHrClient);
const dryRun = isDryRun();
const orchestrator = new MultiJobOrchestrator(
  bambooHrClient,
  softEvaluator,
  jsonLogger,
  liveWriter,
  config,
  dryRun,
);
await orchestrator.run();
```

**Error handler** (lines 74–85 of analog — preserve exactly, D-10 means no new exit code needed):
```typescript
main().catch((err) => {
  if (err instanceof ConfigError || err instanceof StageValidationError) {
    console.error(`[main] ${err.message}`);
  } else {
    console.error('[main] Fatal error:', err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
});
```

Note: `StageValidationError` is still imported in `index.ts` (for the catch handler), even though
`MultiJobOrchestrator.run()` does not propagate it. This keeps the top-level handler defensive
against any future pipeline change.

---

## Shared Patterns

### DI via Constructor
**Source:** `src/screener/screening-pipeline.ts` (lines 18–25), `src/pipeline/candidate-processor.ts` (lines 23–31)
**Apply to:** `JobRunner`, `MultiJobOrchestrator`
```typescript
export class Foo {
  constructor(
    private readonly bambooHrClient: IBambooHRClient,
    private readonly logger: ILogger,
    private readonly config: ...,
    private readonly dryRun: boolean,
  ) {}
```

### Named Error Class Pattern
**Source:** `src/bamboohr/errors.ts` (lines 6–11), `src/config/errors.ts` (lines 6–11)
**Apply to:** Any new error types needed in Phase 6
```typescript
export class StageValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StageValidationError';
  }
}
```

### ConfigError Throw Pattern
**Source:** `src/config/loader.ts` (lines 19–23, 27–31)
**Apply to:** `loader.ts` normalization block — throw `ConfigError` (not `Error`) on malformed raw YAML
```typescript
throw new ConfigError(`Failed to read or parse config file "${configPath}": ${message}`);
```

### Zod safeParse + format() Error Pattern
**Source:** `src/config/loader.ts` (lines 26–32)
**Apply to:** Any schema extension validation path
```typescript
const result = configSchema.safeParse(raw);
if (!result.success) {
  const details = JSON.stringify(result.error.format(), null, 2);
  throw new ConfigError(`Invalid configuration in "${configPath}":\n${details}`);
}
```

### Test Mock Helpers
**Source:** `src/__tests__/ScreeningPipeline.test.ts` (lines 41–66)
**Apply to:** `JobRunner.test.ts` (reuse), `MultiJobOrchestrator.test.ts` (adapt)
```typescript
function makeBambooMock(applications: BambooHRApplication[] = []): IBambooHRClient {
  return {
    get: vi.fn(), postComment: vi.fn(), moveStage: vi.fn(),
    validateStages: vi.fn().mockResolvedValue(makeStageMap()),
    fetchApplicationDetails: vi.fn(), downloadPdf: vi.fn(),
    fetchCandidates: vi.fn().mockResolvedValue(applications),
  } as unknown as IBambooHRClient;
}
function makeLoggerMock(): ILogger {
  return { logDecision: vi.fn(), logEvaluation: vi.fn() };
}
```

### Console Spy Pattern
**Source:** `src/__tests__/ScreeningPipeline.test.ts` (lines 70–79)
**Apply to:** `MultiJobOrchestrator.test.ts` (stdout assertion for D-08 JSON shape)
```typescript
beforeEach(() => {
  stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { stdoutSpy.mockRestore(); stderrSpy.mockRestore(); });
```

### process.exit Only in index.ts
**Source:** `src/index.ts` (lines 74–85)
**Apply to:** `MultiJobOrchestrator.run()` and `JobRunner.run()` — neither calls `process.exit`.
Only `index.ts` `main().catch` is the single allowed exit point.

---

## No Analog Found

All files have close analogs in the codebase. No entries in this section.

---

## Metadata

**Analog search scope:** `src/screener/`, `src/config/`, `src/__tests__/`, `src/interfaces/`, `src/bamboohr/`, `src/pipeline/`, `src/index.ts`
**Files scanned:** 12
**Pattern extraction date:** 2026-05-04
