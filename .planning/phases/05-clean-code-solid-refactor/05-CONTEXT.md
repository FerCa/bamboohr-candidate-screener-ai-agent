# Phase 5: Clean Code & SOLID Refactor - Context

**Gathered:** 2026-05-03
**Status:** Ready for planning

<domain>
## Phase Boundary

Structural refactoring of the existing ~700 lines across 10 source files — no new features, no behavior changes. The goal is to apply clean code and SOLID principles so the codebase is maintainable and extensible for v2 features (idempotency guard, retry, multi-job, Slack webhook) without touching existing logic. All existing dry-run and live-mode behavior must be preserved end-to-end. TypeScript strict mode must pass with no `any` casts introduced.

</domain>

<decisions>
## Implementation Decisions

### index.ts decomposition

- **D-01:** Extract a `ScreeningPipeline` orchestrator class. Constructor takes `{ bambooHrClient, softEvaluator, logger, config, dryRun }`. Public `.run()` method drives the full pipeline (startup → fetch → per-candidate loop → summary). `index.ts` becomes a thin ~15-line wiring script that constructs dependencies and calls `pipeline.run()`.

- **D-02:** Extract a `CandidateProcessor` class injected into `ScreeningPipeline`. `CandidateProcessor.process(application)` handles the per-candidate pipeline: hard rules → CV extraction → soft evaluation → optional live-mode write. Returns a typed `CandidateOutcome`. `ScreeningPipeline` handles the candidate loop, counter aggregation, and final summary.

- **D-03:** Extract a `CommentBuilder` class with static methods for all 3 recruiter comment formats:
  - `CommentBuilder.softEval(result: EvaluationResult): string`
  - `CommentBuilder.hardRuleFail(reasons: string[]): string`
  - `CommentBuilder.needsReview(reason: NeedsReviewReason): string`

- **D-04:** Extract a `LiveModeWriter` class that owns the comment-then-move atomicity. `LiveModeWriter.write(applicationId, comment, stageId)` calls `postComment` first, then `moveStage`. `CandidateProcessor` calls `LiveModeWriter` for all live-mode writes. Atomicity policy (D-03 from Phase 4 CONTEXT.md) is enforced here, not scattered across `index.ts`.

### Dependency injection

- **D-05:** Define TypeScript interfaces for external API dependencies only. No `implements` keyword needed — TypeScript structural typing satisfies interfaces implicitly.
  - `IBambooHRClient` — all methods on `BambooHRClient`
  - `ISoftEvaluator` — `evaluateSoftRules(ctx: CandidateContext, softRules: SoftRulesInput | undefined): Promise<EvaluationResult>`
  - `ILogger` — `logDecision(record: CandidateDecision): void` and `logEvaluation(record: EvaluationResult): void`

- **D-06:** `JsonLogger` (current `process.stdout.write` behavior) implements `ILogger`. `SlackLogger` (v2 Slack webhook) will implement `ILogger` without touching business logic.

- **D-07:** Pure functions and single-implementation classes do NOT get interfaces: `CommentBuilder`, `evaluateHardRules`, `buildCandidateContext`, `loadConfig`, `isDryRun`. These are deterministic and directly testable.

### process.exit policy

- **D-08:** Remove `process.exit(1)` from infrastructure. `loadConfig()` throws `ConfigError` instead. `validateStages()` throws `StageValidationError` instead. `index.ts` (the entry point and only allowed exit point) catches these at the top level and calls `process.exit(1)` with a clear message. All other unhandled errors propagate as non-zero exit via `main().catch(...)`.

- **D-09:** Named error classes: `ConfigError extends Error` (in `src/config/errors.ts`), `StageValidationError extends Error` (in `src/bamboohr/errors.ts`). Both carry a human-readable message that `index.ts` forwards to `console.error` before exiting.

### Unit tests

- **D-10:** Add unit tests in Phase 5 using `vitest` (standard for TypeScript ESM projects). Tests verify behavior is preserved during the refactor and lock in the SOLID boundaries.

- **D-11:** Test coverage targets:
  - `evaluateHardRules` — pure function, all 4 rule types, pass/fail branches, collect-all behavior. No mocks needed.
  - `CommentBuilder` — all 3 static methods, verify header strings, bullet formatting, audit footer.
  - `CandidateProcessor` — inject mocked `IBambooHRClient`, `ISoftEvaluator`, `ILogger`. Test all outcome paths: pass, fail, needsReview (from CV), needsReview (from agent), error.
  - `ScreeningPipeline` — integration-level: mock `bambooHrClient` returns N candidates, verify `CandidateProcessor` is called N times, verify summary counts (processed, pass, fail, needsReview, errors).

### Variable naming

- **D-12:** Full descriptive names everywhere — no abbreviations:
  - `bambooHrClient` (not `client`)
  - `applicationDetail` (not `detail`) — the full `BambooHRApplication` from the detail endpoint
  - `candidateContext` (not `ctx`)
  - `applications` (not `all`) — in `fetchCandidates` accumulator
  - `agentOutput` (not `out`) — for agent `finalOutput` in `evaluator.ts`
  - `hardRuleResult` (not `result`) — for `RuleResult` from `evaluateHardRules`

- **D-13:** Constructor parameters and class fields always use the full descriptive name. Local loop variables (`application` in `for...of`) stay idiomatic.

### Claude's Discretion

- File layout for new classes: `src/pipeline/candidate-processor.ts`, `src/pipeline/live-mode-writer.ts`, `src/pipeline/comment-builder.ts`, `src/screener/screening-pipeline.ts` — or Claude decides the directory structure based on the refactored responsibility map.
- vitest config and test file locations — standard `src/__tests__/` or co-located `.test.ts` files. Claude decides.
- Whether `ISoftEvaluator` wraps the existing `evaluateSoftRules` function or is a class-shaped interface — Claude decides.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Specs
- `.planning/REQUIREMENTS.md` — All requirement IDs referenced in phases 1–4; traceability matrix
- `.planning/ROADMAP.md` — Phase 5 success criteria (5 items); full phase dependency chain
- `.planning/PROJECT.md` — Key decisions, constraints, tech stack

### Prior Phase Context (all 4 must be read — refactor touches everything)
- `.planning/phases/01-foundation/01-CONTEXT.md` — Config shape, fieldMap, `isDryRun()`, hard-rule collect-all invariant (D-03 there: every rule evaluated before returning)
- `.planning/phases/02-pdf-pipeline/02-CONTEXT.md` — `CandidateContext` shape, `needsReviewReason` values, recovery vs rethrow split
- `.planning/phases/03-agent-evaluation/03-CONTEXT.md` — `EvaluationResult` shape, recruiter comment format (D-06–D-08), soft rules short-circuit behavior
- `.planning/phases/04-live-mode-deployment/04-CONTEXT.md` — Write atomicity policy (D-03/D-04), all 3 comment formats, `stageMap` usage, hard-rule fail write path (D-05)

### Key Source Files (all must be read — refactor is codebase-wide)
- `src/index.ts` — The God function to decompose. 260 lines. All business logic lives here currently.
- `src/bamboohr/client.ts` — `BambooHRClient` — becomes the concrete impl of `IBambooHRClient`. `validateStages()` currently calls `process.exit(1)` — must throw `StageValidationError` instead.
- `src/config/loader.ts` — `loadConfig()` currently calls `process.exit(1)` — must throw `ConfigError` instead. `isDryRun()` stays as-is.
- `src/rules/evaluator.ts` — `evaluateHardRules()` pure function — stays as-is, no interface needed, directly testable.
- `src/agent/evaluator.ts` — `evaluateSoftRules()` — wrapped behind `ISoftEvaluator` interface for testability.
- `src/pipeline/extract-cv.ts` — `buildCandidateContext()` — injected via `IBambooHRClient`; function itself stays pure.
- `src/logger/logger.ts` — `logDecision()` + `logEvaluation()` — becomes `JsonLogger` implementing `ILogger`.

### CLAUDE.md Constraints
- `CLAUDE.md` — `applicationId` (not `applicantId`) for all writes; `LIVE_MODE=true` required; dry-run default; ESM NodeNext `.js` imports throughout; one agent run per candidate; hard rules before LLM

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/rules/evaluator.ts` — `evaluateHardRules()` is already clean and pure. No changes needed to its internals — just rename local `result` → `hardRuleResult` in callers.
- `src/agent/evaluator.ts` — `evaluateSoftRules()` wraps cleanly into an `ISoftEvaluator` implementation. The `SoftRulesInput` local interface already shows intent to decouple.
- `src/pipeline/extract-cv.ts` — `buildCandidateContext()` already follows the recoverable-vs-rethrow pattern (lines 79–86). Keep as-is; move into `CandidateProcessor` orchestration.
- `stageMap` (from `validateStages()`) — already a clean `Map<string, number>`. Passed through to `LiveModeWriter` for stage ID resolution.

### Established Patterns
- ESM TypeScript with `.js` import extensions — all new files must follow this (e.g., `import { ScreeningPipeline } from './screener/screening-pipeline.js'`).
- Per-candidate `try/catch` in the candidate loop — this SAFE-01 invariant must be preserved in `ScreeningPipeline`'s loop after refactor. The loop catches errors per-candidate and continues.
- `console.error` for diagnostics, `JsonLogger` (via `ILogger`) for JSON candidate records — `ScreeningPipeline` uses `console.error` for mode/count messages, `ILogger` for per-candidate records.
- Comment-then-move atomicity — `LiveModeWriter` owns this. If `postComment` throws, `moveStage` is never called. Outer try/catch counts it as `error`.

### Integration Points
- `index.ts` → constructs `bambooHrClient`, `softEvaluator`, `jsonLogger`, then `new ScreeningPipeline(...)`. No business logic in index.ts after refactor.
- `ScreeningPipeline` → calls `bambooHrClient.validateStages()` (startup), `bambooHrClient.fetchCandidates()` (fetch), then loops calling `CandidateProcessor.process(application)`.
- `CandidateProcessor` → calls `evaluateHardRules()` (pure), `buildCandidateContext(bambooHrClient, ...)`, `softEvaluator.evaluate(...)`, `liveWriter.write(...)` if not dry-run.
- `vitest` test files → inject mocked `IBambooHRClient` (object with `vi.fn()` methods) into `CandidateProcessor` constructor.

</code_context>

<specifics>
## Specific Ideas

- The user comes from Java/PHP background — the interface-first style will feel natural, but the TypeScript structural typing briefing (no `implements` required) is important for the implementer to understand and document in comments.
- Naming convention: `bambooHrClient` (camelCase, not `bambooHRClient`) — matches TypeScript idiomatic style for initialisms in the middle of camelCase identifiers.
- `CommentBuilder` static methods should produce the exact same output as the current inline strings in `index.ts` — verified by `CommentBuilder` unit tests. No content changes to recruiter comments.
- `LiveModeWriter` is a thin class — its main value is encapsulating the atomicity invariant in one place. If `postComment` or `moveStage` throws, it propagates to `CandidateProcessor`'s try/catch.

</specifics>

<deferred>
## Deferred Ideas

- **Idempotency guard (SAFE-03)** — `processed.json` to skip already-screened candidates. Came up in original deferred items. Still v2 — Phase 5 is structural only.
- **Retry on 429/5xx (BAMB-05)** — Exponential backoff. Deferred v2. The `IBambooHRClient` interface added in Phase 5 makes a `RetryingBambooHRClient` decorator easy to add in v2.
- **SlackLogger (INFRA-05)** — `ILogger` interface added in Phase 5 makes `SlackLogger` a drop-in v2 addition without touching business logic.
- **02-07 gap (PDF download 404)** — Still deferred from Phase 2. Not a refactor concern.

</deferred>

---

*Phase: 5-Clean Code & SOLID Refactor*
*Context gathered: 2026-05-03*
