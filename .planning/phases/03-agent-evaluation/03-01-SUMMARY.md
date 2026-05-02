---
phase: 03-agent-evaluation
plan: "01"
subsystem: config
tags: [openai-agents, zod, typescript, config, soft-rules]

# Dependency graph
requires:
  - phase: 02-pdf-pipeline
    provides: CandidateContext type and buildCandidateContext() — the input to Phase 3 agent evaluation

provides:
  - "@openai/agents@0.8.5 installed as runtime dependency (Agent, run, MaxTurnsExceededError exports verified)"
  - "configSchema extended with optional softRules key (softRuleEntrySchema, softRulesSchema)"
  - "Config type now includes softRules?: { required: SoftRule[]; optional: SoftRule[] } | undefined"
  - "config.yaml populated with softRules block (2 required + 1 optional entries) for end-to-end testing"

affects:
  - "03-agent-evaluation/03-02 (types) — depends on @openai/agents SDK being available"
  - "03-agent-evaluation/03-03 (evaluator) — depends on Config.softRules type and config.yaml block"
  - "04-live-mode — inherits Config type with softRules"

# Tech tracking
tech-stack:
  added:
    - "@openai/agents@0.8.5 — Agent loop, structured output, run orchestration"
    - "@openai/agents-core@0.8.5, @openai/agents-openai@0.8.5, @openai/agents-realtime@0.8.5 (transitive)"
    - "openai@6.35.0 (transitive HTTP client)"
  patterns:
    - "softRules Zod sub-schema follows existing named-const pattern (softRuleEntrySchema, softRulesSchema)"
    - "Optional top-level config key with array defaults — arrays default to [] so consumers never null-check"

key-files:
  created: []
  modified:
    - "package.json — @openai/agents@^0.8.5 added to dependencies"
    - "package-lock.json — lockfile updated with resolved @openai/agents@0.8.5 and 97 transitive deps"
    - "src/config/schema.ts — softRuleEntrySchema + softRulesSchema + configSchema.softRules key added"
    - "config.yaml — softRules block appended (2 required + 1 optional entries)"

key-decisions:
  - "softRules is optional at the top level of configSchema for backward compatibility (CONTEXT.md Claude's Discretion)"
  - "Both required[] and optional[] arrays default to [] so downstream code can iterate without null checks"
  - "npm install ran in worktree directory (not main repo) — worktree has its own node_modules"

patterns-established:
  - "softRuleEntrySchema pattern: label + description fields matching hard-rule label pattern from Phase 1"
  - "Optional wrapper with defaulted arrays: z.object({ required: z.array(...).optional().default([]), optional: ... }).optional()"

requirements-completed:
  - RULE-02
  - SAFE-02

# Metrics
duration: 15min
completed: 2026-05-02
---

# Phase 3 Plan 01: SDK Install and Config Schema Extension Summary

**@openai/agents@0.8.5 installed as runtime dependency and configSchema extended with optional softRules key (D-01, D-02) — unblocks Plans 02 and 03 in Wave 1**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-02T08:00:00Z
- **Completed:** 2026-05-02T08:15:00Z
- **Tasks:** 3
- **Files modified:** 4

## Accomplishments

- Installed `@openai/agents@0.8.5` as a runtime dependency; `Agent`, `run`, and `MaxTurnsExceededError` exports verified at runtime on Node.js 22
- Extended `configSchema` in `src/config/schema.ts` with `softRuleEntrySchema` (label + description) and optional `softRulesSchema` wrapper; existing configs without `softRules` continue to validate (backward-compatible)
- Populated `config.yaml` with a working `softRules` block matching CONTEXT.md D-01/D-02 example verbatim: 2 required entries, 1 optional entry; `loadConfig()` parses and validates through Zod schema (`required=2`, `optional=1`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Install @openai/agents SDK** - `da6c201` (chore)
2. **Task 2: Extend configSchema with optional softRules key** - `473e70b` (feat)
3. **Task 3: Add softRules block to config.yaml** - `268de89` (feat)

**Plan metadata:** (docs commit — see final commit hash after SUMMARY commit)

## Files Created/Modified

- `package.json` — `@openai/agents@^0.8.5` added to `dependencies` block
- `package-lock.json` — lockfile updated with resolved `@openai/agents@0.8.5` and transitive deps (97 new packages, lockfile v1 format)
- `src/config/schema.ts` — `softRuleEntrySchema`, `softRulesSchema`, and `softRules: softRulesSchema` key added to `configSchema`; `Config` type now includes `softRules?: { required: ...; optional: ... } | undefined`
- `config.yaml` — `softRules:` block appended at end of file (peer level with `job`, `hardRules`, `fieldMap`)

## Decisions Made

- `softRules` is optional at the configSchema top level — existing Phase 1/2 configs without `softRules` remain valid. Backward compatibility was the locked behavior per CONTEXT.md Claude's Discretion.
- Both `required[]` and `optional[]` arrays `.optional().default([])` — downstream evaluator can iterate without null checks regardless of whether entries are present.
- npm install ran in the worktree directory (worktree has its own `node_modules`, distinct from the main repo). This is correct behavior for a git worktree.

## Deviations from Plan

**1. [Rule 1 - Deviation Note] package-lock.json has 1 match for "@openai/agents" (not 2)**

- **Found during:** Task 1 verification
- **Issue:** Plan acceptance criteria expected `grep '"@openai/agents"' package-lock.json` to return at least 2 matches (npm v3 lockfile format). Project uses lockfile v1 (npm 6), which has a single entry per package.
- **Fix:** Not a bug — lockfile v1 format is correct behavior. The package IS installed and resolved. Documented as a lockfile format difference, not a failure.
- **Verification:** `npm ls @openai/agents` returns `@openai/agents@0.8.5`; `node -e "import(...)"` on Node 22 prints `function function function`; `node_modules/@openai/agents/package.json` exists with `peerDependencies.zod: "^4.0.0"`.
- **Impact:** Zero — package is fully installed and functional.

---

**Total deviations:** 1 (documentation note — no code changes needed)
**Impact on plan:** No scope creep. The deviation was a lockfile format difference, not a functional issue.

## Issues Encountered

- The shell's default `node` was v14.21.3 (old system node). Dynamic import of `@openai/agents` failed when tested with system `node`. Resolved by using the full path to Node.js 22 binary (`$HOME/.nvm/versions/node/v22.22.2/bin/node`) for verification commands, and `npx tsx` for TypeScript-level checks.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `@openai/agents` SDK is installed and importable — Plans 02 (types) and 03 (evaluator) can import from `@openai/agents`
- `Config.softRules` type is defined and optional — Plan 03 evaluator will read `config.softRules?.required` and `config.softRules?.optional`
- `config.yaml` has a working `softRules` block for end-to-end dry-run testing in Plans 03 and 04
- `tsc --noEmit` exits 0 — no type errors introduced

## Self-Check: PASSED

- FOUND: `.planning/phases/03-agent-evaluation/03-01-SUMMARY.md`
- FOUND: `package.json` (contains `@openai/agents@^0.8.5`)
- FOUND: `src/config/schema.ts` (contains `softRules: softRulesSchema`)
- FOUND: `config.yaml` (contains `softRules:` block)
- FOUND: commit `da6c201` — chore(03-01): install @openai/agents@0.8.5
- FOUND: commit `473e70b` — feat(03-01): extend configSchema with optional softRules key
- FOUND: commit `268de89` — feat(03-01): add softRules block to config.yaml

---
*Phase: 03-agent-evaluation*
*Completed: 2026-05-02*
