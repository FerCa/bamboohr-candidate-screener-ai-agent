---
phase: 01-foundation
plan: "04"
subsystem: rules
tags: [typescript, esm, nodenext, hard-rules, collect-all, fieldmap, salary, boolean, keyword, deterministic]

# Dependency graph
requires:
  - phase: 01-02
    provides: src/config/schema.ts — Config type with hardRules shape and fieldMap
  - phase: 01-03
    provides: src/bamboohr/types.ts — BambooHRApplication interface (index signature for unknown fields)
provides:
  - src/rules/types.ts — RuleResult and CandidateDecision interfaces
  - src/rules/evaluator.ts — evaluateHardRules(config, application) pure function (collect-all, fieldMap-resolved)
affects:
  - 01-05 (entry point imports evaluateHardRules and CandidateDecision for dry-run logging)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Collect-all evaluation: evaluateHardRules() runs all four rule blocks unconditionally — reasons[] accumulates ALL unmet labels before returning (D-03)"
    - "fieldMap field resolution: resolveField() uses config.fieldMap dot-notation path walking — no hardcoded BambooHR field names anywhere in evaluation logic (D-07/D-08)"
    - "Conservative absent-field policy: field absent/undefined fails the rule rather than passing (security default)"
    - "Salary coercion: parseFloat(String(raw).replace(/,/g, '')) handles '55,000', '55000', and numeric 55000 uniformly"
    - "Boolean normalization: handles actual boolean and string 'yes'/'no'/'true'/'false' after toLowerCase().trim() (T-04-04)"
    - "Keyword match: case-insensitive substring match with .toLowerCase().includes() on both sides"

key-files:
  created:
    - src/rules/types.ts
    - src/rules/evaluator.ts
  modified: []

key-decisions:
  - "resolveField() resolves field names via config.fieldMap — operators configure paths post-DRY_RUN; zero hardcoded BambooHR field paths in evaluation logic"
  - "Absent field fails the rule conservatively — a missing salary field is treated as failing the ceiling check rather than silently passing"
  - "salary key used as the fieldMap lookup name in resolveField() — consistent with config.yaml template from plan 01-01"
  - "requiredFields rule checks fields directly on the application object (not via fieldMap) because requiredFields.fields lists top-level property names like 'resume'"

patterns-established:
  - "RuleResult pattern: outcome + reasons[] — downstream entry point uses outcome to select BambooHR stage, reasons[] to build comment body"
  - "CandidateDecision log pattern: candidateId (for logging) + applicationId (for writes) + outcome + reasons + ISO timestamp per INFRA-02"

requirements-completed:
  - RULE-01

# Metrics
duration: 5min
completed: "2026-05-01"
---

# Phase 01 Plan 04: Hard-Rule Evaluation Engine Summary

**Pure deterministic hard-rule evaluator with collect-all evaluation of all four rule types using fieldMap-resolved field access — no LLM invoked, no early exits**

## Performance

- **Duration:** 5 min
- **Started:** 2026-05-01T00:00:00Z
- **Completed:** 2026-05-01T00:05:00Z
- **Tasks:** 2
- **Files modified:** 2 (both created)

## Accomplishments

- Defined `RuleResult` and `CandidateDecision` interfaces in `src/rules/types.ts` — the structured contracts for evaluation outcomes and structured log records (INFRA-02)
- Implemented `evaluateHardRules()` in `src/rules/evaluator.ts` evaluating all four rule types (maxSalary, requiredFields, requiredBoolean, requiredKeyword) collect-all with a single return at the end (D-03)
- `resolveField()` walks dot-notation fieldMap paths (e.g., `"questions.0.answer"`) with null checks at each step — no hardcoded BambooHR field paths anywhere (D-07/D-08, T-04-01)
- Salary coercion handles `"55,000"`, `"55000"`, and numeric `55000` uniformly via `parseFloat(String(raw).replace(/,/g, ''))` (Pitfall 6)
- Boolean normalization handles actual booleans and string forms `"yes"/"no"/"true"/"false"` after `.toLowerCase().trim()` (T-04-04)

## Task Commits

Each task was committed atomically:

1. **Task 1: Define rule result and candidate decision types** - `ca0ea67` (feat)
2. **Task 2: Implement the hard-rule evaluator (all four rule types, collect-all)** - `0817c9c` (feat)

## Files Created/Modified

- `src/rules/types.ts` - RuleResult (outcome + reasons[]) and CandidateDecision (structured log record per INFRA-02)
- `src/rules/evaluator.ts` - evaluateHardRules() and resolveField() — pure functions, no side effects, no LLM calls (RULE-01)

## Decisions Made

- `resolveField()` resolves field names via `config.fieldMap` — operators populate paths after first `DRY_RUN=true` API exploration. No hardcoded BambooHR field IDs in source.
- Absent field fails the rule conservatively (T-04-01 mitigation) — a missing salary field is treated as failing the maxSalary ceiling check rather than silently passing it.
- `requiredFields` rule checks fields directly on the application object (not via fieldMap) because `requiredFields.fields` lists top-level property names such as `resume` that map to known top-level keys.
- `salary` is used as the fieldMap lookup key in `resolveField()` — consistent with the `fieldMap` convention established in `config.yaml` template from plan 01-01.

## Deviations from Plan

None — plan executed exactly as written. Both task files match the specified content precisely; tsc --noEmit passes with exit 0.

## Issues Encountered

`npx tsc` invokes a system-level shim that intercepts the command and does not call the TypeScript compiler. Resolved by using the local binary at `/path/to/project/node_modules/.bin/tsc` directly. No code change needed.

## Known Stubs

None — `evaluateHardRules()` and `resolveField()` are complete pure implementations. The fieldMap lookup returns `undefined` when a key is absent, which fails the rule conservatively — this is intentional behavior, not a stub.

## Threat Flags

No new network endpoints, auth paths, or file access patterns introduced. All STRIDE threats from the plan threat model are addressed:

| Mitigated | File | Description |
|-----------|------|-------------|
| T-04-01: dot-path traversal | src/rules/evaluator.ts | resolveField() checks for null/undefined at each step; no eval(); cannot walk outside the application object |
| T-04-02: PII in reasons[] | src/rules/evaluator.ts | reasons[] contains only config rule labels (e.g., "Salary above ceiling") — never candidate field values |
| T-04-03: salary string injection | src/rules/evaluator.ts | parseFloat produces NaN for non-numeric strings; NaN fails the rule; no code execution possible |
| T-04-04: boolean string spoofing | src/rules/evaluator.ts | .toLowerCase().trim() normalizes before comparison; unexpected values yield undefined which fails the rule |

## Self-Check

### Files exist:

- `src/rules/types.ts` — FOUND
- `src/rules/evaluator.ts` — FOUND

### Commits exist:

- `ca0ea67` — Task 1: define types
- `0817c9c` — Task 2: implement evaluator

### TypeScript:

- `tsc --noEmit` — PASSES (exit 0)

### Acceptance criteria verified:

- `export interface RuleResult` — present in types.ts
- `export interface CandidateDecision` — present in types.ts
- `export function evaluateHardRules(` — present in evaluator.ts
- `function resolveField(` — present in evaluator.ts
- `hardRules.maxSalary` — present
- `hardRules.requiredFields` — present
- `hardRules.requiredBoolean` — present
- `hardRules.requiredKeyword` — present
- `parseFloat(` with `replace(/,/g, '')` — present
- `outcome: reasons.length === 0 ? 'pass' : 'fail'` — present
- `return {` appears exactly once in evaluateHardRules (line 139) — no early returns

## Self-Check: PASSED

## Next Phase Readiness

- Plan 05 (entry point and dry-run logging) can proceed immediately — imports `evaluateHardRules` from `src/rules/evaluator.js` and `CandidateDecision` from `src/rules/types.js`
- All Phase 1 hard-rule business logic is complete and type-safe
- No blockers for Plan 05

---
*Phase: 01-foundation*
*Completed: 2026-05-01*
