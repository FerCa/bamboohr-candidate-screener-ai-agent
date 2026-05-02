# BambooHR Candidate Screener AI Agent

TypeScript + OpenAI Agents SDK agent that screens BambooHR job candidates daily.
See `.planning/PROJECT.md` for full project context and `.planning/ROADMAP.md` for phase structure.

## Project Summary

Automated daily screening agent that monitors a BambooHR job opening for new candidates, evaluates
them against YAML-defined rules (hard rules deterministically, soft rules via GPT-4o), and moves
them to "Schedule Phone Screen" (pass) or "Reviewed" (fail) with a structured comment. Runs as a
short-lived Docker container triggered by cron.

**Core value:** Recruiters only see candidates who already cleared objective criteria.

## GSD Workflow

This project uses GSD (Get Shit Done) for structured phase-based execution.

**Current state:** Phase 1 (Foundation) — ready to plan

```
/gsd-plan-phase 1     # Create detailed plan for Phase 1
/gsd-discuss-phase 1  # Discuss approach before planning
/gsd-progress         # Check current status
```

**Phase sequence:**
1. Foundation — Config, BambooHR client, hard-rule pre-filter, dry-run logging
2. PDF Pipeline — CV download, extraction, candidate context object
3. Agent Evaluation — GPT-4o soft evaluation, end-to-end dry-run
4. Live Mode & Deployment — Live writes, Docker image, cron wiring

## Stack

- TypeScript 5 / Node.js 22 LTS (ESM, `"module": "NodeNext"`)
- `@openai/agents` — agent loop and tool use (verify current npm version before Phase 3)
- `pdf-parse` — CV text extraction (zero native deps, works in Alpine)
- `js-yaml` + `zod` — config loading and runtime validation
- Docker `node:22-alpine` — short-lived container, exits after processing
- External cron (`crontab`) — triggers `docker run --rm` daily

## Key Constraints

- **Dry-run is default.** `DRY_RUN=true` unless `LIVE_MODE=true` is explicitly set
- **Credentials via env vars only** — never in config files or code
- **One agent run per candidate** — never pass the full candidate list to a single agent run
- **Hard rules before LLM** — candidates failing YAML hard rules never invoke GPT-4o
- **`applicationId` for writes** — not `applicantId`; stage, comments, CV live on the Application entity

## Research Flags (verify before implementing)

- **Phase 1:** Confirm BambooHR API variant (legacy `/ats/` vs. newer `/v1/applicant-tracking/`)
  at `documentation.bamboohr.com` before writing the HTTP client
- **Phase 3:** Verify `@openai/agents` current version and `tool()` / `Runner.run()` / `maxTurns`
  API shape on npm before writing agent code

## Compliance (pre-deployment, not a code task)

Before enabling `LIVE_MODE=true` against real candidates:
1. Signed DPA with OpenAI (GDPR — CV personal data sent externally)
2. Candidate consent disclosure on job application form

## Planning Artifacts

| File | Purpose |
|------|---------|
| `.planning/PROJECT.md` | Project context, requirements, key decisions |
| `.planning/ROADMAP.md` | Phase structure with success criteria |
| `.planning/REQUIREMENTS.md` | All requirements with REQ-IDs and traceability |
| `.planning/STATE.md` | Current position, blockers, deferred items |
| `.planning/config.json` | GSD workflow settings |
| `.planning/research/` | Domain research (stack, features, architecture, pitfalls) |
