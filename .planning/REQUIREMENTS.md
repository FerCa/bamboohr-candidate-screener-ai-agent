# Requirements

**Project:** BambooHR Candidate Screening Agent
**Version:** v1
**Date:** 2026-05-01

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

## v2 Requirements

> These were deferred from v1. Implement after v1 is validated on real data.

- [ ] **SAFE-03**: Idempotency guard — system tracks processed candidate IDs in a `processed.json` file on the mounted Docker volume; already-processed candidates are skipped on re-runs
  > ⚠️ **Strongly recommended for early v1.x** — research flagged this as the #1 pitfall. Without it, any re-run (retry, cron overlap, manual trigger) causes double-comments and double-moves. ~10 lines of code.
- [ ] **SAFE-04**: Every GPT-4o structured response is validated with a Zod schema; parse failures trigger the "Needs Human Review" outcome rather than a crash
- [ ] **PDF-03**: After extraction, if word count < 50 and file size > 50 KB, system flags the candidate as "Needs Human Review" (image-only/scanned PDF) without calling GPT-4o
- [ ] **BAMB-05**: Exponential backoff retry (3 attempts) on BambooHR 429 and 5xx responses
- [ ] **CONF-05**: Per-job configuration — support monitoring multiple job openings, each with its own rule set
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
