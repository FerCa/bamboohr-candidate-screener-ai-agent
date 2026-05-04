# Roadmap: BambooHR Candidate Screener

## Overview

Build a cron-triggered Docker container that automates first-pass screening of BambooHR applicants. The delivery sequence is: validated config + BambooHR API connection + hard-rule pre-filter (Phase 1) → CV PDF extraction + candidate context pipeline (Phase 2) → GPT-4o soft evaluation + agent orchestration in dry-run (Phase 3) → live-mode writes + Docker packaging + cron wiring (Phase 4). Each phase proves a slice of the pipeline before the next layer is added.

---

## Milestone v1.1 — Multi-Job & AWS Deployment

Extends the single-job screener to handle N configured job openings per run and provides a production-ready AWS deployment path. The delivery sequence is: TypeScript multi-job refactor (Phase 6) → Terraform infrastructure provisioning (Phase 7) → deploy scripts and EC2 cron verification (Phase 8). Phase 6 has no AWS dependency and is testable locally; Phases 7 and 8 require AWS credentials.

---

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Foundation** - Config validation, BambooHR client, hard-rule pre-filter, and dry-run logging in place
- [x] **Phase 2: PDF Pipeline** - CV download, text extraction, content validation, and candidate context ready for agent input
- [x] **Phase 3: Agent Evaluation** - GPT-4o soft evaluation via OpenAI Agents SDK with dry-run end-to-end flow complete
- [x] **Phase 4: Live Mode & Deployment** - Production-ready Docker image, live-mode writes enabled, cron wiring documented
- [x] **Phase 5: Clean Code & SOLID Refactor** - Full codebase refactor — separation of concerns, SOLID principles, injectable dependencies, no `any` casts
- [ ] **Phase 6: Multi-Job Refactor** - TypeScript schema and pipeline updated to process N jobs per run; idempotency lock guard in place; backward-compatible with existing single-job config
- [ ] **Phase 7: Terraform Infrastructure** - All AWS resources provisioned reproducibly; secrets stored in SSM Parameter Store; EC2 instance bootstraps Docker and cron without manual SSH
- [ ] **Phase 8: Deploy Scripts & Cron Verification** - One-command deploy from developer Mac to ECR; EC2 cron wrapper fetches secrets at runtime and drives the container; end-to-end live run confirmed

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

### Phase 5: Clean Code & SOLID Refactor
**Goal**: Refactor the entire codebase to follow clean code principles and SOLID design — improve separation of concerns, eliminate code smells, apply single-responsibility throughout, and ensure the architecture is maintainable and extensible for v2 features
**Depends on**: Phase 4
**Requirements**: (none — structural refactor; success criteria below cover the contract)
**Success Criteria** (what must be TRUE):
  1. Each module has a single, clearly-named responsibility with no cross-cutting concerns bleeding across boundaries
  2. All functions and classes are open for extension but closed for modification — new rules, stages, or output channels can be added without touching existing logic
  3. Dependencies flow inward — BambooHR client, OpenAI agent, and logger are injected or abstracted behind interfaces, not imported directly in business logic
  4. All existing dry-run and live-mode behavior is preserved end-to-end after the refactor
  5. TypeScript strict mode passes with no `any` casts introduced
**Plans**: 4 plans

Plans:

**Wave 1**
- [x] 05-01-PLAN.md — Foundation: install vitest + vitest.config.ts; create ConfigError + StageValidationError classes; create IBambooHRClient + ISoftEvaluator + ILogger interfaces (D-05, D-08, D-09)

**Wave 2** *(parallel — no shared files; both depend only on Plan 01)*
- [x] 05-02-PLAN.md — Refactor existing modules: loader.ts throws ConfigError; client.ts throws StageValidationError + rename `all`→`applications`; logger.ts becomes JsonLogger class; evaluator.ts becomes SoftEvaluator class + rename `out`→`agentOutput` (D-05, D-06, D-08, D-12)
- [x] 05-03-PLAN.md — Extract pure utilities + tests: CommentBuilder static class; LiveModeWriter atomicity owner; evaluateHardRules + CommentBuilder unit tests (D-03, D-04, D-10, D-11)

**Wave 3** *(blocked on Waves 1 and 2 — restores compile after Plan 02 breakage)*
- [x] 05-04-PLAN.md — Integrate: CandidateProcessor (per-candidate pipeline) + ScreeningPipeline (orchestrator); rewrite src/index.ts as thin wiring; CandidateProcessor + ScreeningPipeline integration tests (D-01, D-02, D-08, D-11)

Cross-cutting constraints: zero `any` casts in production code; `process.exit` exists ONLY in src/index.ts (loader.ts and client.ts throw named errors instead); ESM `.js` imports on every new file; full descriptive variable names per D-12 (`bambooHrClient`, `applicationDetail`, `candidateContext`, `applications`, `agentOutput`, `hardRuleResult`); no `implements` keyword on concrete classes (TypeScript structural typing satisfies interfaces implicitly per D-05); end-to-end dry-run and live-mode behavior preserved (locked by 4 vitest test files).

### Phase 6: Multi-Job Refactor
**Goal**: The TypeScript codebase processes N jobs per container run — each job runs the full pipeline with its own stage validation, candidate fetch, and write path; failures in one job do not abort others; a run-level lock file prevents cron overlap
**Depends on**: Phase 5
**Requirements**: CONF-06, CONF-07, MULTI-01, MULTI-02, MULTI-03, SAFE-03
**Success Criteria** (what must be TRUE):
  1. A `config.yaml` with a `jobs` array containing two entries causes the screener to fetch and process candidates for both job openings in a single container run, with each job's decisions logged under its own `openingId`
  2. A legacy single-job `config.yaml` (without a `jobs` array) loads and runs without any changes to the file — the loader normalizes it to a one-item jobs array internally
  3. Configuring an invalid stage ID in job 2 causes job 2 to log a `job_error` outcome and skip, while job 1 completes normally; the run exits with code 0 and logs aggregate totals
  4. The final JSON summary line includes both per-job counts (keyed by `openingId`) and aggregate `processed`, `pass`, `fail`, `needsReview`, and `errors` totals across all jobs
  5. If a lock file younger than 4 hours exists at run start, the process logs a `lock_active` message and exits immediately without fetching any candidates; the lock file is removed on clean exit and on error exit
**Plans**: 5 plans

Plans:

**Wave 1**
- [x] 06-01-PLAN.md — Config schema + loader + types: jobEntrySchema, JobConfig type, configSchema (jobs array), backward-compatible normalization in loadConfig() (CONF-06, CONF-07)

**Wave 2** *(parallel — no shared files; both depend only on Plan 01)*
- [ ] 06-02-PLAN.md — Create job-runner.ts (ScreeningPipeline → JobRunner rename, JobConfig slice, JobResult return type); update IBambooHRClient.validateStages + BambooHRClient.validateStages to accept JobConfig (MULTI-01, MULTI-02)
- [ ] 06-03-PLAN.md — Update CandidateProcessor (Config → JobConfig) and evaluateHardRules (Config → JobConfig) (MULTI-01)

**Wave 3** *(parallel — no shared files; both depend on Plans 02 and 03)*
- [ ] 06-04-PLAN.md — Create MultiJobOrchestrator (per-job loop, D-08 summary JSON, D-09 error jobs, D-10 always resolves) + MultiJobOrchestrator.test.ts (MULTI-01, MULTI-02, MULTI-03)
- [ ] 06-05-PLAN.md — Wire index.ts to MultiJobOrchestrator; create JobRunner.test.ts; delete screening-pipeline.ts; full compile + test verification (CONF-06, CONF-07, MULTI-01, MULTI-02, MULTI-03)

Cross-cutting constraints: SAFE-03 (lock file guard) explicitly deferred from Phase 6 — Docker `/tmp/` is wiped per `docker run --rm` so volume-mounted lock path needed; ESM `.js` imports on all new files; `process.exit` only in src/index.ts; `MultiJobOrchestrator.run()` always resolves (D-10); per-job CandidateProcessor constructed fresh inside orchestrator loop (no cross-job contamination); `validateStages()` called per-job inside JobRunner (D-05, PITFALL MJ-04).

### Phase 7: Terraform Infrastructure
**Goal**: All AWS resources required to run the screener on EC2 are provisioned by a single `terraform apply` — ECR repository, IAM role with minimal permissions, security group, EC2 instance with Docker and cron bootstrapped via `user_data`, and SSM Parameter Store entries for all secrets; no SSH access is needed; no secret values appear in committed files or Terraform state
**Depends on**: Phase 6
**Requirements**: INFRA-06, INFRA-07, INFRA-08, INFRA-11
**Success Criteria** (what must be TRUE):
  1. Running `terraform apply` from a clean state creates all required AWS resources without error; running it a second time shows "No changes" — the configuration is idempotent
  2. The EC2 instance has Docker installed and a daily cron job registered without any manual SSH session — verified by checking the instance system log or SSM Run Command output
  3. All Terraform resource names, region, and SSM path prefixes are driven by input variables; no AWS account ID, company name, or environment-specific value appears in any committed `.tf` file
  4. A `terraform destroy` followed by `terraform apply` re-creates the infrastructure identically, including a fresh EC2 instance that re-bootstraps via `user_data`
**Plans**: TBD
**UI hint**: no

### Phase 8: Deploy Scripts & Cron Verification
**Goal**: A developer on a Mac can build, tag, and push a new Docker image to ECR and trigger a pull on the EC2 instance with a single script; the EC2 cron wrapper fetches all secrets from SSM at each invocation and passes them to `docker run` — no secrets are ever written to disk; an end-to-end dry-run on EC2 confirms the full deployment path works
**Depends on**: Phase 7
**Requirements**: INFRA-09, INFRA-10
**Success Criteria** (what must be TRUE):
  1. Running `scripts/deploy.sh` from a developer Mac builds the Docker image, tags it with the current git SHA and `latest`, and pushes both tags to ECR — with the ECR URL read from Terraform output, not hardcoded
  2. After a `deploy.sh` run, manually triggering the cron script on EC2 (via SSM Run Command) pulls the latest image, fetches secrets from SSM, and runs the container — confirmed by a dry-run summary JSON line in the SSM command output
  3. At no point during cron execution does any secret value appear in a file on the EC2 instance disk; the SSM fetch, `docker run`, and cleanup all happen in memory within the cron wrapper script
  4. Rotating a secret by updating its SSM Parameter Store value takes effect on the next cron invocation with no instance restart or `deploy.sh` re-run required
**Plans**: TBD
**UI hint**: no

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 6/6 | Complete | 2026-05-01 |
| 2. PDF Pipeline | 6/7 | Complete (02-07 gap deferred) | 2026-05-01 |
| 3. Agent Evaluation | 4/4 | Complete | 2026-05-02 |
| 4. Live Mode & Deployment | 3/3 | Complete | 2026-05-02 |
| 5. Clean Code & SOLID Refactor | 4/4 | Complete | 2026-05-03 |
| 6. Multi-Job Refactor | 0/5 | Not started | - |
| 7. Terraform Infrastructure | 0/? | Not started | - |
| 8. Deploy Scripts & Cron Verification | 0/? | Not started | - |
