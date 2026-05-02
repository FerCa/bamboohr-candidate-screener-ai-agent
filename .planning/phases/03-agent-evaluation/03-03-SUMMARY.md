---
phase: 03-agent-evaluation
plan: "03"
subsystem: agent
tags: [openai-agents, gpt-4o, structured-output, prompt-engineering, soft-rules]
dependency_graph:
  requires: ["03-01", "03-02"]
  provides: ["03-04"]
  affects: []
tech_stack:
  added: []
  patterns:
    - "Pure-function prompt builders (no SDK imports, no async)"
    - "Recoverable-vs-rethrow split: MaxTurnsExceededError → needsReview; all others re-throw"
    - "Agent with explicit model:'gpt-4o' + outputType:EvaluationOutputSchema (Pattern 1)"
    - "softRules absent/empty short-circuit avoids OpenAI API call entirely"
key_files:
  created:
    - src/agent/prompt.ts
    - src/agent/evaluator.ts
  modified: []
decisions:
  - "model:'gpt-4o' hardcoded in Agent constructor — SDK default is gpt-4.1 (Pitfall #1)"
  - "MaxTurnsExceededError is the only recoverable SDK error; all others re-throw"
  - "softRules absent/empty treated as pass with 'No soft rules configured' — no API cost"
  - "hardRuleResult excluded from user message (D-07) — comment covers soft evaluation only"
  - "Audit footer '[Auto-screened by AI — final decision rests with recruiter]' hardcoded in buildSystemPrompt()"
metrics:
  duration: "3 minutes"
  completed: "2026-05-02"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 03 Plan 03: Prompt Builders and Soft Evaluation Orchestrator Summary

GPT-4o soft evaluation core: pure-function prompt builders (prompt.ts) and evaluateSoftRules() orchestrator (evaluator.ts) with model:'gpt-4o', maxTurns:5, MaxTurnsExceededError → needsReview, and softRules-absent short-circuit.

## What Was Built

### src/agent/prompt.ts (NEW)

Two pure exported functions — no async, no SDK imports, no side effects:

- `buildSystemPrompt(softRules: SoftRulesPromptInput): string` — builds the GPT-4o system prompt with numbered required/optional criteria lists, evaluation rules (pass logic, rationale style, outcome computation), and the hardcoded audit footer `[Auto-screened by AI — final decision rests with recruiter]` (D-06 / CONTEXT.md Specific Ideas).
- `buildUserMessage(ctx: CandidateContext): string` — serializes `ctx.cvText` and `ctx.applicationAnswers` only. `ctx.hardRuleResult` is explicitly excluded (D-07 / Pitfall #5) — only the soft evaluation is covered in the comment.

Local `SoftRuleEntry` and `SoftRulesPromptInput` interfaces are intentionally decoupled from the Zod-derived `Config` type for testability.

### src/agent/evaluator.ts (NEW)

`evaluateSoftRules(ctx, softRules)` orchestrator following the recoverable-vs-rethrow pattern from `src/pipeline/extract-cv.ts`:

1. **softRules absent/empty short-circuit** — returns `{outcome:'pass', comment:'No soft rules configured'}` without constructing an Agent or calling OpenAI (D-Discretion; saves cost during testing and for Phase 1/2 backward-compatible configs).
2. **Agent construction** — `model: 'gpt-4o'` explicitly (Pitfall #1 mitigation; SDK default is `gpt-4.1`). `outputType: EvaluationOutputSchema` for typed structured output (Pattern 1).
3. **run() call** — `maxTurns: 5` enforcing SAFE-02 cap.
4. **Error handling** — `MaxTurnsExceededError` caught and mapped to `needsReview` (Pitfall #3). All other errors re-throw to outer handler in `src/index.ts` which logs `outcome:'error'`.
5. **Private `needsReviewResult()` helper** — mirrors `makeNeedsReview()` in `extract-cv.ts`.

CONF-03 compliance is automatic — `OPENAI_API_KEY` is never referenced; the SDK reads it from `process.env` via `getDefaultOpenAIKey()`.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | 58ceac9 | feat(03-03): create src/agent/prompt.ts |
| Task 2 | 0a9c758 | feat(03-03): create src/agent/evaluator.ts |

## Pitfall Mitigations Applied

| Pitfall | Mitigation |
|---------|------------|
| Pitfall #1: Wrong default model (gpt-4.1) | `model: 'gpt-4o'` hardcoded in Agent constructor |
| Pitfall #3: MaxTurnsExceededError bubbles to outer handler | Caught inside evaluateSoftRules(); mapped to needsReview |
| Pitfall #4: Code computes outcome from required array | Outcome included in EvaluationOutputSchema; GPT-4o computes it |
| Pitfall #5: hardRuleResult in user message | buildUserMessage() accesses only cvText + applicationAnswers |

## Threat Mitigations Applied

| Threat | Mitigation |
|--------|-----------|
| T-03-03-01: CV prompt injection | CV inserted as plain text in delimited user message; system prompt hardcoded in buildSystemPrompt() |
| T-03-03-02: OPENAI_API_KEY exposure | Zero references to OPENAI_API_KEY in evaluator.ts |
| T-03-03-03: Runaway turn loop | maxTurns:5 on every run(); MaxTurnsExceededError never retried |
| T-03-03-04: CV text in logs | Only applicationId used in console.error diagnostics |
| T-03-03-05: Schema drift | Single-source EvaluationOutputSchema drives both outputType and EvaluationResult types |

## Verification

- `npx tsc --noEmit` exits 0 (both tasks)
- Acceptance criteria grep checks all pass
- Smoke test (short-circuit path): confirmed by code inspection — softRules=undefined returns `{outcome:'pass', comment:'No soft rules configured', required:[]}` at line 44-55 without constructing Agent or calling run()

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None — both files are complete implementations. Task 1 and Task 2 deliver the full contract. Plan 04 wires evaluateSoftRules() into src/index.ts.

## Self-Check: PASSED

- src/agent/prompt.ts: exists, 111 lines, two exports, no SDK imports, audit footer hardcoded, hardRuleResult excluded
- src/agent/evaluator.ts: exists, 121 lines, evaluateSoftRules exported, model:'gpt-4o', maxTurns:5, MaxTurnsExceededError catch, throw err, short-circuit path
- Commits 58ceac9 and 0a9c758: verified in git log
- tsc --noEmit: clean
