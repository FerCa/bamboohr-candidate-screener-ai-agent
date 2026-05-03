# BambooHR Candidate Screener AI Agent

TypeScript + OpenAI Agents SDK agent that screens BambooHR job candidates daily.
See `.planning/PROJECT.md` for full project context and `.planning/ROADMAP.md` for phase structure.

## Project Summary

Automated daily screening agent that monitors a BambooHR job opening for new candidates, evaluates
them against YAML-defined rules (hard rules deterministically, soft rules via GPT-4o), and moves
them to the configured pass/fail pipeline stages with a structured recruiter comment. Runs as a
short-lived Docker container triggered by cron.

**Core value:** Recruiters only see candidates who already cleared objective criteria.

## GSD Workflow

This project uses GSD (Get Shit Done) for structured phase-based execution.

**Current state:** v1.0 complete — all 4 phases shipped and human-UAT verified (2026-05-02).

```
/gsd-progress              # Check current state and deferred items
/gsd-discuss-phase N       # Discuss a new feature phase before planning
/gsd-plan-phase N          # Create a detailed plan for a new phase
/gsd-execute-phase N       # Execute a planned phase
/gsd-new-milestone         # Start a new milestone cycle (v1.1, v2.0, etc.)
```

**Completed phases (v1.0):**
1. Foundation — Config, BambooHR client, hard-rule pre-filter, dry-run logging ✓
2. PDF Pipeline — CV download, extraction, candidate context object ✓
3. Agent Evaluation — GPT-4o soft evaluation, end-to-end dry-run ✓
4. Live Mode & Deployment — Live writes, Docker image, cron wiring ✓

**Deferred to v2** (tracked in `.planning/STATE.md`): idempotency guard, Zod validation of GPT-4o responses, image-only PDF detection, retry on 429/5xx, multi-job support, Slack webhook summary.

## Stack

- TypeScript 5 / Node.js 22 LTS (ESM, `"module": "NodeNext"`)
- `@openai/agents` — agent loop and tool use (verify current npm version before Phase 3)
- `pdf-parse` — CV text extraction (zero native deps, works in Alpine)
- `js-yaml` + `zod` — config loading and runtime validation
- Docker `node:22-alpine` — short-lived container, exits after processing
- External cron (`crontab`) — triggers `docker run --rm` daily

## Key Constraints

- **Dry-run is default.** Dry-run is active unless `LIVE_MODE=true` is explicitly set; `isDryRun()` checks `process.env['LIVE_MODE'] !== 'true'`
- **Credentials via env vars only** — never in config files or code
- **One agent run per candidate** — never pass the full candidate list to a single agent run
- **Hard rules before LLM** — candidates failing YAML hard rules never invoke GPT-4o
- **`applicationId` for writes** — not `applicantId`; stage, comments, CV live on the Application entity
- **Comment before stage move** — atomicity: if `postComment` fails, `moveStage` is never attempted
- **`@openai/agents@0.8.x`** — requires Zod v4 peer dep (already satisfied); `model: 'gpt-4o'` must be explicit (default is gpt-4.1); `maxTurns: 5` on every `run()` call

## Compliance (pre-deployment, not a code task)

Before enabling `LIVE_MODE=true` against real candidates:
1. Signed DPA with OpenAI (GDPR — CV personal data sent externally)
2. Candidate consent disclosure on job application form

## Planning Artifacts

| File / Directory | Purpose |
|------------------|---------|
| `.planning/PROJECT.md` | Project context, requirements, key decisions |
| `.planning/ROADMAP.md` | Phase structure with success criteria and completion status |
| `.planning/REQUIREMENTS.md` | All requirements with REQ-IDs and traceability |
| `.planning/STATE.md` | Current position, deferred items, session continuity |
| `.planning/config.json` | GSD workflow settings |
| `.planning/research/` | Domain research (stack, features, architecture, pitfalls) |
| `.planning/phases/01-foundation/` | Phase 1 plans, execution records, code review, UAT |
| `.planning/phases/02-pdf-pipeline/` | Phase 2 plans, gap-closure records, PDF discovery notes |
| `.planning/phases/03-agent-evaluation/` | Phase 3 plans, agent prompt design, soft-rule evaluation |
| `.planning/phases/04-live-mode-deployment/` | Phase 4 plans, Docker packaging, write-path implementation |

When context about past decisions, API discoveries, or implementation rationale is needed, the phase directories are the primary reference — each contains CONTEXT.md, PLAN.md files, REVIEW.md, and HUMAN-UAT.md for that phase.
