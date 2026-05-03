---
phase: 05-clean-code-solid-refactor
reviewed: 2026-05-03T20:30:36Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - package.json
  - src/__tests__/CandidateProcessor.test.ts
  - src/__tests__/CommentBuilder.test.ts
  - src/__tests__/ScreeningPipeline.test.ts
  - src/__tests__/evaluateHardRules.test.ts
  - src/agent/evaluator.ts
  - src/bamboohr/client.ts
  - src/bamboohr/errors.ts
  - src/config/errors.ts
  - src/config/loader.ts
  - src/index.ts
  - src/interfaces/IBambooHRClient.ts
  - src/interfaces/ILogger.ts
  - src/interfaces/ISoftEvaluator.ts
  - src/logger/logger.ts
  - src/pipeline/candidate-processor.ts
  - src/pipeline/comment-builder.ts
  - src/pipeline/live-mode-writer.ts
  - src/rules/hard-rules.ts
  - src/screener/screening-pipeline.ts
  - vitest.config.ts
findings:
  critical: 0
  warning: 4
  info: 6
  total: 10
status: issues_found
---

# Phase 05: Code Review Report

**Reviewed:** 2026-05-03T20:30:36Z
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found

## Summary

Phase 5 performs a clean-code and SOLID refactor: extracting `ScreeningPipeline`,
`CandidateProcessor`, `CommentBuilder`, `LiveModeWriter`, and `JsonLogger` into dedicated
modules with interfaces for DI. The overall structure is sound — the DI pattern is applied
consistently for `IBambooHRClient`, `ISoftEvaluator`, and `ILogger`.

Four warnings were found: a concrete-class dependency leak (`extract-cv.ts` forces a type
assertion on every call), a DI inconsistency where `ScreeningPipeline` holds a concrete
`CandidateProcessor` instead of an abstraction, an `ILogger` method gap that prevents
`ScreeningPipeline` from routing its INFRA-03 summary through the injected logger, and a
module boundary violation where `candidate-processor.ts` imports from the implementation
file directly rather than the stable public re-export. None of these are data-loss or
security issues, but two of them undermine the stated Phase-5 goals (D-05 / testability).

## Warnings

### WR-01: `extract-cv.ts` typed against concrete `BambooHRClient` — forces unsafe cast in every caller

**File:** `src/pipeline/extract-cv.ts:10,33`
**Issue:** `buildCandidateContext` declares its first parameter as `BambooHRClient` (the
concrete class) even though it only calls `client.downloadPdf()`, which is fully declared on
`IBambooHRClient`. Because `CandidateProcessor` stores `IBambooHRClient`, it must use a
`as Parameters<typeof buildCandidateContext>[0]` type assertion on every call site
(`candidate-processor.ts:75`). The assertion works today only because TypeScript's structural
check happens to pass, but any future private field or accessor added to `BambooHRClient`
would silently break the cast without a compile error.

**Fix:** Change the parameter type in `extract-cv.ts` to `IBambooHRClient` and remove the
type assertion from `candidate-processor.ts`:

```typescript
// src/pipeline/extract-cv.ts — line 10
import type { IBambooHRClient } from '../interfaces/IBambooHRClient.js';

// line 33
export async function buildCandidateContext(
  client: IBambooHRClient,
  detail: BambooHRApplication,
  hardRuleResult: RuleResult,
): Promise<CandidateContext> {
```

```typescript
// src/pipeline/candidate-processor.ts — line 74 (simplified)
const candidateContext = await buildCandidateContext(
  this.bambooHrClient,   // no cast needed
  applicationDetail,
  hardRuleResult,
);
```

---

### WR-02: `ScreeningPipeline` depends on concrete `CandidateProcessor` — breaks the DI contract it was designed to enforce

**File:** `src/screener/screening-pipeline.ts:15,21`
**Issue:** `ScreeningPipeline` imports and declares `private readonly candidateProcessor:
CandidateProcessor` — a concrete class — while all other dependencies (bambooHrClient,
logger) use interfaces. This means any unit test that wants to swap the processor must
instantiate a real `CandidateProcessor` and monkey-patch `.process` with `vi.fn()`
(`ScreeningPipeline.test.ts:57-66`), which is fragile and defeats the stated Phase-5
testability goal. If `CandidateProcessor`'s constructor signature changes, every test
fixture breaks.

**Fix:** Extract an `ICandidateProcessor` interface and use it in `ScreeningPipeline`:

```typescript
// src/interfaces/ICandidateProcessor.ts (new file)
import type { BambooHRApplication } from '../bamboohr/types.js';
import type { CandidateOutcome } from '../pipeline/candidate-processor.js';

export interface ICandidateProcessor {
  process(
    application: BambooHRApplication,
    stageMap: Map<string, number>,
  ): Promise<CandidateOutcome>;
}
```

```typescript
// src/screener/screening-pipeline.ts
import type { ICandidateProcessor } from '../interfaces/ICandidateProcessor.js';
// ...
constructor(
  private readonly bambooHrClient: IBambooHRClient,
  private readonly candidateProcessor: ICandidateProcessor,  // interface, not class
  private readonly logger: ILogger,
  private readonly config: Config,
  private readonly dryRun: boolean,
) {}
```

---

### WR-03: `ILogger` is missing `logSummary` — `ScreeningPipeline` bypasses the injected logger for INFRA-03 output

**File:** `src/screener/screening-pipeline.ts:101-103`
**Issue:** `ScreeningPipeline.run()` writes the INFRA-03 machine-readable summary JSON via
`console.log(JSON.stringify(...))`. The injected `ILogger` interface only declares
`logDecision` and `logEvaluation`, so there is no way to route the summary through the
logger. This creates two parallel output paths: `JsonLogger` uses `process.stdout.write`
(documented as necessary to avoid buffering prefix), while `ScreeningPipeline` uses
`console.log` for the summary — contradicting the rationale in `logger.ts:16`.

This also means the summary JSON line is untestable via the `ILogger` mock; the
`ScreeningPipeline.test.ts` works around it by spying directly on `console.log`.

**Fix:** Add a `logSummary` method to `ILogger` and implement it in `JsonLogger`:

```typescript
// src/interfaces/ILogger.ts
export interface ILogger {
  logDecision(record: CandidateDecision): void;
  logEvaluation(record: EvaluationResult): void;
  logSummary(record: Record<string, number>): void;
}

// src/logger/logger.ts
logSummary(record: Record<string, number>): void {
  process.stdout.write(JSON.stringify(record) + '\n');
}
```

```typescript
// src/screener/screening-pipeline.ts — replace console.log call
this.logger.logSummary({ processed, pass: passed, fail: failed, needsReview, errors });
```

---

### WR-04: `candidate-processor.ts` imports `evaluateHardRules` from the implementation file, bypassing the stable public re-export

**File:** `src/pipeline/candidate-processor.ts:16`
**Issue:** `hard-rules.ts` was created as the "stable public export point" for
`evaluateHardRules` (D-11) so that future consumers only depend on that stable path.
`candidate-processor.ts` imports directly from the implementation file
`../rules/evaluator.js`, creating two valid import paths for the same symbol. If
`evaluator.ts` is ever refactored or moved, the import in `candidate-processor.ts` will
break while `hard-rules.ts` consumers remain unaffected — the very scenario the re-export
pattern was designed to prevent.

**Fix:**
```typescript
// src/pipeline/candidate-processor.ts — line 16
import { evaluateHardRules } from '../rules/hard-rules.js';  // stable re-export
```

---

## Info

### IN-01: `index.ts` has two `process.exit` call sites — violates its own "single allowed process.exit point" contract

**File:** `src/index.ts:9,46,84`
**Issue:** The module comment on line 9 declares "single allowed process.exit point (D-08)".
There are actually two: line 46 (inside `main()` body, for missing env vars) and line 84
(in `.catch()`). The missing-env-vars path should throw a named error so the single-exit
contract is honoured and testability is preserved.

**Fix:** Throw a `ConfigError` for missing env vars instead of calling `process.exit`:

```typescript
if (missingVars.length > 0) {
  throw new ConfigError(
    `Missing required environment variables: ${missingVars.join(', ')}. ` +
    `Copy .env.example to .env and fill in your credentials.`,
  );
}
```

---

### IN-02: `IBambooHRClient` exposes the internal `get<T>()` method — unnecessarily widens the interface surface

**File:** `src/interfaces/IBambooHRClient.ts:10`
**Issue:** The generic `get<T>(path, params?)` method is an internal HTTP helper on
`BambooHRClient`. No consumer outside of `BambooHRClient` itself calls `.get()` directly
(confirmed by grep). Exposing it on the interface forces test mocks to stub it and allows
unintended callers to bypass the typed domain methods (`fetchCandidates`,
`fetchApplicationDetails`, etc.).

**Fix:** Remove `get` from `IBambooHRClient`. The method remains `public` on
`BambooHRClient` if needed for intra-class reuse, but should not be part of the interface
contract.

---

### IN-03: Misleading variable name `reviewedStageId` resolves to `config.job.stages.fail`

**File:** `src/pipeline/candidate-processor.ts:91`
**Issue:** In the CV `needsReview` path (Path D), the variable is named `reviewedStageId`
but it holds the ID of the `fail` stage. Both hard-rule failures and CV-extraction failures
route to the same `fail` stage — this is correct per D-01 — but the naming implies a
separate "reviewed" stage, which does not exist in the schema.

**Fix:**
```typescript
const failStageId = this.resolveStageId(stageMap, this.config.job.stages.fail);
await this.liveWriter.write(
  applicationDetail.id,
  CommentBuilder.needsReview(candidateContext.needsReviewReason),
  failStageId,
);
```

---

### IN-04: `evaluator.ts` comment contradicts CLAUDE.md on which model is the SDK default

**File:** `src/agent/evaluator.ts:60`
**Issue:** The comment on line 60 reads "gpt-4.1 model explicit; better instruction
following than gpt-4o". CLAUDE.md states "default is gpt-4.1" (the SDK default changed
after the model upgrade committed in `53f7824`). The code itself is correct — explicit model
specification is right — but the comment implies `gpt-4.1` is a non-default choice, which
is no longer true. This will confuse anyone checking whether the model override is still
necessary.

**Fix:** Update the comment to reflect current reality:
```typescript
// (C) Construct Agent — model explicit per SAFE-02 (never rely on SDK default changing).
//     Currently gpt-4.1 (also the SDK default). See commit 53f7824 for upgrade rationale.
```

---

### IN-05: `ScreeningPipeline` uses `[main]` prefix in `console.error` calls despite being its own class

**File:** `src/screener/screening-pipeline.ts:29-59`
**Issue:** All diagnostic messages emitted by `ScreeningPipeline` use the prefix `[main]`
(e.g. `[main] Mode: DRY_RUN`). This was a copy artefact from the pre-Phase-5 `index.ts`
body. The class is now `ScreeningPipeline`, not `main`, making the prefix misleading when
reading log output or when future integrations call `pipeline.run()` from a non-main context.

**Fix:** Replace `[main]` with `[pipeline]` throughout `screening-pipeline.ts`.

---

### IN-06: `logger.ts` re-exports `CandidateDecision` and `EvaluationResult` — creates an unexpected second import path

**File:** `src/logger/logger.ts:11-12`
**Issue:** `JsonLogger` re-exports `CandidateDecision` from `rules/types.ts` and
`EvaluationResult` from `agent/types.ts`. These re-exports are not part of the `ILogger`
interface and serve no documented purpose. They create an unexpected import source
(`logger/logger.ts`) for types that have canonical homes, which can cause confusion during
refactors.

**Fix:** Remove the `export type` re-exports from `logger.ts`. Consumers that need these
types should import them from their canonical locations.

```typescript
// Remove these two lines from src/logger/logger.ts:
export type { CandidateDecision };
export type { EvaluationResult };
```

---

_Reviewed: 2026-05-03T20:30:36Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
