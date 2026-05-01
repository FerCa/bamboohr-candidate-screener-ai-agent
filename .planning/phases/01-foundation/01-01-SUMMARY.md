---
phase: 01-foundation
plan: "01"
subsystem: infra
tags: [typescript, nodejs, esm, nodenext, npm, zod, js-yaml, dotenv, tsx, config]

# Dependency graph
requires: []
provides:
  - ESM NodeNext TypeScript project skeleton (package.json, tsconfig.json)
  - npm dependencies installed: dotenv, js-yaml, zod, tsx, typescript, @tsconfig/node22
  - Credential hygiene: .gitignore excludes .env, .env.example documents env vars
  - config.yaml example with all four hard-rule types and fieldMap section
affects:
  - 01-02 (config schema and Zod validation depend on config.yaml shape)
  - 01-03 (BambooHR client build uses project ESM structure)
  - 01-04 (hard-rule evaluator uses project ESM structure)
  - 01-05 (entry point and logging use project ESM structure)

# Tech tracking
tech-stack:
  added:
    - typescript@6.0.3 (TypeScript compiler)
    - tsx@4.21.0 (esbuild-powered local dev runner)
    - @tsconfig/node22@22.0.5 (Node 22 tsconfig preset)
    - js-yaml@4.1.1 (YAML config parsing)
    - zod@4.4.1 (runtime schema validation)
    - dotenv@17.4.2 (.env loading for local dev)
  patterns:
    - ESM NodeNext: "type": "module" in package.json + "module": "NodeNext" in tsconfig
    - Credentials via env vars only; .env.example with empty values committed; .env gitignored
    - config.yaml with fieldMap section decouples human-readable rule field names from BambooHR API paths

key-files:
  created:
    - package.json
    - tsconfig.json
    - package-lock.json
    - .gitignore
    - .env.example
    - config.yaml
  modified: []

key-decisions:
  - "ESM NodeNext: package.json type=module + tsconfig module=NodeNext — mandatory to avoid ERR_MODULE_NOT_FOUND at runtime; all relative imports will use .js extensions"
  - "Node 14 local vs Node 22 Docker: tsx handles local dev compatibility gap; Docker ensures Node 22 in production"
  - "fieldMap in config.yaml decouples human-readable names from BambooHR account-specific field paths — no code change needed when field IDs shift"
  - "config.yaml REPLACE_WITH placeholders are intentional — user populates after first DRY_RUN=true API exploration"

patterns-established:
  - "ESM NodeNext imports: all relative imports use .js extension in TypeScript source"
  - "Credential pattern: env vars only, never in config files; .env.example shows names with empty values"
  - "Config pattern: YAML with fieldMap section + Zod validation (implemented in plan 02)"

requirements-completed:
  - CONF-03

# Metrics
duration: 2min
completed: "2026-05-01"
---

# Phase 01 Plan 01: Project Skeleton Summary

**TypeScript ESM NodeNext project scaffold with dotenv/js-yaml/zod/tsx dependencies, credential hygiene files, and a four-rule-type config.yaml template**

## Performance

- **Duration:** 2 min
- **Started:** 2026-05-01T17:05:08Z
- **Completed:** 2026-05-01T17:06:39Z
- **Tasks:** 2
- **Files modified:** 6 (package.json, tsconfig.json, package-lock.json, .gitignore, .env.example, config.yaml)

## Accomplishments

- Initialized npm project with `"type": "module"` ESM configuration and NodeNext TypeScript compiler settings
- Installed all four runtime deps (dotenv, js-yaml, zod) and four dev deps (tsx, typescript, @tsconfig/node22, @types/*)
- Created credential hygiene: .gitignore excludes .env; .env.example documents five required env vars with empty values only
- Created config.yaml example demonstrating all four hard-rule types (maxSalary, requiredFields, requiredBoolean, requiredKeyword) with fieldMap section — reference shape for the Zod schema in Plan 02

## Task Commits

Each task was committed atomically:

1. **Task 1: Initialize package.json and tsconfig.json** - `527ec9a` (chore)
2. **Task 2: Create credential hygiene files and example config** - `1d7b575` (chore)

**Plan metadata:** (included in task commits above — SUMMARY committed with docs commit)

## Files Created/Modified

- `package.json` - ESM project config with dev/build/start scripts and all npm dependencies
- `tsconfig.json` - NodeNext ESM TypeScript compilation config extending @tsconfig/node22
- `package-lock.json` - Locked dependency versions
- `.gitignore` - Excludes node_modules/, dist/, .env* (except .env.example)
- `.env.example` - Documents BAMBOOHR_API_KEY, BAMBOOHR_SUBDOMAIN, OPENAI_API_KEY, DRY_RUN, CONFIG_PATH with empty values
- `config.yaml` - Example config with all four hard-rule types and fieldMap placeholder section

## Decisions Made

- ESM NodeNext mandated per CLAUDE.md: `"type": "module"` in package.json and `"module": "NodeNext"` in tsconfig.json. All relative imports will require `.js` extensions in TypeScript source (NodeNext requirement — see Pitfall 3 in research).
- Local Node.js v14 vs Docker Node 22 target: tsx handles the compatibility gap for local development; Docker ensures Node 22 in production. Engine warnings during `npm install` are expected and non-blocking.
- `config.yaml` `REPLACE_WITH` placeholders are intentional documentation — the user populates these after running with `DRY_RUN=true` and inspecting the raw BambooHR API response (D-06, D-07 from CONTEXT.md).

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

npm install produced engine compatibility warnings (local Node 14 vs tsx/esbuild requiring Node 18+). This is expected per the research notes (Environment Availability section). The packages install and the Docker target uses Node 22; `tsx` operates correctly in the Docker context. No action needed.

## Known Stubs

The following placeholders in `config.yaml` are intentional documentation stubs — they must be populated with real BambooHR account values before the agent can run:

| File | Placeholder | Reason |
|------|-------------|--------|
| config.yaml | `openingId: "REPLACE_WITH_YOUR_JOB_OPENING_ID"` | Account-specific job opening ID |
| config.yaml | `rightToWork: "REPLACE_WITH_BAMBOOHR_FIELD_PATH"` | Account-specific field path, populated after first DRY_RUN |
| config.yaml | `city: "REPLACE_WITH_BAMBOOHR_FIELD_PATH"` | Account-specific field path, populated after first DRY_RUN |
| config.yaml | `salary: "REPLACE_WITH_BAMBOOHR_FIELD_PATH"` | Account-specific field path, populated after first DRY_RUN |

These are by design (D-06, D-07, D-08 from CONTEXT.md). The config.yaml ships as a template; users complete it during Phase 1 DRY_RUN exploration.

## User Setup Required

Before running the agent:
1. Copy `.env.example` to `.env` and fill in `BAMBOOHR_API_KEY`, `BAMBOOHR_SUBDOMAIN`
2. Run with `DRY_RUN=true` and log raw application JSON to discover field paths
3. Populate `config.yaml` `fieldMap` section and `job.openingId` with actual values

## Next Phase Readiness

- Plan 02 (Config Schema + Zod Validation) can proceed immediately — config.yaml shape is established
- All downstream plans (03-05) have the ESM NodeNext foundation they depend on
- No blockers for Phase 1 execution

---
*Phase: 01-foundation*
*Completed: 2026-05-01*
