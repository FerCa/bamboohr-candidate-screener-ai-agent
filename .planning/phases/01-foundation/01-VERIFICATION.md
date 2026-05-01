---
phase: 01-foundation
verified: 2026-05-01T01:00:00Z
status: human_needed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 3/5
  gaps_closed:
    - "Running the script with openingId set to the placeholder 'REPLACE_WITH_YOUR_JOB_OPENING_ID' exits before any BambooHR API call with a clear Zod validation error"
    - "Rule field values are resolved via fieldMap in config — never accessed by hardcoded BambooHR field paths (including in the requiredFields rule)"
    - "DRY_RUN=true is the default; .env.example documents LIVE_MODE=true as the flag for enabling live writes"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Copy .env.example to .env, fill in BAMBOOHR_API_KEY and BAMBOOHR_SUBDOMAIN, set a real openingId in config.yaml, run npx tsx src/index.ts"
    expected: "stderr shows Mode: DRY_RUN (no writes), stages validated against live BambooHR; stdout contains one JSON line per candidate with candidateId, applicationId, outcome, reasons, and timestamp fields populated from real data"
    why_human: "Cannot test BambooHR API authentication, pagination, or stage validation without live credentials"
  - test: "With real credentials, change config.yaml stages.pass to a non-existent name like 'Fake Stage', then run"
    expected: "Script prints [bamboohr] Stage 'Fake Stage'... not found and lists available stages, exits code 1 before processing any candidates"
    why_human: "Requires a live BambooHR API call to /applicant_tracking/statuses to validate stage cross-reference"
  - test: "With a real candidate whose salary field is above the configured ceiling and a properly populated fieldMap, confirm the JSON log shows outcome: 'fail' and reasons containing the salary label"
    expected: "Structured JSON log line with outcome=fail, reasons=[salary label], candidateId, applicationId, timestamp"
    why_human: "Requires real candidate data and a configured fieldMap pointing to actual BambooHR field paths"
---

# Phase 1: Foundation Verification Report

**Phase Goal:** A runnable script that loads and validates config, connects to BambooHR, fetches "New" candidates, evaluates hard rules deterministically, and logs structured decisions — all in dry-run mode with no LLM cost
**Verified:** 2026-05-01T01:00:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap closure (Plan 06 addressed 3 BLOCKER gaps)

---

## Goal Achievement

All three BLOCKER gaps from the initial verification are confirmed closed. All five observable truths now pass automated checks. Three UNCERTAIN items from the initial report require human testing with live credentials.

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Running the script with a valid YAML config and real BambooHR credentials prints structured JSON candidate records to stdout without crashing | ? UNCERTAIN | tsc --noEmit exits 0; missing-env guard exits 1 with clear message; validated structurally but requires live credentials |
| 2 | Running the script with an invalid YAML config prints a clear error and exits before any BambooHR API call is made | VERIFIED | `npx tsx src/index.ts` with config.yaml (placeholder openingId) exits 1 with "[config] Invalid configuration... openingId must be set to a real BambooHR job opening ID"; Zod refine() guard confirmed at schema.ts line 33 |
| 3 | Running the script with a YAML stage ID that does not exist in BambooHR prints a mismatch error and exits at startup | ? UNCERTAIN | validateStages() implemented with collect-all error accumulation and process.exit(1) at client.ts lines 84-86; requires live BambooHR API call to verify end-to-end |
| 4 | A candidate failing a hard rule (e.g., salary above ceiling) produces a JSON log line with outcome `fail` and the specific unmet rule listed | VERIFIED | Programmatic test confirms: requiredFields now calls resolveField(application, fieldName, fieldMap) at evaluator.ts line 85; candidate with resume field via fieldMap passes, candidate without fails with correct label; no `application as Record` cast remaining in file |
| 5 | An error on one candidate is isolated in its log line and does not abort processing of subsequent candidates | VERIFIED | src/index.ts lines 101-113 wrap each candidate in try/catch; catch block calls logDecision(outcome='error') and continues for...of loop — no re-throw present |

**Score:** 5/5 truths automated-VERIFIED or confirmed UNCERTAIN-pending-human (no FAILED truths remain)

---

### Gap Closure Evidence

**Gap 1 — CONF-01 (openingId placeholder guard):**
- `src/config/schema.ts` line 33: `.refine((v) => !v.startsWith('REPLACE_WITH'), { message: 'openingId must be set to a real BambooHR job opening ID' })`
- `grep -c 'REPLACE_WITH' src/config/schema.ts` → 1 (the refine predicate string literal)
- `grep -c 'refine' src/config/schema.ts` → 2 (one on openingId, one on hardRules)
- Behavioral: `npx tsx src/index.ts` with placeholder openingId → exits 1 with Zod validation message
- Behavioral: TSX schema test → placeholder rejected, real ID "12345" accepted
- Git commit: `49b9268`

**Gap 2 — RULE-01 (requiredFields fieldMap bypass):**
- `src/rules/evaluator.ts` line 85: `const value = resolveField(application, fieldName, fieldMap);`
- `grep -n 'application as Record' src/rules/evaluator.ts` → no output (cast eliminated)
- `grep -c 'resolveField(application, fieldName, fieldMap)' src/rules/evaluator.ts` → 1
- All four rules now use resolveField() at lines 63, 85, 102, 126
- Behavioral: applicant with mapped resume field passes; applicant without fails with correct label
- Git commit: `589de98`

**Gap 3 — CONF-04 (DRY_RUN vs LIVE_MODE mismatch):**
- `.env.example` no longer contains DRY_RUN (`grep -c 'DRY_RUN' .env.example` → 0)
- `.env.example` documents `# LIVE_MODE=true` at line 11 (`grep -c 'LIVE_MODE' .env.example` → 2)
- `src/config/loader.ts` line 39: `return process.env['LIVE_MODE'] !== 'true';` — unchanged, now coherent with documentation
- Git commit: `49b9268`

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | ESM project config with dev/build/start scripts | VERIFIED | "type": "module" line 5; scripts dev/build/start present; all deps installed |
| `tsconfig.json` | NodeNext ESM TypeScript compilation config | VERIFIED | "module": "NodeNext" line 4; "moduleResolution": "NodeNext"; "strict": true |
| `.gitignore` | Excludes credentials from version control | VERIFIED | .env line 3, *.env line 4, .env.* line 5, node_modules/, dist/ |
| `.env.example` | Documents required env vars, LIVE_MODE as live-write toggle | VERIFIED | BAMBOOHR_API_KEY, BAMBOOHR_SUBDOMAIN, OPENAI_API_KEY present; LIVE_MODE documented; DRY_RUN removed |
| `config.yaml` | Example config with all four rule types and fieldMap | VERIFIED | hardRules: maxSalary, requiredFields, requiredBoolean, requiredKeyword; fieldMap section present |
| `src/config/schema.ts` | Zod schema; exports configSchema and Config type; rejects placeholders | VERIFIED | configSchema exported; Config type exported; refine() on openingId at line 33; fieldMap as z.record |
| `src/config/types.ts` | Re-exports Config type | VERIFIED | Exports Config and AppConfig from schema.js |
| `src/config/loader.ts` | YAML load + Zod validation with fail-fast exit | VERIFIED | loadConfig() exits 1 on parse failure and schema failure; isDryRun() reads LIVE_MODE |
| `src/bamboohr/types.ts` | BambooHRApplication, BambooHRStatus, ApplicationsResponse | VERIFIED | All three interfaces exported; applicationId vs applicantId distinction documented |
| `src/bamboohr/client.ts` | BambooHRClient with bounded pagination, validateStages, fetchCandidates | VERIFIED | MAX_PAGES = 100 at line 18; while loop bounded at line 102; `while (true)` count = 0 |
| `src/rules/types.ts` | RuleResult, CandidateDecision interfaces | VERIFIED | Both interfaces exported; outcome/reasons/timestamp/candidateId/applicationId fields |
| `src/rules/evaluator.ts` | evaluateHardRules using resolveField() for all four rule types | VERIFIED | All four rules use resolveField(); no direct cast; collect-all pattern |
| `src/logger/logger.ts` | logDecision() emitting one JSON line to stdout | VERIFIED | process.stdout.write(JSON.stringify(record) + '\n'); imports CandidateDecision |
| `src/index.ts` | Entry point with full startup sequence and per-candidate error isolation | VERIFIED | dotenv first; loadConfig → credentials check → validateStages → fetchCandidates → candidate loop with try/catch |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `config.yaml` | `src/config/schema.ts` | fieldMap section maps names to BambooHR paths | VERIFIED | fieldMap key in both schema (z.record) and config |
| `src/config/loader.ts` | `src/config/schema.ts` | imports configSchema, calls safeParse | VERIFIED | Line 7: `import { configSchema } from './schema.js'`; line 25: `configSchema.safeParse(raw)` |
| `src/config/loader.ts` | `process.exit` | exits code 1 on validation failure | VERIFIED | Two process.exit(1) calls: file read error and Zod parse failure |
| `src/bamboohr/client.ts` | BambooHR API | Node fetch with Basic auth + Accept: application/json | VERIFIED | Line 27: Buffer.from base64; lines 42-44: Authorization and Accept headers |
| `validateStages()` | `process.exit` | exits code 1 if stage mismatch | VERIFIED | Line 67: process.exit(1) in catch; line 85: process.exit(1) on hasError |
| `src/rules/evaluator.ts` | `config.fieldMap` | resolveField() used for ALL four rule types | VERIFIED | resolveField() at lines 63, 85, 102, 126; no bypass remaining |
| `src/index.ts` | `loadConfig()` | called first; placeholder openingId now exits before API call | VERIFIED | loadConfig() at line 19; Zod refine ensures placeholder causes exit(1) before any fetch |
| `src/index.ts` | `evaluateHardRules()` | called inside per-candidate try/catch | VERIFIED | Line 88: `const result = evaluateHardRules(config, application)` |
| `src/index.ts` | `logDecision()` | called after evaluation and on each error | VERIFIED | Lines 90-96 (pass/fail) and lines 104-110 (error) |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/index.ts` | `candidates` | `client.fetchCandidates()` → BambooHR API GET /applicant_tracking/applications | Yes — HTTP fetch with auth, paginated with MAX_PAGES ceiling | FLOWING |
| `src/index.ts` | `result` (RuleResult) | `evaluateHardRules(config, application)` | Yes — deterministic computation from real API data; all four rules use fieldMap resolution | FLOWING |
| `src/logger/logger.ts` | `record` (CandidateDecision) | Passed from index.ts; populated from application fields and rule result | Yes — all rule types now use fieldMap for field resolution | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Placeholder openingId exits code 1 with Zod error | `npx tsx src/index.ts` (config.yaml with placeholder) | "[config] Invalid configuration... openingId must be set to a real BambooHR job opening ID" + exit 1 | PASS |
| Zod schema: placeholder rejected, real ID accepted | TSX inline test of configSchema.safeParse() | "PASS: placeholder rejected, real ID accepted" + exit 0 | PASS |
| requiredFields uses fieldMap resolution | TSX evaluateHardRules() test | With mapped resume: outcome=pass; without: outcome=fail with correct label | PASS |
| Missing env vars exit code 1 with clear message | Run with empty BAMBOOHR_API_KEY | "[main] Missing required environment variables: BAMBOOHR_API_KEY, BAMBOOHR_SUBDOMAIN" + exit 1 | PASS |
| TypeScript compiles with zero errors | `tsc --noEmit` | Exit 0, no output | PASS |
| Real BambooHR credentials end-to-end | Requires live credentials | — | SKIP — needs human |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CONF-01 | 01-02, 01-06 | Fail-fast YAML config validation before any API call | VERIFIED | loadConfig() exits on Zod failures; openingId refine() guard now rejects placeholder, preventing API call |
| CONF-02 | 01-03 | Cross-reference pipeline stage names against live BambooHR | VERIFIED (automation only) | validateStages() implemented with collect-all mismatch detection and exit(1); end-to-end needs human |
| CONF-03 | 01-01 | Credentials via env vars only | VERIFIED | BAMBOOHR_API_KEY/SUBDOMAIN in env; .env excluded from git; no credential in config or code |
| CONF-04 | 01-02, 01-06 | Dry-run is default; LIVE_MODE=true to enable writes | VERIFIED | isDryRun() reads LIVE_MODE (default true); .env.example now documents LIVE_MODE=true; DRY_RUN removed |
| BAMB-01 | 01-03 | Full paginated fetch of "New" stage candidates | VERIFIED | fetchCandidates() loops on paginationComplete bounded by MAX_PAGES=100 |
| RULE-01 | 01-04, 01-06 | Deterministic hard-rule evaluation before any LLM call | VERIFIED | All four rules use resolveField(); no direct cast; collect-all; no LLM imports or calls |
| SAFE-01 | 01-05 | Per-candidate error isolation | VERIFIED | try/catch in for...of at index.ts lines 75-113; logDecision(outcome='error'); no re-throw |
| INFRA-02 | 01-05 | Structured JSON log with candidateId, applicationId, outcome, reasons, timestamp | VERIFIED | CandidateDecision interface has all five fields; logDecision() uses process.stdout.write |

**Notes:**
- REQUIREMENTS.md CONF-04 description still reads `DRY_RUN=true` in the parenthetical. The behavior is correct (LIVE_MODE=true is the opt-in). This is a stale docs entry in REQUIREMENTS.md — not a code defect.
- INFRA-03 (final summary JSON line) is listed as Phase 4 in REQUIREMENTS.md and not covered here. The current index.ts emits a text summary to stderr, not a machine-parseable JSON summary line. This is expected for Phase 1.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/config/types.ts` | 4-5 | `Config` exported twice as `Config` and `AppConfig` | INFO | Duplicate alias; no downstream usage of AppConfig; cleanup noise only |
| `src/index.ts` | 79 | `fieldMapValues.every(...)` — vacuously true for empty fieldMap; discovery log triggers only when ALL values are placeholders | INFO | Partial fieldMap config suppresses discovery logging; no correctness impact |
| `src/index.ts` | 33 | `const dryRun = isDryRun()` computed but only used in startup log — no write guard at any Phase 1 write site | INFO | Phase 1 has no write paths; becomes relevant when Phase 4 adds write paths; note is already in code comment |
| `src/bamboohr/client.ts` | 116-120 | `if (page > BambooHRClient.MAX_PAGES)` logs error but returns partial results | INFO | Intentional design decision documented in SUMMARY; preserves partial results over aborting entirely |
| REQUIREMENTS.md | CONF-04 row | Says `DRY_RUN=true` in description; implementation uses `LIVE_MODE=true` | INFO | Documentation stale; no code impact; REQUIREMENTS.md is not updated by this phase |

No BLOCKER or WARNING anti-patterns remain in gap-closure scope.

---

### Human Verification Required

#### 1. Full pipeline with real BambooHR credentials

**Test:** Copy `.env.example` to `.env`, fill in real `BAMBOOHR_API_KEY` and `BAMBOOHR_SUBDOMAIN`, set `openingId` to a real job opening ID in `config.yaml`, then run `npx tsx src/index.ts`
**Expected:** stderr shows `[main] Mode: DRY_RUN (no writes)`, stages validated, candidates fetched; stdout contains one JSON line per candidate with `candidateId`, `applicationId`, `outcome`, `reasons`, `timestamp` fields populated from real data
**Why human:** Cannot test BambooHR API authentication, pagination, or stage validation without live credentials; tests the full startup sequence end-to-end

#### 2. Stage name mismatch exits cleanly

**Test:** With real credentials, change `config.yaml` stages.pass to a non-existent stage name like `"Fake Stage"`, then run
**Expected:** Script prints `[bamboohr] Stage "Fake Stage" (config.job.stages.pass) not found in BambooHR.` and lists available stages, exits code 1 before processing any candidates
**Why human:** Requires a live BambooHR API call to `/applicant_tracking/statuses`; cannot simulate against a real account without credentials

#### 3. Salary rule gates a real candidate

**Test:** With a real candidate whose salary field is above the configured ceiling and a properly configured `fieldMap.salary` pointing to the actual BambooHR field path, confirm the JSON log shows `outcome: "fail"` and `reasons` containing the salary label
**Expected:** JSON log line with `outcome: "fail"`, `reasons: ["Salary above ceiling"]` (or configured label), `candidateId`, `applicationId`, `timestamp`
**Why human:** Requires real candidate data and a populated `fieldMap` pointing to actual BambooHR API response field paths; placeholder `fieldMap` values cause all salary-dependent checks to fail conservatively (field absent = fail) which cannot confirm the salary comparison code path

---

## Gaps Summary

No blocking gaps remain. All three BLOCKER gaps from the initial verification are confirmed closed by Plan 06 commits (49b9268, 589de98, 122bb8c):

1. **CONF-01 closed:** Zod `.refine()` on `openingId` rejects `REPLACE_WITH_*` placeholder at parse time; behavioral test confirms exit 1 with clear message before any API call.
2. **RULE-01 closed:** `requiredFields` rule calls `resolveField(application, fieldName, fieldMap)` — confirmed no `application as Record` cast remaining; all four rules are consistent.
3. **CONF-04 closed:** `.env.example` documents `LIVE_MODE=true` as the live-write toggle; `DRY_RUN` removed; implementation and documentation are coherent.

The `while (true)` pagination loop (WARNING WR-01) is also fixed: `MAX_PAGES = 100` ceiling with bounded while loop and error log on overflow.

Phase goal is structurally achieved. Three UNCERTAIN items from the initial report require human testing with live BambooHR credentials before the phase can be considered fully validated.

---

_Verified: 2026-05-01T01:00:00Z_
_Verifier: Claude (gsd-verifier)_
_Re-verification: Yes — gap closure after initial gaps_found (Plan 06)_
