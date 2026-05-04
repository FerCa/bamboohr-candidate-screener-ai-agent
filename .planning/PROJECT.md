# BambooHR Candidate Screener

## Current Milestone: v1.1 — Multi-Job & AWS Deployment

**Goal:** Extend the screener to handle multiple job openings simultaneously and provide a production-ready AWS deployment path via Terraform + EC2.

**Target features:**
- Multi-job support: screen N configured job openings per run, each with its own rules, stages, and pass/fail criteria
- AWS deployment: Terraform config to provision an EC2 instance with Docker, cron, and secrets management
- Deploy scripts: build, push, and update the running instance without manual SSH steps

## What This Is

An automated daily screening agent built with OpenAI Agents SDK (TypeScript) that monitors BambooHR job openings for new candidates, evaluates them against configurable rules, and moves them to the appropriate pipeline stage with a written comment explaining the decision. Runs as a short-lived Docker container triggered by cron — locally or on AWS EC2.

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
- **Deployment target**: Local MacBook + AWS EC2 via Terraform; container runs identically in both environments

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| OpenAI Agents SDK over plain API calls | User requirement — want agent loop patterns, tool use | — Pending |
| Mixed rules (YAML + LLM) | Hard rules are cheap and deterministic; LLM only for judgement calls | — Pending |
| External cron over internal scheduler | Portable across local and server; container stays stateless | — Pending |
| One job opening first | Validate approach before generalizing rule management | — Pending |

---
*Last updated: 2026-05-04 — Milestone v1.1 started — Multi-Job & AWS Deployment*

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
