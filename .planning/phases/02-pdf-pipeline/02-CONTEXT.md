# Phase 2: PDF Pipeline - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

For each candidate that passes hard-rule evaluation, the system downloads their CV PDF from BambooHR, validates the content type, extracts plain text using `pdf-parse`, truncates it to a safe token size, and produces a typed `CandidateContext` object ready for agent evaluation. Candidates whose CV cannot be successfully extracted (non-PDF, extraction failure, image-only PDF) are flagged as `needsReview` with a reason and logged — they are not passed to GPT-4o.

</domain>

<decisions>
## Implementation Decisions

### Candidate Context Object

- **D-01:** Phase 2 introduces a new `CandidateContext` interface — separate from `CandidateDecision`. `CandidateDecision` stays as the log record only. `CandidateContext` is the in-flight pipeline state passed from Phase 2 into Phase 3 agent evaluation.

- **D-02:** `applicationAnswers` is typed as `Record<string, unknown>` — raw pass-through from the BambooHR API response. No normalization in Phase 2; the agent in Phase 3 receives the raw structure. This avoids assumptions about BambooHR's answer field shape before live API data is seen.

- **D-03:** `cvText` is `string | null` — `null` when the candidate needs human review (extraction failed or flagged).

- **D-04:** `needsReviewReason` is `string | null` — captures the specific reason a candidate was flagged: `'non-pdf-content-type'`, `'extraction-failed'`, `'image-only-pdf'`, or `null` when not applicable. This makes log output and Phase 3 skip logic explicit.

Final `CandidateContext` interface:
```typescript
interface CandidateContext {
  applicationId: number;
  applicantId: number;
  hardRuleResult: RuleResult;
  cvText: string | null;
  needsReviewReason: string | null;
  applicationAnswers: Record<string, unknown>;
}
```

### needsReview Outcome + Image-only PDF Detection

- **D-05:** Phase 2 implements the `PDF-03` image-only detection heuristic (despite being marked v2 in REQUIREMENTS.md) because it is required by Phase 2 success criterion #3. Detection threshold: **word count < 50 AND file size > 50 KB** — both conditions must be true.

- **D-06:** Image-only detection thresholds are **hardcoded** (not configurable in `config.yaml`). These are PDF extraction heuristics, not business rules — they don't belong in user-controlled config.

- **D-07:** Phase 2 extends `CandidateDecision.outcome` to `'pass' | 'fail' | 'needsReview' | 'error'`. This is required so that `needsReview` log lines are typed correctly when Phase 2 emits them.

- **D-08:** Phase 2 adds a `needsReview` counter to the main loop summary (alongside the existing `pass`, `fail`, `errors` counts). These candidates are produced in Phase 2, so the counter should exist when they are emitted.

### Claude's Discretion

- File location for `CandidateContext` type — `src/bamboohr/types.ts` (alongside existing BambooHR types) or a new `src/pipeline/types.ts`. Claude can decide based on cohesion.
- PDF download implementation — whether to add a `downloadPdf()` method to `BambooHRClient` or a standalone utility. Must handle binary response body and check `Content-Type: application/pdf` before attempting extraction.
- Where in `index.ts` the PDF pipeline step slots in (after `evaluateHardRules` returns `pass`, before `logDecision`).
- Word count calculation method (split on whitespace is sufficient).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Specs
- `.planning/REQUIREMENTS.md` — Phase 2 requirements: BAMB-04, PDF-01, PDF-02, RULE-03 (also PDF-03 from v2 — now implemented in Phase 2 per success criteria)
- `.planning/ROADMAP.md` — Phase 2 success criteria (4 items); dependency on Phase 1
- `.planning/PROJECT.md` — Key decisions, tech stack constraints
- `.planning/phases/01-foundation/01-CONTEXT.md` — Phase 1 decisions: `CandidateDecision` type, `RuleResult` type, `BambooHRClient.get<T>()`, fieldMap pattern, ESM `.js` import requirement

### External Docs (researcher must verify)
- `https://documentation.bamboohr.com` — BambooHR ATS API: confirm how CV/resume attachments are exposed (is it a `resumeFileId` requiring a second endpoint call, or a direct attachment URL on the application object?)
- `https://www.npmjs.com/package/pdf-parse` — `pdf-parse` API: confirm `pdf(buffer)` call signature and what the result object looks like (text, numpages, etc.)

### CLAUDE.md Constraints
- `CLAUDE.md` — ESM `"module": "NodeNext"` — all imports need `.js` extensions; no native npm dependencies (Alpine-compatible stack); `node:22-alpine` target

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/bamboohr/client.ts` — `BambooHRClient.get<T>()` handles auth + Accept header. Phase 2 needs a binary download method on this client (or alongside it) that skips JSON parsing and checks `Content-Type`.
- `src/rules/types.ts` — `RuleResult` interface (`outcome: 'pass' | 'fail'`, `reasons: string[]`) is the `hardRuleResult` field type in `CandidateContext`.
- `src/logger/logger.ts` — `logDecision()` emits `CandidateDecision` to stdout as JSON. Phase 2 extends `CandidateDecision.outcome` to include `'needsReview'`.
- `src/index.ts` — the main loop already has the `pass` branch where PDF download slots in (after `evaluateHardRules` returns `'pass'`).

### Established Patterns
- ESM TypeScript with `.js` import extensions throughout — Phase 2 code must follow this.
- No native npm dependencies — `pdf-parse` was chosen specifically because it has zero native deps and works in Alpine.
- `BambooHRApplication[key: string]: unknown` — the actual field path for `resumeFileId` (or equivalent) and `applicationAnswers` will only be known after the first real API run. Phase 2 code should be written to handle discovery gracefully.

### Integration Points
- `src/index.ts` candidate loop — PDF pipeline inserts between `evaluateHardRules()` and `logDecision()` for `pass` candidates.
- `CandidateContext` is the output type of Phase 2 and the input type for Phase 3 agent evaluation — its shape is locked by this discussion.

</code_context>

<specifics>
## Specific Ideas

- The `CandidateContext` interface shape was confirmed by the user (see D-01 through D-04 above) — the exact TypeScript definition is locked.
- `needsReviewReason` values are string literals: `'non-pdf-content-type'`, `'extraction-failed'`, `'image-only-pdf'`. Consider a union type or string enum for type safety — Claude's discretion.
- Image-only detection must check BOTH conditions (word count AND file size) — either alone is not sufficient.

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope.

</deferred>

---

*Phase: 2-PDF Pipeline*
*Context gathered: 2026-05-01*
