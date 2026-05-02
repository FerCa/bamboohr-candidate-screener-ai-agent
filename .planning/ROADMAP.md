# Roadmap: BambooHR Candidate Screener

## Overview

Build a cron-triggered Docker container that automates first-pass screening of BambooHR applicants. The delivery sequence is: validated config + BambooHR API connection + hard-rule pre-filter (Phase 1) → CV PDF extraction + candidate context pipeline (Phase 2) → GPT-4o soft evaluation + agent orchestration in dry-run (Phase 3) → live-mode writes + Docker packaging + cron wiring (Phase 4). Each phase proves a slice of the pipeline before the next layer is added.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [ ] **Phase 1: Foundation** - Config validation, BambooHR client, hard-rule pre-filter, and dry-run logging in place
- [ ] **Phase 2: PDF Pipeline** - CV download, text extraction, content validation, and candidate context ready for agent input
- [x] **Phase 3: Agent Evaluation** - GPT-4o soft evaluation via OpenAI Agents SDK with dry-run end-to-end flow complete
- [ ] **Phase 4: Live Mode & Deployment** - Production-ready Docker image, live-mode writes enabled, cron wiring documented

## Phase Details

### Phase 1: Foundation
**Goal**: A runnable script that loads and validates config, connects to BambooHR, fetches "New" candidates, evaluates hard rules deterministically, and logs structured decisions — all in dry-run mode with no LLM cost
**Depends on**: Nothing (first phase)
**Requirements**: CONF-01, CONF-02, CONF-03, CONF-04, BAMB-01, RULE-01, SAFE-01, INFRA-02
**Success Criteria** (what must be TRUE):
  1. Running the script with a valid YAML config and real BambooHR credentials prints structured JSON candidate records to stdout without crashing
  2. Running the script with an invalid YAML config prints a clear error and exits before any BambooHR API call is made
  3. Running the script with a YAML stage ID that does not exist in BambooHR prints a mismatch error and exits at startup
  4. A candidate failing a hard rule (e.g., salary above ceiling) produces a JSON log line with outcome `fail` and the specific unmet rule listed
  5. An error on one candidate (e.g., simulated API failure) is isolated in its log line and does not abort processing of subsequent candidates
**Plans**: 6 plans (5 original + 1 gap-closure)

Plans:

**Wave 1**
- [x] 01-01-PLAN.md — Project scaffold: package.json, tsconfig.json, .gitignore, .env.example, config.yaml

**Wave 2** *(parallel — no shared files)*
- [x] 01-02-PLAN.md — Config layer: Zod schema, Config types, fail-fast loader (CONF-01, CONF-04)
- [x] 01-03-PLAN.md — BambooHR client: auth, stage validation, paginated candidate fetch (BAMB-01, CONF-02)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 01-04-PLAN.md — Hard-rule evaluator: four rule types, collect-all, fieldMap resolution (RULE-01)

**Wave 4** *(blocked on Wave 3 completion)*
- [x] 01-05-PLAN.md — Entry point + logger: startup sequence, error-isolated loop, JSON log output (SAFE-01, INFRA-02)

**Wave 5** *(gap closure — blocked on Wave 4 completion)*
- [x] 01-06-PLAN.md — Gap closure: openingId placeholder guard, requiredFields fieldMap fix, LIVE_MODE doc alignment, MAX_PAGES ceiling (CONF-01, CONF-04, RULE-01)

Cross-cutting constraints: ESM `.js` imports throughout; `LIVE_MODE=true` required to enable writes (default: dry-run); `applicationId` (not `applicantId`) used in all entity references; no native npm dependencies (Alpine-compatible stack only).

### Phase 2: PDF Pipeline
**Goal**: For each candidate passing hard rules, the system downloads their CV PDF, validates it, extracts plain text, truncates it to a safe size, and produces a structured candidate context object ready for agent evaluation — with appropriate "Needs Human Review" fallback for unextractable CVs
**Depends on**: Phase 1
**Requirements**: BAMB-04, PDF-01, PDF-02, RULE-03
**Success Criteria** (what must be TRUE):
  1. Running the script against a candidate with a valid PDF attachment logs extracted CV text (truncated to ~8000 chars) as part of the candidate context
  2. Running the script against a candidate whose attachment returns a non-PDF Content-Type logs the candidate with outcome `needsReview` and does not attempt text extraction
  3. Running the script against a candidate with an image-only PDF (tiny word count, large file) logs outcome `needsReview` without calling GPT-4o
  4. The candidate context object produced for a passing candidate contains all fields needed for agent input: application answers, hard-rule results, and CV text
**Plans**: 7 plans (4 original + 3 gap-closure)

Plans:

**Wave 1** *(parallel — no shared files)*
- [x] 02-01-PLAN.md — Type contracts: src/pipeline/types.ts (CandidateContext, NeedsReviewReason), extend CandidateDecision.outcome in src/rules/types.ts (RULE-03)
- [x] 02-02-PLAN.md — Install pdf-parse@1.1.4, add BambooHRClient.downloadPdf() binary download method (BAMB-04)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 02-03-PLAN.md — CV extraction orchestrator: src/pipeline/extract-cv.ts with buildCandidateContext(), image-only heuristic, all needsReview paths (PDF-01, PDF-02, RULE-03)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 02-04-PLAN.md — Wire PDF pipeline into src/index.ts: pass branch, needsReview counter, summary line extension (BAMB-04, PDF-01, PDF-02, RULE-03)

**Wave 4** *(gap closure — blocked on Wave 3 completion)*
- [x] 02-05-PLAN.md — Fix downloadPdf() double-/v1 and wrong entity ID (CR-01, CR-02); validateStages() return type (WR-03 client); rawFileId runtime validation (CR-04) (BAMB-04, RULE-03)

**Wave 5** *(gap closure — blocked on Wave 4 completion)*
- [x] 02-06-PLAN.md — Add intake stage to schema + config; wire stageMap in index.ts; fix hasPlaceholders; replace PII log (CR-03, WR-01, WR-02, WR-03 index) (BAMB-04, PDF-01, PDF-02, RULE-03)

**Wave 7** *(gap closure — blocked on Wave 5 completion)*
- [ ] 02-07-PLAN.md — Fix PDF download 404 (GAP-02): two-step approach via documents list API (GET /applicant_tracking/applications/{id}/documents); defensive URL extraction; shape discovery logging (BAMB-04, PDF-01, PDF-02, RULE-03)

Cross-cutting constraints: pdf-parse@1.1.4 pinned exactly (no caret); ESM `.js` imports on all new files; BambooHR attachment endpoint requires live discovery on first DRY_RUN; CV text never persisted to disk (GDPR).

### Phase 3: Agent Evaluation
**Goal**: End-to-end screening flow runs in dry-run mode — hard-rule pre-filter feeds into GPT-4o soft evaluation via OpenAI Agents SDK, producing a structured pass/fail/review decision with a recruiter comment for every candidate, with no BambooHR writes yet
**Depends on**: Phase 2
**Requirements**: BAMB-02, BAMB-03, RULE-02, SAFE-02
**Success Criteria** (what must be TRUE):
  1. In dry-run mode, each candidate with a valid CV receives a GPT-4o evaluation logged as JSON with outcome (`pass`/`fail`/`needsReview`), matched criteria, and unmet criteria
  2. The agent run for a single candidate terminates within 5 tool turns; no candidate run loops indefinitely
  3. A GPT-4o response that cannot be parsed as the expected schema logs the candidate as `needsReview` rather than crashing the run
  4. In dry-run mode, zero stage transitions and zero comments are written to BambooHR, confirmed by absence of any BambooHR write API calls in the log
**Plans**: 4 plans

Plans:

**Wave 1** *(parallel — no shared files)*
- [x] 03-01-PLAN.md — Install @openai/agents SDK, extend configSchema with optional softRules, add softRules block to config.yaml (RULE-02, SAFE-02)
- [x] 03-02-PLAN.md — Type contracts: src/agent/types.ts with EvaluationOutputSchema (Zod) + EvaluationResult interface using z.infer<> (single source of truth) (RULE-02, BAMB-02, BAMB-03)

**Wave 2** *(blocked on Wave 1 completion)*
- [x] 03-03-PLAN.md — Agent core: src/agent/prompt.ts (pure-function builders) + src/agent/evaluator.ts (Agent + run + maxTurns:5 + MaxTurnsExceededError handling + softRules-absent short-circuit) (RULE-02, SAFE-02, BAMB-02, BAMB-03)

**Wave 3** *(blocked on Wave 2 completion)*
- [x] 03-04-PLAN.md — Wire Phase 3: add logEvaluation to src/logger/logger.ts; replace placeholder logDecision in src/index.ts pass branch with evaluateSoftRules + logEvaluation; counters reflect soft-evaluation outcomes (RULE-02, SAFE-02, BAMB-02, BAMB-03)

Cross-cutting constraints: @openai/agents@0.8.x with Zod v4 peer dep (already satisfied); model: 'gpt-4o' MUST be specified explicitly (default is gpt-4.1); maxTurns: 5 cap on every run() call (SAFE-02); MaxTurnsExceededError → needsReview, all other errors re-throw to outer SAFE-01 handler; ESM .js imports throughout; zero BambooHR writes in Phase 3 (Phase 4 owns writes).

### Phase 4: Live Mode & Deployment
**Goal**: Production-ready container that writes real stage transitions and comments to BambooHR when `LIVE_MODE=true`, builds and runs cleanly as a `node:22-alpine` Docker image, and has a documented cron entry for daily execution
**Depends on**: Phase 3
**Requirements**: INFRA-01, INFRA-03, INFRA-04 (also activates BAMB-02 + BAMB-03 — write APIs first implemented here)
**Success Criteria** (what must be TRUE):
  1. `docker build` completes without error and `docker run --rm` with valid env vars and mounted config processes candidates and exits with code 0
  2. With `LIVE_MODE=true`, candidates are moved to the correct BambooHR pipeline stage and receive a comment listing the decision criteria
  3. The final line of every run is a JSON summary object containing `processed`, `pass`, `fail`, `needsReview`, and `errors` counts
  4. The README contains a copy-paste-ready macOS crontab entry and a note on deploying the same command to a Linux server
**UI hint**: no
**Plans**: 3 plans

Plans:

**Wave 1** *(parallel — no shared files)*
- [x] 04-01-PLAN.md — TypeScript code changes: BambooHRClient.postComment + moveStage; comment-then-move write guards in src/index.ts for soft-eval, hard-rule fail (D-05), and needsReview (D-01/D-02); CR-01 dry-run guard for OpenAI; INFRA-03 JSON summary on stdout (BAMB-02, BAMB-03, INFRA-03)
- [x] 04-02-PLAN.md — Docker packaging: multi-stage `node:22-alpine` Dockerfile (non-root user, exec-form ENTRYPOINT) and `.dockerignore` (excludes node_modules, .env, dist, .planning, .git); ends with human-verify checkpoint for `docker build` (Docker daemon not running at research time) (INFRA-01)

**Wave 2** *(blocked on Wave 1 — README references Dockerfile structure and image name)*
- [x] 04-03-PLAN.md — README.md with Quick Start, Build, Run (dry-run + LIVE_MODE), Configuration, Cron Setup (macOS + Linux), Operating Notes, Compliance (GDPR DPA + ATS API permission); copy-paste cron line using --env-file (D-06) and -v config mount (D-07/D-08) (INFRA-04)

Cross-cutting constraints: ESM `.js` imports preserved; `LIVE_MODE=true` required for writes (default: dry-run); `applicationId` (not `applicantId`) used for all `postComment` and `moveStage` calls; comment-then-move atomicity enforced — no half-written state (D-03/D-04); secrets via `--env-file` only (D-06); config via `-v` volume mount (D-07).

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 6/6 | Complete | 2026-05-01 |
| 2. PDF Pipeline | 6/7 | Complete (02-07 gap deferred) | 2026-05-01 |
| 3. Agent Evaluation | 4/4 | Complete | 2026-05-02 |
| 4. Live Mode & Deployment | 0/3 | Not started | - |
