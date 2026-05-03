# Phase 5: Clean Code & SOLID Refactor - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-03
**Phase:** 5-Clean Code & SOLID Refactor
**Areas discussed:** index.ts split, DI depth, process.exit policy, Test scope, Variable naming

---

## index.ts split

| Option | Description | Selected |
|--------|-------------|----------|
| Orchestrator class | ScreeningPipeline({bambooHrClient, config, dryRun}).run() — index.ts becomes a 10-line wiring script | ✓ |
| Functional decomposition | Named top-level functions (startup, processCandidate, writeLiveMode) — no class, index.ts shrinks to ~50 lines | |

**User's choice:** Orchestrator class (ScreeningPipeline)

| Option | Description | Selected |
|--------|-------------|----------|
| CandidateProcessor class | Separate class injected into ScreeningPipeline — handles per-candidate pipeline | ✓ |
| Inside ScreeningPipeline | Per-candidate logic stays inside ScreeningPipeline — simpler but two responsibilities | |

**User's choice:** CandidateProcessor class

| Option | Description | Selected |
|--------|-------------|----------|
| LiveModeWriter + CommentBuilder | CommentBuilder (3 static methods for comment formats) + LiveModeWriter (atomicity) | ✓ |
| Inline in CandidateProcessor | Comment assembly and write calls stay in CandidateProcessor | |

**User's choice:** LiveModeWriter + CommentBuilder

---

## DI depth

**Pre-question clarification:** User asked about TypeScript interface conventions vs Java/PHP. Explanation given: TypeScript uses structural typing — no `implements` keyword required, any object with matching shape satisfies an interface. Interfaces add value where swappability matters (external APIs), not for pure functions.

| Option | Description | Selected |
|--------|-------------|----------|
| Interfaces for external deps only | IBambooHRClient + ISoftEvaluator — pure functions stay concrete | ✓ |
| Concrete classes, no interfaces | No interface layer — use vitest import mocking instead of IoC | |
| Full IoC (all deps) | ILogger, IBambooHRClient, ISoftEvaluator, IHardRuleEvaluator — maximum boilerplate | |

**User's choice:** Interfaces for external deps only

| Option | Description | Selected |
|--------|-------------|----------|
| ILogger interface now | JsonLogger (current) + SlackLogger (v2) — v2 Slack webhook drops in without touching business logic | ✓ |
| Keep logger as-is | Logger stays as exported functions, v2 adds a second call | |

**User's choice:** ILogger interface now

---

## process.exit policy

| Option | Description | Selected |
|--------|-------------|----------|
| Throw typed errors, exit only in index.ts | ConfigError + StageValidationError from infrastructure; single exit point in entry point | ✓ |
| Keep process.exit in infrastructure | CLI container — process.exit in infrastructure is intentional and common | |

**User's choice:** Throw typed errors, exit only in index.ts

---

## Test scope

| Option | Description | Selected |
|--------|-------------|----------|
| Add tests in Phase 5 | vitest — verifies behavior preservation during refactor, locks in SOLID boundaries | ✓ |
| Refactor only, tests deferred to v2 | Risk: regressions not caught until manual UAT | |

**User's choice:** Add tests in Phase 5

**Units to cover (multiselect — all selected):**
- evaluateHardRules (pure function, all 4 rule types)
- CommentBuilder (all 3 static methods)
- CandidateProcessor (mocked IBambooHRClient + ISoftEvaluator, all outcome paths)
- ScreeningPipeline (integration-level loop and counter verification)

---

## Variable naming

| Option | Description | Selected |
|--------|-------------|----------|
| Full descriptive names | bambooHrClient, applicationDetail, candidateContext, applications, agentOutput, hardRuleResult | ✓ |
| Short names in context | client OK inside BambooHRClient; full names only at orchestrator level | |

**User's choice:** Full descriptive names everywhere

**Context:** User had specifically noticed `client` being too generic for the BambooHR client instance in index.ts. Decision generalised to all service/dependency variables.

| Option | Description | Selected |
|--------|-------------|----------|
| applicationDetail | Rename `detail` → `applicationDetail` everywhere — unambiguous when paired with `application` (summary) | ✓ |
| Keep detail | Conventional shorthand for full record | |

**User's choice:** applicationDetail

| Option | Description | Selected |
|--------|-------------|----------|
| No abbreviations anywhere | candidateContext (not ctx), applications (not all), agentOutput (not out) | ✓ |
| Abbreviations OK in local scope | ctx, all, out fine in tight function scopes | |

**User's choice:** No abbreviations anywhere

---

## Claude's Discretion

- File/directory layout for new classes (ScreeningPipeline, CandidateProcessor, LiveModeWriter, CommentBuilder)
- vitest config and test file locations (co-located vs `src/__tests__/`)
- Whether `ISoftEvaluator` wraps the existing `evaluateSoftRules` function or is a class-shaped interface

## Deferred Ideas

- Idempotency guard (SAFE-03) — `processed.json` — still v2
- Retry on 429/5xx (BAMB-05) — `IBambooHRClient` interface added in Phase 5 makes a `RetryingBambooHRClient` decorator easy in v2
- SlackLogger (INFRA-05) — `ILogger` interface added in Phase 5 makes `SlackLogger` a drop-in v2 addition
- 02-07 gap (PDF download 404) — still deferred from Phase 2
