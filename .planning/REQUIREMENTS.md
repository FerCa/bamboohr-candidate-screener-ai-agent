# Requirements

**Project:** BambooHR Candidate Screening Agent
**Version:** v1.1
**Date:** 2026-05-04

---

## v1 Requirements

### Config & Setup

- [ ] **CONF-01**: System loads a YAML config file and validates it against a Zod schema at startup; fails fast with a clear error message if config is invalid before making any API calls
- [ ] **CONF-02**: At startup, system cross-references configured pipeline stage IDs against live BambooHR pipeline stages and errors if any ID does not match
- [ ] **CONF-03**: BambooHR API key + subdomain and OpenAI API key are passed exclusively via environment variables; neither appears in config files or code
- [ ] **CONF-04**: Dry-run mode is the default (`DRY_RUN=true`); writing to BambooHR requires explicit `LIVE_MODE=true` opt-in

### BambooHR Integration

- [ ] **BAMB-01**: System fetches all candidates in the "New" pipeline stage for the configured job opening, with full pagination support
- [ ] **BAMB-02**: System moves a candidate's pipeline stage to "Schedule Phone Screen" (pass) or "Reviewed" (fail/review) in BambooHR
- [ ] **BAMB-03**: System posts a structured comment on each processed application listing the matched criteria (pass) or unmet criteria (fail/review)
- [ ] **BAMB-04**: System downloads a candidate's CV as a PDF buffer from the BambooHR attachment URL

### Rules Engine

- [ ] **RULE-01**: System evaluates hard rules defined in YAML config (salary ceiling, required fields, boolean criteria) deterministically before any LLM call; candidates failing hard rules are moved immediately without invoking GPT-4o
- [ ] **RULE-02**: For candidates passing hard rules, system evaluates soft criteria (CV content quality, application answer reasoning) via GPT-4o with structured JSON output; soft criteria and their descriptions are defined in YAML config
- [ ] **RULE-03**: System produces a third outcome — "Needs Human Review" — when CV text cannot be extracted, GPT-4o call fails, or the result is otherwise unscoreable; these candidates are not moved automatically

### PDF Processing

- [ ] **PDF-01**: System downloads CV PDF from BambooHR attachment URL, validates `Content-Type: application/pdf`, and extracts plain text using `pdf-parse`
- [ ] **PDF-02**: System truncates extracted CV text to a maximum of ~8000 characters before sending to GPT-4o to prevent token overflow

### Safety & Reliability

- [ ] **SAFE-01**: An error processing one candidate (API failure, PDF extraction failure, LLM error) is isolated and logged; remaining candidates in the run are not affected
- [ ] **SAFE-02**: Each per-candidate agent run has an explicit `maxTurns` cap (≤ 5) to prevent unbounded token consumption

### Infrastructure & Observability

- [ ] **INFRA-01**: Application runs as a short-lived `node:22-alpine` Docker container that exits with code 0 (success) or 1 (error) after processing; YAML config and state files are injected via Docker volume mounts
- [ ] **INFRA-02**: Every candidate decision is logged as structured JSON to stdout with at minimum: `candidateId`, `outcome` (pass/fail/review), `reasons`, `timestamp`
- [ ] **INFRA-03**: The final log line of every run is a JSON summary object with total counts: `processed`, `pass`, `fail`, `needsReview`, `errors` — enabling cron health detection
- [ ] **INFRA-04**: README documents the macOS `crontab` entry for daily execution and how to deploy the same command to a Linux server

---

## v1.1 Requirements

### Multi-Job Config

- [ ] **CONF-06**: `config.yaml` supports a `jobs` array; each entry has its own `openingId`, `stages`, `hardRules`, `fieldMap`, and `softRules`
- [ ] **CONF-07**: existing single-job `config.yaml` remains valid — loader normalizes it to a single-item jobs array internally (backward-compatible migration)

### Multi-Job Pipeline

- [ ] **MULTI-01**: system iterates over all enabled jobs sequentially in a single container run; each job runs the full pipeline independently with its own stage validation, candidate fetch, and write path
- [ ] **MULTI-02**: a failure in one job (stage mismatch, API error) is isolated and logged; remaining jobs continue processing
- [ ] **MULTI-03**: the final JSON summary includes per-job counts as well as aggregate totals

### Safety

- [ ] **SAFE-03**: system creates a lock file at run start and removes it on exit; if a lock file younger than 4 hours exists, the run exits immediately — prevents double-processing on cron overlap

### AWS Infrastructure

- [ ] **INFRA-06**: Terraform provisions all required AWS resources: ECR repository, t3.micro EC2 instance, IAM role with minimal permissions (ECR read + SSM Parameter Store get), egress-only security group, and SSM Parameter Store SecureString entries for secrets
- [ ] **INFRA-07**: EC2 instance bootstraps via `user_data`: installs Docker and ECR credential helper, writes cron wrapper script, registers daily cron job — no SSH access required; `user_data_replace_on_change = true` enforced
- [ ] **INFRA-08**: secrets (`BAMBOOHR_API_KEY`, `BAMBOOHR_SUBDOMAIN`, `OPENAI_API_KEY`, `LIVE_MODE`) are stored as SSM Parameter Store SecureString values; never appear in Terraform state or on disk on the instance
- [ ] **INFRA-11**: all Terraform resources use configurable input variables for names, region, and path prefixes; no AWS account IDs, company names, or environment-specific values are hardcoded in committed files; `terraform.tfvars` is gitignored

### Deploy Scripts

- [ ] **INFRA-09**: `scripts/deploy.sh` builds the Docker image, tags with git SHA + `latest`, and pushes to ECR — runnable from a developer's Mac with no manual SSH steps; ECR URL derived from Terraform output, not hardcoded
- [ ] **INFRA-10**: EC2 cron wrapper script fetches secrets from SSM at each invocation and passes them as env vars to `docker run`; no secrets written to disk at any point

---

## v2 Requirements

> These were deferred from v1. Implement after v1.1 is shipped.

- [ ] **SAFE-04**: Every GPT-4o structured response is validated with a Zod schema; parse failures trigger the "Needs Human Review" outcome rather than a crash
- [ ] **PDF-03**: After extraction, if word count < 50 and file size > 50 KB, system flags the candidate as "Needs Human Review" (image-only/scanned PDF) without calling GPT-4o
- [ ] **BAMB-05**: Exponential backoff retry (3 attempts) on BambooHR 429 and 5xx responses
- [ ] **INFRA-05**: Slack webhook notification posting a run summary after each execution

---

## Out of Scope

- **Relative candidate ranking** — comparing candidates against each other; illegal in some jurisdictions for initial screening
- **Auto-emailing candidates** — BambooHR handles candidate-facing communications
- **PII storage outside BambooHR** — CV data and personal information must not be persisted outside the originating system (GDPR)
- **Rule learning from past decisions** — automated rule updates based on historical screening outcomes; encodes and amplifies bias
- **Web UI for rule management** — YAML config is sufficient; UI adds complexity without proportional benefit for an internal tool
- **OCR for image-only PDFs** — heavy dependency (Tesseract) for an edge case; flag as Needs Human Review instead

---

## Compliance Note

> Before enabling `LIVE_MODE=true` against real candidates in production, verify:
> 1. A signed Data Processing Agreement (DPA) exists with OpenAI (required under GDPR for sending CV data)
> 2. The job application form discloses to candidates that submitted data may be processed by AI tools
>
> This is a legal requirement, not an implementation task. It cannot be resolved in code.

---

## Traceability

| REQ-ID | Phase | Status |
|--------|-------|--------|
| CONF-01 | Phase 1 | Pending |
| CONF-02 | Phase 1 | Pending |
| CONF-03 | Phase 1 | Pending |
| CONF-04 | Phase 1 | Pending |
| BAMB-01 | Phase 1 | Pending |
| RULE-01 | Phase 1 | Pending |
| SAFE-01 | Phase 1 | Pending |
| INFRA-02 | Phase 1 | Pending |
| BAMB-04 | Phase 2 | Pending |
| PDF-01 | Phase 2 | Pending |
| PDF-02 | Phase 2 | Pending |
| RULE-03 | Phase 2 | Pending |
| BAMB-02 | Phase 3 | Pending |
| BAMB-03 | Phase 3 | Pending |
| RULE-02 | Phase 3 | Pending |
| SAFE-02 | Phase 3 | Pending |
| INFRA-01 | Phase 4 | Pending |
| INFRA-03 | Phase 4 | Pending |
| INFRA-04 | Phase 4 | Pending |
| CONF-06 | Phase 6 (v1.1) | Pending |
| CONF-07 | Phase 6 (v1.1) | Pending |
| SAFE-03 | Phase 6 (v1.1) | Pending |
| MULTI-01 | Phase 6 (v1.1) | Pending |
| MULTI-02 | Phase 6 (v1.1) | Pending |
| MULTI-03 | Phase 6 (v1.1) | Pending |
| INFRA-06 | Phase 7 (v1.1) | Pending |
| INFRA-07 | Phase 7 (v1.1) | Pending |
| INFRA-08 | Phase 7 (v1.1) | Pending |
| INFRA-11 | Phase 7 (v1.1) | Pending |
| INFRA-09 | Phase 8 (v1.1) | Pending |
| INFRA-10 | Phase 8 (v1.1) | Pending |
