---
phase: 05-clean-code-solid-refactor
plan: 01
subsystem: infra
tags: [vitest, typescript, interfaces, error-classes, testing]

# Dependency graph
requires: []
provides:
  - vitest test runner installed and configured (npm test runs vitest run)
  - ConfigError named error class in src/config/errors.ts
  - StageValidationError named error class in src/bamboohr/errors.ts
  - IBambooHRClient structural interface mirroring all 7 public BambooHRClient methods
  - ISoftEvaluator structural interface with evaluate() method shape
  - ILogger structural interface with logDecision/logEvaluation methods
affects:
  - 05-02: refactors loader.ts and client.ts to throw ConfigError/StageValidationError
  - 05-03: creates CandidateProcessor and SoftEvaluator implementing ISoftEvaluator
  - 05-04: creates ScreeningPipeline and test files using all three interfaces

# Tech tracking
tech-stack:
  added: [vitest@4.1.5]
  patterns:
    - named error classes extending Error with this.name for ESM instanceof correctness
    - structural TypeScript interfaces under src/interfaces/ without implements keyword
    - centralized test root at src/__tests__/**/*.test.ts

key-files:
  created:
    - vitest.config.ts
    - src/config/errors.ts
    - src/bamboohr/errors.ts
    - src/interfaces/IBambooHRClient.ts
    - src/interfaces/ISoftEvaluator.ts
    - src/interfaces/ILogger.ts
  modified:
    - package.json (added test/test:watch scripts and vitest devDependency)
    - package-lock.json (lockfile updated)

key-decisions:
  - "D-05: IBambooHRClient uses structural typing — no implements keyword on BambooHRClient; TypeScript satisfies the interface implicitly"
  - "D-08/D-09: ConfigError and StageValidationError are standalone modules co-located with the module that throws them (config/ and bamboohr/)"
  - "globals: false in vitest.config.ts — every test file imports describe/it/expect/vi explicitly for strict mode correctness"
  - "Centralized test root at src/__tests__/ chosen over co-located tests for discoverability"
  - "SoftRulesInput duplicated in ISoftEvaluator.ts to keep interface decoupled from evaluator.ts implementation"

patterns-established:
  - "Named error class pattern: extends Error + this.name assignment for ESM instanceof correctness"
  - "Structural interface pattern: src/interfaces/I*.ts — no implements keyword, TypeScript structural typing satisfies implicitly"
  - "Vitest test convention: centralized src/__tests__/**/*.test.ts with explicit imports (no globals)"

requirements-completed: []

# Metrics
duration: 15min
completed: 2026-05-03
---

# Phase 05 Plan 01: Foundation for SOLID Refactor Summary

**vitest test infrastructure, ConfigError/StageValidationError named error classes, and three structural TypeScript interfaces (IBambooHRClient, ISoftEvaluator, ILogger) installed as Wave-1 contracts for the Phase 5 SOLID refactor**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-03T00:00:00Z
- **Completed:** 2026-05-03T00:15:00Z
- **Tasks:** 3
- **Files modified:** 8 (6 new, 2 modified)

## Accomplishments
- vitest@4.1.5 installed with `npm test` script and vitest.config.ts pointing to centralized `src/__tests__/**/*.test.ts` test root
- Two named error classes created — `ConfigError` (src/config/errors.ts) and `StageValidationError` (src/bamboohr/errors.ts) — co-located with the throwing module, with `this.name` set for correct ESM `instanceof` behavior
- Three structural TypeScript interfaces created under `src/interfaces/` — IBambooHRClient (7 methods), ISoftEvaluator (evaluate()), ILogger (logDecision/logEvaluation) — with no `implements` keyword required on concrete classes
- TypeScript strict mode (tsc --noEmit) passes cleanly; zero `any` casts in new files
- No modifications to any existing `src/` file outside the new error class and interface files

## Task Commits

Each task was committed atomically:

1. **Task 1: Install vitest and add test script + vitest.config.ts** - `a3bb511` (chore)
2. **Task 2: Create ConfigError and StageValidationError classes** - `ca5037f` (feat)
3. **Task 3: Create IBambooHRClient, ISoftEvaluator, ILogger interfaces** - `cd412d4` (feat)

## Files Created/Modified
- `vitest.config.ts` - vitest config: node environment, centralized test root, globals:false
- `package.json` - added test and test:watch scripts; vitest devDependency
- `package-lock.json` - lockfile updated with vitest and transitive deps
- `src/config/errors.ts` - ConfigError extends Error with this.name (D-08/D-09)
- `src/bamboohr/errors.ts` - StageValidationError extends Error with this.name (D-08/D-09)
- `src/interfaces/IBambooHRClient.ts` - structural interface for all 7 BambooHRClient public methods
- `src/interfaces/ISoftEvaluator.ts` - structural interface for soft-rule evaluation + SoftRulesInput type
- `src/interfaces/ILogger.ts` - structural interface for per-candidate JSON-line logging

## Decisions Made
- Co-located error classes (config/errors.ts, bamboohr/errors.ts) rather than shared src/errors/ — follows existing module layout and avoids YAGNI
- Structural typing for all three interfaces — no `implements` keyword needed; TypeScript satisfies them implicitly (D-05)
- `SoftRulesInput` duplicated in ISoftEvaluator.ts rather than imported from evaluator.ts — keeps interface decoupled from implementation, same pattern already used in evaluator.ts
- vitest `globals: false` — all test files must explicitly import `describe`, `it`, `expect`, `vi`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] npm install required after npm install --save-dev vitest**

- **Found during:** Task 1 (vitest installation)
- **Issue:** After installing vitest with Node 14 (shell default), `@types/node` and other devDependencies were missing from node_modules (lockfile was regenerated under Node 14 npm). Running `npx tsc --noEmit` failed with "Cannot find type definition file for 'node'".
- **Fix:** Ran `npm install` with Node 22 active (via nvm) to restore all devDependencies. Also confirmed that Node 22 is required to run vitest@4.x (Node 14 causes syntax error on `??=` operator).
- **Files modified:** package-lock.json (lockfile regenerated under Node 22)
- **Verification:** `npx tsc --noEmit` exits 0; `npx vitest run` reports "No test files found" cleanly
- **Committed in:** a3bb511 (part of Task 1 commit)

---

**Total deviations:** 1 auto-fixed (Rule 3 — blocking)
**Impact on plan:** The lockfile regeneration under Node 22 is the correct target environment (Node 22 LTS per CLAUDE.md). No scope creep.

## Issues Encountered
- Shell environment defaults to Node 14.21.3 (via nvm). All Node.js commands for this project must be run with `nvm use 22` activated. vitest@4.x requires Node 18+ (uses `??=` nullish assignment which Node 14 does not support). This is a development environment configuration issue, not a code issue.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 02 can now import `ConfigError` from `./errors.js` and `StageValidationError` from `../bamboohr/errors.js` to replace the `process.exit(1)` calls in loader.ts and client.ts
- Plan 02 can import `ILogger` to implement `JsonLogger` class in logger.ts
- Plan 03 can import `ISoftEvaluator` to wrap `evaluateSoftRules` behind a `SoftEvaluator` class
- Plan 04 can import all three interfaces for `CandidateProcessor` and `ScreeningPipeline` constructor DI
- `npm test` runs vitest with no test files yet — tests will be added in Plans 03/04

---
*Phase: 05-clean-code-solid-refactor*
*Completed: 2026-05-03*
