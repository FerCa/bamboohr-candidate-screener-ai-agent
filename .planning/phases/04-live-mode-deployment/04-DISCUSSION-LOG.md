# Phase 4: Live Mode & Deployment - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-02
**Phase:** 4-Live Mode & Deployment
**Areas discussed:** needsReview in LIVE_MODE, Write atomicity, Docker & cron pattern

---

## needsReview in LIVE_MODE

| Option | Description | Selected |
|--------|-------------|----------|
| Move to 'Reviewed' + comment | Move to Reviewed stage with a comment flagging manual review needed | ✓ |
| Leave in intake + post comment | Don't move stage; post a comment only; candidate stays in intake | |
| No writes at all | Log locally only; leave candidate untouched in BambooHR | |

**User's choice:** Move to 'Reviewed' + comment

| Comment format | Description | Selected |
|----------------|-------------|----------|
| Match pass/fail format | "NEEDS REVIEW — Automated screening incomplete" + reason + audit footer | ✓ |
| Simple one-liner | Short free-text, no structured format | |

**User's choice:** Match pass/fail format

**Notes:** Keeps recruiter UI consistent across all outcomes (pass/fail/needsReview). The 'Reviewed' stage is appropriate because the candidate has been "processed" — they just couldn't be auto-evaluated.

---

## Write Atomicity

| Option | Description | Selected |
|--------|-------------|----------|
| Treat as error — comment first, then move | Post comment first; only move on success; any failure leaves candidate in intake counted as error | ✓ |
| Fire-and-forget — move first, comment best-effort | Move unconditionally; log warning on comment fail; candidate counted as processed | |
| You decide | Let Claude pick based on SAFE-01 isolation principle | |

**User's choice:** Treat as error — don't move if comment can't be posted

| Hard-rule fails | Description | Selected |
|-----------------|-------------|----------|
| Yes — write to BambooHR for hard-rule fails too | Move to Reviewed + comment listing failed hard rules | ✓ |
| No — only write for GPT-4o evaluated candidates | Hard-rule fails logged locally only | |

**User's choice:** Yes — write to BambooHR for hard-rule fails too

**Notes:** All outcomes (pass, fail, needsReview, hard-rule fail) go through the same comment-first-then-move flow. No half-written state. Daily cron retries any that errored on next run.

---

## Docker & Cron Pattern

| Secrets injection | Description | Selected |
|-------------------|-------------|----------|
| --env-file | Secrets file on server; not in shell history or cron log | ✓ |
| Inline -e flags | Simpler; secrets visible in cron log and shell history | |
| Document both | Primary --env-file with inline as alternative | |

**User's choice:** --env-file

| Config injection | Description | Selected |
|------------------|-------------|----------|
| Volume mount | -v /path/to/config.yaml:/app/config.yaml; operator owns file; no rebuild to change rules | ✓ |
| Bake into image | COPY config.yaml at build time; simpler run command but requires rebuild to change rules | |

**User's choice:** Volume mount

**Notes:** CONFIG_PATH env var already exists in index.ts, so volume mount + CONFIG_PATH=/app/config.yaml is a zero-code-change wiring.

---

## Claude's Discretion

- Docker build: single-stage vs multi-stage, ENTRYPOINT vs CMD, .dockerignore — standard Node Alpine patterns
- BambooHR write endpoint paths — researcher confirms before planning
- INFRA-03 summary: move to console.log(JSON.stringify(summary)) on stdout
- Phase 3 CR-01 fix: recommend folding into Phase 4 Plan 1 since isDryRun() guard is being added anyway

## Deferred Ideas

- Phase 3 CR-01/CR-02/CR-03 gap plan: user chose not to do a separate gap plan; CR-01 folds into Phase 4
- 02-07 PDF download 404 gap: remains deferred post-Phase 4
