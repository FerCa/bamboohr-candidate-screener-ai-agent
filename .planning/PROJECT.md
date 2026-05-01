# BambooHR Candidate Screener

## What This Is

An automated daily screening agent built with OpenAI Agents SDK (TypeScript) that monitors a BambooHR job opening for new candidates, evaluates them against configurable rules, and moves them to the appropriate pipeline stage with a written comment explaining the decision. Runs as a short-lived Docker container triggered by cron — locally first, portable to a server.

## Core Value

Eliminate manual first-pass screening: recruiters only see candidates who already cleared the objective criteria.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Agent fetches candidates in "New" stage for a configured BambooHR job opening
- [ ] Agent evaluates hard criteria from YAML config (desired pay ceiling, required fields, etc.)
- [ ] Agent downloads candidate CV PDF from BambooHR and extracts text for evaluation
- [ ] Agent uses GPT-4o to evaluate soft criteria against CV content and application answers
- [ ] Matching candidates are moved to "Schedule Phone Screen" with a comment listing specific matched criteria
- [ ] Non-matching candidates are moved to "Reviewed" with a comment listing specific unmet criteria
- [ ] All actions logged with structured JSON to stdout
- [ ] Runs as a short-lived Docker container (exits after processing)
- [ ] Job opening ID, pipeline stage IDs, and rules configurable via YAML file mounted into container
- [ ] BambooHR API key, company domain, and OpenAI API key passed via environment variables

### Out of Scope

- Multi-job monitoring — v2 when single-job is proven
- Slack/email run summaries — stdout logs sufficient for now
- Web UI for rule management — YAML config is good enough
- Automatic rule learning from past decisions — manual rule refinement only

## Context

- **BambooHR API**: REST API with API key auth. Candidate data, application answers, and CV attachments accessible via API. User needs to generate API key from BambooHR account settings.
- **OpenAI Agents SDK**: TypeScript SDK for building tool-using agents. Agent will use tools to call BambooHR API and process candidates.
- **Rules architecture**: Two-tier. Structured YAML handles deterministic hard rules (pay ceiling, field presence, boolean requirements). GPT-4o handles soft criteria that require reasoning (CV quality, answer evaluation, inferred experience).
- **PDF parsing**: CV PDFs downloaded from BambooHR attachment URLs, parsed to text (likely `pdf-parse` or similar). Text fed to GPT-4o with the soft rules as context.
- **Scheduling**: macOS `crontab` triggers `docker run` daily. Same command works identically on a Linux server.

## Constraints

- **Tech stack**: TypeScript, OpenAI Agents SDK, Node.js — no Python
- **Runtime**: Docker container, must be short-lived (run-and-exit pattern)
- **Config**: Rules and job config in YAML file, mounted as Docker volume — no hardcoded rules
- **Credentials**: BambooHR API key + subdomain, OpenAI API key — all via env vars, never in code
- **Deployment target**: Local MacBook first; must be portable to a Linux server without code changes

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| OpenAI Agents SDK over plain API calls | User requirement — want agent loop patterns, tool use | — Pending |
| Mixed rules (YAML + LLM) | Hard rules are cheap and deterministic; LLM only for judgement calls | — Pending |
| External cron over internal scheduler | Portable across local and server; container stays stateless | — Pending |
| One job opening first | Validate approach before generalizing rule management | — Pending |

---
*Last updated: 2026-05-01 after initialization*

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state
