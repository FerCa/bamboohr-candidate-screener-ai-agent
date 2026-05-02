# Phase 4: Live Mode & Deployment - Context

**Gathered:** 2026-05-02
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 4 enables live BambooHR writes when `LIVE_MODE=true`: every candidate processed (pass, fail, needsReview) is moved to the appropriate pipeline stage and receives a recruiter comment. The comment-first-then-move atomicity policy ensures no candidate lands in a moved-but-uncommented state. The pipeline is then packaged as a `node:22-alpine` Docker image that takes config via volume mount and secrets via `--env-file`, and the README documents the macOS crontab entry for daily execution. No changes to the agent evaluation logic — Phase 4 activates writes that Phase 3 deferred.

</domain>

<decisions>
## Implementation Decisions

### needsReview in LIVE_MODE

- **D-01:** `needsReview` candidates (CV extraction failed or GPT-4o call failed/parse error) are moved to the `Reviewed` stage in LIVE_MODE — same as `fail`. They do not stay in intake.

- **D-02:** The comment for a `needsReview` candidate matches the pass/fail structured format: `NEEDS REVIEW — Automated screening incomplete` as the header, followed by a brief reason (e.g., "CV could not be extracted" or "Evaluation engine error"), followed by the fixed audit footer `[Auto-screened by AI — final decision rests with recruiter]`. Keeps the recruiter UI consistent across all outcomes.

### Write Atomicity

- **D-03:** Comment is posted **before** stage move. Only if the comment POST succeeds does the stage move proceed. If either call fails, the candidate is left in the intake stage and counted as an `error` in the summary (not `processed`). No half-written state — the daily cron catches them again on the next run.

- **D-04:** This atomicity policy applies to **all** outcomes: `pass`, `fail`, `needsReview`. Every candidate that reaches the write step goes through comment-then-move.

- **D-05:** Hard-rule fails also trigger BambooHR writes in LIVE_MODE. They are moved to `Reviewed` and receive a comment listing the failed hard rules (e.g., `FAIL — Hard rules: Salary ceiling exceeded`). Same comment-first-then-move atomicity applies. This gives recruiters full visibility in BambooHR — nothing silently stays in intake.

### Docker & Cron Pattern

- **D-06:** Secrets are injected via `--env-file` (a secrets file on the server), not inline `-e KEY=value` flags. The crontab entry documented in the README uses `--env-file`. This keeps secrets out of shell history and cron logs.

- **D-07:** `config.yaml` is volume-mounted into the container at runtime: `-v /path/to/config.yaml:/app/config.yaml`. The existing `CONFIG_PATH=/app/config.yaml` env var wires it in (already implemented in `src/config/loader.ts`). No image rebuild required to change rules.

- **D-08:** The README documents both a macOS crontab entry and a note for Linux server deployment (per INFRA-04). The macOS crontab entry is a copy-paste-ready `crontab -e` line for daily execution.

### Claude's Discretion

- Docker image build: single-stage vs multi-stage, `ENTRYPOINT` vs `CMD`, `.dockerignore` contents — standard Node Alpine patterns.
- BambooHR write endpoints: researcher must confirm exact API paths for stage transitions (BAMB-02) and comments (BAMB-03) before planning. Use `applicationId` for both (not `applicantId`) per established constraint.
- INFRA-03 summary line: move from current `console.error` string to `console.log(JSON.stringify({processed, pass, fail, needsReview, errors}))` as the final stdout line. Claude decides the implementation detail.
- Phase 3 open CRs (CR-01, CR-02, CR-03): user chose NOT to address these in a separate gap plan. Recommend folding CR-01 fix (dry-run guard for OpenAI calls) into Phase 4 Plan 1 as part of the write-gating work, since the same `isDryRun()` guard pattern is being implemented anyway.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Specs
- `.planning/REQUIREMENTS.md` — Phase 4 requirements: INFRA-01, INFRA-03, INFRA-04; also BAMB-02, BAMB-03 (BambooHR writes, first implemented here)
- `.planning/ROADMAP.md` — Phase 4 success criteria (4 items); full phase dependency chain
- `.planning/PROJECT.md` — Key decisions, constraints, tech stack

### Prior Phase Context
- `.planning/phases/01-foundation/01-CONTEXT.md` — Config shape, fieldMap, ESM imports, `isDryRun()` pattern
- `.planning/phases/02-pdf-pipeline/02-CONTEXT.md` — `CandidateContext` shape, `needsReviewReason` values
- `.planning/phases/03-agent-evaluation/03-CONTEXT.md` — `EvaluationResult` shape (D-09–D-11, the Phase 4 write input); recruiter comment format; `applicationId` as write key; `comment` field is the ready-to-post string

### Key Source Files (must read before planning)
- `src/index.ts` — Main loop: the write calls for LIVE_MODE go after `logEvaluation(evalResult)` (line ~128) and after `logDecision()` for hard-rule fails (line ~155). The existing `dryRun` variable (line 37) gates all writes.
- `src/bamboohr/client.ts` — Existing BambooHR client; new `moveStage()` and `postComment()` methods are added here (Phase 4 deliverable). Researcher must confirm endpoint paths for both.
- `src/agent/types.ts` — `EvaluationResult` interface: `applicationId`, `outcome`, `comment` are the three fields consumed by Phase 4 write calls.
- `src/rules/types.ts` — `CandidateDecision`: hard-rule fails also produce a comment for LIVE_MODE (new in Phase 4). `reasons[]` array is the source for the comment body.
- `src/logger/logger.ts` — `logEvaluation()` and `logDecision()` already write to stdout. INFRA-03 requires an additional `console.log(JSON.stringify(summary))` as the final stdout line (replacing current `console.error` string).

### BambooHR API (researcher MUST verify)
- `https://documentation.bamboohr.com/reference` — Confirm endpoint for stage transition (BAMB-02): likely `POST /v1/applicant_tracking/applications/{applicationId}/move` or similar. Confirm endpoint for comment post (BAMB-03): likely `POST /v1/applicant_tracking/applications/{applicationId}/comments`. Both use `applicationId` (confirmed constraint from Phase 1). Use same auth pattern as existing `client.ts`.

### CLAUDE.md Constraints
- `CLAUDE.md` — `applicationId` (not `applicantId`) for all writes; `LIVE_MODE=true` required for writes; dry-run is default; ESM NodeNext `.js` imports throughout; one agent run per candidate (no change in Phase 4).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/bamboohr/client.ts` — `BambooHRClient` class; Phase 4 adds `moveStage(applicationId, stageId)` and `postComment(applicationId, comment)` methods following the same `this.request()` internal pattern.
- `src/index.ts` line 37 — `const dryRun = isDryRun()` already captures the flag. The write guard pattern is `if (!dryRun) { await client.postComment(...); await client.moveStage(...); }`.
- `src/agent/types.ts` — `EvaluationResult.comment` is the ready-to-post string; `EvaluationResult.outcome` drives the target stage lookup via `stageMap` (already populated in `main()`).
- `stageMap` (from `validateStages()`) — already maps stage names to IDs; Phase 4 resolves `config.job.stages.phoneScreen` and `config.job.stages.reviewed` from it for write calls.

### Established Patterns
- ESM TypeScript with `.js` import extensions — all Phase 4 files must follow this.
- Per-candidate `try/catch` in `src/index.ts` — write failures throw and are caught; candidate is counted as `error`, loop continues.
- `console.error` for diagnostic logs (mode, stages, counts), `console.log` for JSON records — INFRA-03 summary moves from `console.error` string to `console.log(JSON.stringify(summary))`.

### Integration Points
- `src/index.ts` after `logEvaluation(evalResult)`: add `if (!dryRun) { await writeCandidate(client, evalResult, stageMap, config); }` — or inline. Claude decides the factoring.
- `src/index.ts` after `logDecision()` for hard-rule fails: same write guard for the new hard-rule-fail write path.
- `src/bamboohr/client.ts`: add `moveStage()` and `postComment()` methods.
- `Dockerfile`: new file at project root targeting `node:22-alpine`.
- `README.md`: new or updated file with Docker build/run instructions and crontab entry.

</code_context>

<specifics>
## Specific Ideas

- The `stageMap` (already returned by `validateStages()` and available in `main()`) provides the stage IDs needed for write calls without an extra API call. `config.job.stages.phoneScreen` → `stageMap.get(...)` for pass, `config.job.stages.reviewed` → for fail/needsReview.
- Hard-rule fail comment format (new in Phase 4): mirrors the soft-eval format — `FAIL — Hard rules` header + bulleted `reasons[]` from `CandidateDecision` + audit footer. The comment string is assembled from `CandidateDecision.reasons` in the BambooHR write layer, not in the rules evaluator.
- The `--env-file` format for the crontab entry: a file like `/etc/screener.env` on the server containing `BAMBOOHR_API_KEY=...`, `BAMBOOHR_SUBDOMAIN=...`, `OPENAI_API_KEY=...`, `LIVE_MODE=true`. The README `.env.example` file can serve as the template for this secrets file.

</specifics>

<deferred>
## Deferred Ideas

- **Phase 3 CR-01/CR-02/CR-03**: User chose not to address in a separate gap plan. Recommend folding CR-01 (dry-run guard for OpenAI calls) into Phase 4 plan work. CR-02 and CR-03 are lower priority and can be addressed post-Phase 4 if needed.
- **02-07 gap (PDF download 404)**: Still deferred from Phase 2. Not blocking Phase 4 — live-mode write path only runs for candidates that cleared PDF extraction. Gap remains for post-Phase 4 hardening.

</deferred>

---

*Phase: 4-Live Mode & Deployment*
*Context gathered: 2026-05-02*
