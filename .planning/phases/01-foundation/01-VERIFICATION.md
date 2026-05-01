---
phase: 01-foundation
verified: 2026-05-01T00:00:00Z
status: gaps_found
score: 3/5 must-haves verified
overrides_applied: 0
gaps:
  - truth: "Running the script with an invalid YAML config prints a clear error and exits before any BambooHR API call is made"
    status: failed
    reason: "The placeholder openingId value 'REPLACE_WITH_YOUR_JOB_OPENING_ID' passes Zod validation (z.string().min(1)) because it is a non-empty string. The agent proceeds to make BambooHR API calls with this nonsense ID rather than failing at config-load time. The fail-fast guarantee does not cover this category of misconfiguration."
    artifacts:
      - path: "src/config/schema.ts"
        issue: "openingId: z.string().min(1) — no refine() guard against placeholder values"
      - path: "config.yaml"
        issue: "openingId: 'REPLACE_WITH_YOUR_JOB_OPENING_ID' is a 38-char string that passes the schema"
    missing:
      - "Add .refine((v) => !v.startsWith('REPLACE_WITH'), { message: 'openingId must be set to a real BambooHR job opening ID' }) to the openingId schema field in src/config/schema.ts"

  - truth: "Rule field values are resolved via fieldMap in config — never accessed by hardcoded BambooHR field paths"
    status: failed
    reason: "The requiredFields rule (Rule 2) uses direct property access on the application object — (application as Record<string, unknown>)[fieldName] — bypassing fieldMap entirely. This contradicts D-07/D-08 and the plan's stated truth. The field name 'resume' is not a top-level BambooHR application key, so the check always evaluates to undefined, causing every candidate to permanently fail this rule with the label 'CV not attached' regardless of whether they have a CV. This is a correctness failure in a primary gate rule."
    artifacts:
      - path: "src/rules/evaluator.ts"
        issue: "Lines 83-88: requiredFields iterates fields with direct top-level object access instead of using resolveField(application, fieldName, fieldMap)"
    missing:
      - "Replace the direct property access loop in the requiredFields block with resolveField(application, fieldName, fieldMap) consistent with Rules 3 and 4"

  - truth: "DRY_RUN=true is the default; the script logs [DRY_RUN] prefix on startup and makes no writes to BambooHR"
    status: failed
    reason: "The documented operator-facing env var is DRY_RUN (shown in .env.example line 9: 'DRY_RUN=true'), but isDryRun() reads LIVE_MODE, not DRY_RUN. Setting DRY_RUN=false in .env — following .env.example instructions — has zero effect on whether writes happen. This creates a silent live-mode activation trap: when Phase 4 adds write paths, an operator who follows .env.example and sets DRY_RUN=false will believe they have disabled dry-run but the system will remain in dry-run mode indefinitely. Alternatively, an operator who correctly sets LIVE_MODE=true will not have DRY_RUN documented as the flag to disable. The two flags are fundamentally misaligned."
    artifacts:
      - path: "src/config/loader.ts"
        issue: "Line 39: isDryRun() reads process.env['LIVE_MODE'] !== 'true' — never reads DRY_RUN"
      - path: ".env.example"
        issue: "Line 9: documents DRY_RUN=true as the runtime flag, but this variable has no effect"
    missing:
      - "Either remove DRY_RUN from .env.example and add a LIVE_MODE=false comment (preferred — one flag), or update isDryRun() to honour DRY_RUN=false as an alternative to LIVE_MODE=true"
---

# Phase 1: Foundation Verification Report

**Phase Goal:** A runnable script that loads and validates config, connects to BambooHR, fetches "New" candidates, evaluates hard rules deterministically, and logs structured decisions — all in dry-run mode with no LLM cost
**Verified:** 2026-05-01T00:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Running the script with a valid YAML config and real BambooHR credentials prints structured JSON candidate records to stdout without crashing | ? UNCERTAIN | TypeScript compiles clean (tsc --noEmit exits 0); missing env var guard verified behaviorally (exits 1 with clear message); needs human with real credentials |
| 2 | Running the script with an invalid YAML config prints a clear error and exits before any BambooHR API call is made | PARTIAL | loadConfig() correctly exits on Zod schema failures; however the placeholder openingId "REPLACE_WITH_YOUR_JOB_OPENING_ID" passes Zod validation and causes the agent to proceed to API calls — the fail-fast guarantee is incomplete |
| 3 | Running the script with a YAML stage ID that does not exist in BambooHR prints a mismatch error and exits at startup | ? UNCERTAIN | validateStages() is correctly implemented with collect-all error accumulation and process.exit(1); needs human with real credentials to verify end-to-end |
| 4 | A candidate failing a hard rule (e.g., salary above ceiling) produces a JSON log line with outcome `fail` and the specific unmet rule listed | PARTIAL | maxSalary, requiredBoolean, and requiredKeyword rules correctly emit reasons[] labels; requiredFields rule has a correctness bug — it bypasses fieldMap and uses direct top-level object access, causing 'resume' to always evaluate as absent |
| 5 | An error on one candidate is isolated in its log line and does not abort processing of subsequent candidates | VERIFIED | src/index.ts lines 75-113 wrap each candidate in try/catch; catch block calls logDecision(outcome='error') and continues the for...of loop without re-throwing |

**Score:** 2/5 truths fully VERIFIED (Truth 5 verified; Truth 1 and 3 are UNCERTAIN pending human testing; Truths 2 and 4 are PARTIAL/FAILED due to code defects)

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `package.json` | ESM project config with dev/build/start scripts | VERIFIED | "type": "module", scripts present, all deps installed |
| `tsconfig.json` | NodeNext ESM TypeScript compilation config | VERIFIED | "module": "NodeNext", "moduleResolution": "NodeNext", "strict": true, "types": ["node"] |
| `.gitignore` | Excludes credentials from version control | VERIFIED | .env on line 3, node_modules/ and dist/ present |
| `.env.example` | Documents required env vars without values | VERIFIED (with caveat) | BAMBOOHR_API_KEY, BAMBOOHR_SUBDOMAIN, OPENAI_API_KEY present; DRY_RUN=true documented but has no effect (see Gap 3) |
| `config.yaml` | Example config with all four rule types and fieldMap | VERIFIED | All four rule types present; fieldMap section present |
| `src/config/schema.ts` | Zod schema; exports configSchema and Config type | VERIFIED | export const configSchema and export type Config present; all four rule sub-schemas present; fieldMap as z.record |
| `src/config/types.ts` | TypeScript interfaces derived from Zod schema | VERIFIED | Re-exports Config and AppConfig from schema.js (AppConfig alias is noise — see Anti-Patterns) |
| `src/config/loader.ts` | YAML load + Zod validation with fail-fast exit | VERIFIED (with gap) | loadConfig() exits on schema failure; isDryRun() reads LIVE_MODE not DRY_RUN (see Gap 3) |
| `src/bamboohr/types.ts` | BambooHRApplication, BambooHRStatus, ApplicationsResponse | VERIFIED | All three interfaces exported; applicationId vs applicantId distinction in JSDoc |
| `src/bamboohr/client.ts` | BambooHRClient with get(), validateStages(), fetchCandidates() | VERIFIED (with warning) | Class exported; Accept: application/json on all requests; Buffer.from base64 auth; validateStages exits on mismatch; pagination loops on paginationComplete; no MAX_PAGES guard (WR-01) |
| `src/rules/types.ts` | RuleResult, CandidateDecision interfaces | VERIFIED | Both interfaces exported with correct field shapes |
| `src/rules/evaluator.ts` | evaluateHardRules(config, application) function | PARTIAL | All four rule blocks present and collect-all (single return); maxSalary, requiredBoolean, requiredKeyword use fieldMap correctly; requiredFields uses direct object access bypassing fieldMap (Gap 2) |
| `src/logger/logger.ts` | logDecision() emitting one JSON line to stdout | VERIFIED | process.stdout.write(JSON.stringify(record) + '\n'); imports CandidateDecision from types.js |
| `src/index.ts` | Entry point with full startup sequence | VERIFIED (with warning) | dotenv/config first import; loadConfig → credentials check → validateStages → fetchCandidates → candidate loop; SAFE-01 error isolation; no write API calls; dryRun computed but not used as a guard (WR-02) |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `config.yaml` | `src/config/schema.ts` | fieldMap section maps names to BambooHR paths | VERIFIED | fieldMap key present in schema and config |
| `src/config/loader.ts` | `src/config/schema.ts` | imports configSchema, calls safeParse | VERIFIED | Line 7: `import { configSchema } from './schema.js'`; Line 25: `configSchema.safeParse(raw)` |
| `src/config/loader.ts` | `process.exit` | exits with code 1 on validation failure | VERIFIED | Two process.exit(1) calls: one on file read error, one on Zod parse failure |
| `src/bamboohr/client.ts` | BambooHR API | Node fetch with Basic auth + Accept: application/json | VERIFIED | Line 24: Buffer.from base64; Lines 40-41: Authorization and Accept headers |
| `src/bamboohr/client.ts` | `src/bamboohr/types.ts` | BambooHRApplication used in return types | VERIFIED | Line 7-11: imports BambooHRApplication, BambooHRStatus, ApplicationsResponse |
| `validateStages()` | `process.exit` | exits with code 1 if stage mismatch | VERIFIED | Line 64: process.exit(1) in catch; Line 82: process.exit(1) on hasError |
| `src/rules/evaluator.ts` | `config.fieldMap` | resolveField() uses fieldMap for Rules 1, 3, 4 | PARTIAL | resolveField() correctly uses fieldMap for maxSalary, requiredBoolean, requiredKeyword; Rule 2 (requiredFields) bypasses fieldMap entirely |
| `src/rules/evaluator.ts` | `src/rules/types.ts` | returns RuleResult | VERIFIED | Line 8: `import type { RuleResult } from './types.js'`; return type matches |
| `src/index.ts` | `loadConfig()` | called first; exits before any API call if config invalid | PARTIAL | loadConfig() called first at line 19; but openingId placeholder passes Zod, allowing API calls with invalid job ID |
| `src/index.ts` | `BambooHRClient.validateStages()` | called after config load | VERIFIED | Line 44: `await client.validateStages(config)` |
| `src/index.ts` | `evaluateHardRules()` | called inside per-candidate try/catch | VERIFIED | Line 88: `const result = evaluateHardRules(config, application)` |
| `src/index.ts` | `logDecision()` | called after each evaluation and on each error | VERIFIED | Lines 90-96 (pass/fail) and lines 104-110 (error) |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `src/index.ts` | `candidates` | `client.fetchCandidates()` → BambooHR API GET /applications | Yes — HTTP fetch with auth, paginated | FLOWING |
| `src/index.ts` | `result` (RuleResult) | `evaluateHardRules(config, application)` | Yes — deterministic computation from real API data | FLOWING |
| `src/logger/logger.ts` | `record` (CandidateDecision) | Passed from index.ts; populated from application fields and rule result | Yes — but requiredFields rule uses hardcoded top-level access not real fieldMap paths | PARTIAL |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Missing env vars exit with clear message and code 1 | `nvm exec 18 tsx src/index.ts` (no env vars) | "[main] Missing required environment variables: BAMBOOHR_API_KEY, BAMBOOHR_SUBDOMAIN" + exit 1 | PASS |
| TypeScript type-checks with zero errors | `node_modules/.bin/tsc --noEmit` | Exit 0, no output | PASS |
| Script requires Node 18+; tsx fails on Node 14 | Running on local Node v14.21.3 | SyntaxError in tsx cli.mjs | INFO (expected per plan docs) |
| Real BambooHR credential run | Cannot test without credentials | — | SKIP — needs human |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CONF-01 | 01-02 | Fail-fast YAML config validation before any API call | PARTIAL | loadConfig() exits on Zod failures; openingId placeholder bypasses fail-fast |
| CONF-02 | 01-03 | Cross-reference pipeline stage names against live BambooHR | VERIFIED | validateStages() implemented with collect-all mismatch detection and exit(1) |
| CONF-03 | 01-01 | Credentials via env vars only | VERIFIED | BAMBOOHR_API_KEY/SUBDOMAIN in env; .env excluded from git; no credential in config or code |
| CONF-04 | 01-02, 01-05 | Dry-run is default | PARTIAL | isDryRun() returns true by default (LIVE_MODE not set); but .env.example documents DRY_RUN not LIVE_MODE — operator contract is broken |
| BAMB-01 | 01-03 | Full paginated fetch of "New" stage candidates | VERIFIED | fetchCandidates() loops on paginationComplete with page integer param |
| RULE-01 | 01-04 | Deterministic hard-rule evaluation before any LLM call | PARTIAL | Three of four rules are correct; requiredFields bypasses fieldMap — correctness defect |
| SAFE-01 | 01-05 | Per-candidate error isolation | VERIFIED | try/catch in for...of; logDecision(outcome='error'); no re-throw |
| INFRA-02 | 01-05 | Structured JSON log with candidateId, applicationId, outcome, reasons, timestamp | VERIFIED | CandidateDecision interface has all five fields; logDecision() uses process.stdout.write |

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/rules/evaluator.ts` | 84 | `(application as Record<string, unknown>)[fieldName]` — direct top-level access bypassing fieldMap in requiredFields rule | BLOCKER | Every candidate permanently fails 'CV not attached' rule regardless of actual resume presence; rule is non-functional |
| `src/config/schema.ts` | 30 | `openingId: z.string().min(1)` — accepts placeholder value "REPLACE_WITH_YOUR_JOB_OPENING_ID" | BLOCKER | Agent makes API calls with invalid job ID instead of exiting at config-load time |
| `.env.example` | 9 | `DRY_RUN=true` documented but `isDryRun()` reads `LIVE_MODE` | BLOCKER | Silent operator misconfiguration trap — Phase 4 write paths will not be gated by the documented variable |
| `src/bamboohr/client.ts` | 99 | `while (true)` pagination loop with no page-count ceiling | WARNING | Infinite loop risk if BambooHR API never returns paginationComplete=true |
| `src/index.ts` | 33 | `const dryRun = isDryRun()` computed but only used in startup log — no guard at any write site | WARNING | When Phase 4 adds write paths, there is no write-guard template to copy; write paths may be added without isDryRun() check |
| `src/index.ts` | 79 | `fieldMapValues.every(...)` — vacuously true for empty fieldMap; only triggers when ALL values are placeholders | WARNING | Partial fieldMap configuration suppresses discovery logging when operator needs it |
| `src/config/types.ts` | 4-5 | `Config` exported twice as both `Config` and `AppConfig` | INFO | Duplicate alias; no downstream usage of AppConfig; cleanup noise |

---

### Human Verification Required

#### 1. Full pipeline with real BambooHR credentials

**Test:** Copy `.env.example` to `.env`, fill in real `BAMBOOHR_API_KEY` and `BAMBOOHR_SUBDOMAIN`, set `openingId` to a real job opening ID in `config.yaml`, then run `npx tsx src/index.ts`
**Expected:** stderr shows mode DRY_RUN, stages validated, candidates fetched; stdout contains one JSON line per candidate with candidateId, applicationId, outcome, reasons, timestamp fields populated from real data
**Why human:** Cannot test against real BambooHR API without live credentials; tests authentication, pagination, and stage validation end-to-end

#### 2. Stage name mismatch exits cleanly

**Test:** With real credentials, change `config.yaml` stages.pass to a non-existent stage name like "Fake Stage", then run
**Expected:** Script prints "[bamboohr] Stage 'Fake Stage'... not found" and lists available stages, exits code 1 before processing any candidates
**Why human:** Requires live BambooHR API call to /applicant_tracking/statuses

#### 3. Salary rule actually gates a candidate

**Test:** With a real candidate whose salary field is above the configured ceiling, confirm the JSON log shows `outcome: "fail"` and `reasons: ["Salary above ceiling"]`
**Why human:** Requires real candidate data with populated fieldMap paths; cannot simulate fieldMap resolution with placeholder paths

---

## Gaps Summary

Three blockers prevent full phase goal achievement:

**Gap 1 (openingId placeholder passes Zod — CONF-01 incomplete):** The schema accepts "REPLACE_WITH_YOUR_JOB_OPENING_ID" as a valid openingId because it is a non-empty string. ROADMAP Success Criterion 2 requires the script to exit before any API call with an invalid config — this criterion is not fully met. The fix is a single `.refine()` call on the openingId field.

**Gap 2 (requiredFields bypasses fieldMap — RULE-01 broken):** The requiredFields rule in `src/rules/evaluator.ts` does a direct top-level property lookup instead of using `resolveField()` with `fieldMap`. Since `resume` is not a top-level key on a BambooHR application object, this check always evaluates as absent, permanently failing every candidate on "CV not attached". ROADMAP Success Criterion 4 (candidate failing a hard rule produces the correct failure label) is not reliably met for this rule type. This also directly violates the Plan 04 must-have: "Rule field values are resolved via fieldMap in config — never accessed by hardcoded BambooHR field paths."

**Gap 3 (DRY_RUN vs LIVE_MODE mismatch — CONF-04 contract broken):** `.env.example` documents `DRY_RUN=true` as the operator-facing runtime flag, but `isDryRun()` reads `LIVE_MODE`. This is a silent correctness issue now but a live-mode safety failure when Phase 4 adds write paths. An operator following `.env.example` cannot correctly toggle dry-run mode using the documented variable. The fix is to either remove `DRY_RUN` from `.env.example` (single flag) or add `DRY_RUN` support to `isDryRun()`.

Gaps 1 and 2 are straightforward single-function fixes. Gap 3 requires a coordination decision about which env var name is canonical.

---

_Verified: 2026-05-01T00:00:00Z_
_Verifier: Claude (gsd-verifier)_
