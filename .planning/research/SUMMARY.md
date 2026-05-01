# Project Research Summary

**Project:** BambooHR Candidate Screening Agent
**Domain:** Automated HR pipeline tool (internal, BambooHR ATS + OpenAI LLM + Docker + cron)
**Researched:** 2026-05-01
**Confidence:** MEDIUM

---

## Executive Summary

This project is a short-lived, cron-triggered Docker container that automates first-pass screening of job applicants in BambooHR. The standard approach uses the OpenAI Agents SDK (`@openai/agents`) to run a single agent per candidate sequentially — not one agent for all candidates simultaneously. The agent is given a small, bounded tool set (fetch CV, get application answers, move stage, add comment) and a system prompt that encodes screening rules from a mounted YAML config. Hard rules (salary ceiling, required fields) are evaluated deterministically in a pre-filter step before any LLM call, keeping cost down and determinism high. The LLM handles only soft evaluation — judgment-based criteria that require reasoning over CV text and application answers.

The recommended stack is TypeScript 5.x on Node.js 22 LTS, using `@openai/agents` for the agent loop, `pdf-parse` for CV text extraction, `js-yaml` + `zod` for config loading, and native `fetch` for BambooHR API calls. No framework overhead is needed. The codebase is ESM throughout, compiled by `tsc`, packaged in a `node:22-alpine` Docker image. Scheduling is handled externally by the host's crontab invoking `docker run --rm`, which keeps the container stateless.

Three risks can cause real, hard-to-reverse damage before anyone notices: (1) no idempotency guard leads to double-comments and double-stage-moves on re-runs; (2) sending image-only PDF text (empty string) to GPT-4o causes confident-sounding rejections of qualified candidates with no error signal; (3) GDPR — CV personal data sent to OpenAI requires a signed DPA and candidate consent disclosure before production use. These must be addressed in Phases 1 and 2, not deferred.

---

## Stack

**Core technologies:**

| Library | Version | Purpose | Confidence |
|---------|---------|---------|------------|
| `@openai/agents` | latest (verify on npm) | Agent loop, tool use, runner | MEDIUM — was 0.x pre-release; verify current version |
| Node.js | 22 LTS | Runtime — built-in fetch, Alpine-compatible | HIGH |
| TypeScript | ~5.5 | Type safety — `"module": "NodeNext"` for ESM | HIGH |
| `pdf-parse` | ^1.1.1 | CV text extraction — zero native dependencies | MEDIUM |
| `js-yaml` | ^4.1.0 | YAML config parsing — use v4 API only | HIGH |
| `zod` | ^3.x | Runtime schema validation for config + API responses | HIGH |
| Docker `node:22-alpine` | — | Stateless run-and-exit container | HIGH |

**What NOT to use:** LangChain/LlamaIndex (overkill), `dotenv` in Docker (credential smell), `node-cron` inside the container (makes it long-lived), `Promise.all` for candidates (rate limits + correctness), CommonJS `require()` (ESM throughout), `node-fetch` or `axios` (Node 22 has built-in fetch).

**Research flags requiring verification before implementation:**
- `@openai/agents` current npm version and `tool()` / `Runner.run()` / `maxTurns` API shape
- BambooHR ATS API variant (legacy vs. newer Hiring API) — endpoint paths differ

---

## Features

### Table Stakes (all must ship together in v1)

- YAML config loading + Zod startup validation (fail fast before any API calls)
- Hard rule pre-filter (salary ceiling, required fields) — deterministic, no LLM cost
- BambooHR candidate fetch (single job, "New" stage, paginated)
- PDF text extraction from BambooHR attachment URL with Content-Type + word-count validation
- LLM soft criteria evaluation with structured JSON output (not free-text)
- Stage transition: pass → "Schedule Phone Screen", fail → "Reviewed"
- Structured recruiter comment (decision + matched criteria bullets + unmet criteria bullets)
- Idempotency guard via `processed.json` on mounted Docker volume
- "Needs Human Review" outcome for unscoreable candidates (empty PDF, LLM failure)
- Per-candidate error isolation (one failed candidate must not abort the run)
- Dry-run mode via `DRY_RUN=true` env var — **default on**; require explicit `LIVE_MODE=true`
- Structured JSON logging to stdout

### Differentiators (v2+)

- Exponential backoff retry on BambooHR 429/5xx
- Run completion sentinel line in stdout (for cron health detection)
- Configurable soft criteria pass threshold
- Pay expectation normalization (handles "$120k", "120000", "120,000/yr")
- Multi-job monitoring with per-job rule configs

### Deliberate Anti-Features

- **No relative candidate ranking** — illegal in some jurisdictions for initial screening
- **No PII storage outside BambooHR** — GDPR compliance
- **No auto-emailing candidates** — BambooHR handles comms
- **No rule learning from past decisions** — encodes and amplifies bias

---

## Architecture

**Pattern:** Simple sequential pipeline. One `Agent` instance constructed at startup. Main orchestrator fetches candidates once, then loops: hard-rule pre-filter → idempotency check → `run(agent, candidateContext)` → mark processed → log.

**Component map:**

```
config/loader.ts + schema.ts       YAML → Zod validation → typed AppConfig
bamboohr/client.ts + types.ts      Thin typed HTTP client (all BambooHR calls)
pdf/extractor.ts                   Download PDF buffer → extract text → validate → truncate
agent/tools.ts                     Tool factory (dependency injection, 5 tools max)
agent/prompt.ts                    System prompt builder from AppConfig rules
agent/agent.ts + runner.ts         Agent construction + per-candidate Runner.run()
idempotency.ts                     Read/write processed.json on mounted volume
index.ts                           Main orchestrator + sequential candidate loop
logger.ts                          Structured JSON stdout
```

**Data flow:**
```
cron → docker run → load config → fetch candidates →
  for each candidate:
    hard rules pre-filter → (fail: log + move to Reviewed)
    idempotency check → (skip if already processed)
    download PDF → extract text → validate (empty? → NEEDS_HUMAN_REVIEW)
    agent.run(candidate context) → decision + comment
    move stage + add comment (unless DRY_RUN)
    mark processed
→ exit 0
```

**Build order:** config loader → BambooHR client → hard rules evaluator → PDF extractor → agent tools → system prompt → agent + runner → idempotency → main orchestrator → Docker packaging.

**Key anti-patterns to avoid:**
- Never pass the full candidate list to one agent run — one `run()` per candidate
- Tool execution IS the side effect — do not parse agent text output for pass/fail
- Never write to BambooHR before the agent has a decision and comment ready
- Never use `applicantId` for writes — `applicationId` is the correct entity

---

## Critical Pitfalls

| # | Pitfall | Prevention | Phase |
|---|---------|------------|-------|
| 1 | **No idempotency guard** → double-comments, double-moves on re-run | Write `processed.json` to mounted volume; also skip if candidate no longer in "New" | Phase 1 |
| 2 | **Image-only PDF → empty text → confident rejection of qualified candidates** | After extraction: if word count < 50 and file size > 50KB, flag NEEDS_HUMAN_REVIEW; skip LLM | Phase 2 |
| 3 | **BambooHR stage IDs are account-specific integers, not stable names** | At startup, call pipeline endpoint and cross-reference YAML IDs against returned names; error if mismatch | Phase 1 |
| 4 | **GDPR: CV data sent to OpenAI without DPA and disclosure** | Pre-deployment gate: confirm signed DPA with OpenAI, verify job application consent text. Cannot be resolved in code. | Phase 1 |
| 5 | **Agent loop without `maxTurns` → unbounded cost** | Set `maxTurns: 5` per candidate run from day one; log token counts | Phase 3 |
| 6 | **BambooHR attachment URLs are time-limited signed tokens** | Download PDF immediately after fetching metadata; validate `Content-Type: application/pdf` first | Phase 2 |
| 7 | **Applicant vs. Application entity confusion** | Stage, comments, CV live on `Application`. Always use `applicationId` for writes | Phase 1 |
| 8 | **Silent cron failures go unnoticed** | Emit completion sentinel JSON as last log line; wrap cron with dated log file | Phase 4 |
| 9 | **Timezone mismatch in Docker** | Set `TZ=UTC` in Dockerfile and cron invocation | Phase 4 |
| 10 | **LLM structured output hallucination** | Use Zod schema to validate every GPT-4o response; if parse fails → NEEDS_HUMAN_REVIEW | Phase 3 |

---

## Implications for Roadmap

**Suggested phases: 4**

### Phase 1: Foundation — Config, BambooHR Client, Hard Rules
Validates data model and API connection before any LLM cost. Bakes in idempotency and GDPR flag from day one. Delivers: runnable script that loads config, connects to BambooHR, fetches "New" candidates, evaluates hard rules, logs decisions in dry-run mode. No PDF, no LLM.

### Phase 2: PDF Extraction + Candidate Context
Handles both silent failure modes before connecting LLM. Validates content before GPT-4o sees it. Delivers: for each candidate passing hard rules, extract CV text, validate it, produce structured candidate context ready for agent evaluation. LLM not yet connected.

### Phase 3: Agent Orchestration + LLM Evaluation
Connects LLM only after data pipeline is solid. Per-candidate `run()` with explicit `maxTurns`. Delivers: end-to-end screening flow in dry-run mode — hard rule pre-filter → PDF extraction → agent run with real GPT-4o → structured JSON decision → log what would happen (no BambooHR writes yet).

### Phase 4: Live Mode + Docker/Cron Wiring
Enables writes only after dry-run verified on real data. Deployment concerns isolated from logic. Delivers: production-ready container. Live mode writes real stage transitions and comments. Docker image builds cleanly. Cron entry fires correctly. Logs include completion sentinel.

**Research flags by phase:**
- Phase 1: Verify BambooHR API variant + endpoint paths before writing the client
- Phase 3: Verify `@openai/agents` current version and API shape before writing agent code
- Phase 2, 4: Standard patterns — no additional research needed

---

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | MEDIUM | Core libraries HIGH. `@openai/agents` version LOW — must verify on npm. BambooHR paths MEDIUM. |
| Features | HIGH | ATS automation feature set well-understood. No speculative items. |
| Architecture | MEDIUM | Structural patterns sound. `@openai/agents` API surface needs verification. |
| Pitfalls | MEDIUM-HIGH | Most grounded in stable behavior. GDPR HIGH (stable law). |
| **Overall** | **MEDIUM** | **Sufficient to build from. Unknowns are bounded and verifiable.** |

---

*Research completed: 2026-05-01*
*Ready for roadmap: yes*
