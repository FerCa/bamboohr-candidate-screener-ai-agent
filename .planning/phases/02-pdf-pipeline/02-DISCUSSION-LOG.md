# Phase 2: PDF Pipeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-01
**Phase:** 2-pdf-pipeline
**Areas discussed:** Candidate context object, needsReview outcome + image-only PDF

---

## Candidate Context Object

| Option | Description | Selected |
|--------|-------------|----------|
| New CandidateContext interface | Separate from CandidateDecision; CandidateDecision stays as log record | ✓ |
| Extend CandidateDecision | Add cvText and applicationAnswers directly onto the log record | |

**User's choice:** New CandidateContext interface

---

| Option | Description | Selected |
|--------|-------------|----------|
| Raw pass-through: Record<string, unknown> | Application answers stored as-is from BambooHR API — no normalization | ✓ |
| Typed Q&A array: {question: string; answer: string}[] | Normalize to uniform array — cleaner for agent but requires knowing field shape in advance | |

**User's choice:** Raw pass-through — avoids assumptions before live API data is seen

---

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, add needsReviewReason | string \| null field capturing 'non-pdf-content-type', 'extraction-failed', 'image-only-pdf' | ✓ |
| No — reason goes in reasons[] array | Keep CandidateContext lean; reason already in CandidateDecision.reasons | |

**User's choice:** Add needsReviewReason to CandidateContext

---

## needsReview Outcome + Image-only PDF

| Option | Description | Selected |
|--------|-------------|----------|
| Implement PDF-03 thresholds now | word count < 50 AND file size > 50 KB — required by Phase 2 success criterion #3 | ✓ |
| Skip image-only detection in Phase 2 | Only handle non-PDF content-type and extraction failures; defer to v2 | |

**User's choice:** Implement PDF-03 thresholds in Phase 2

---

| Option | Description | Selected |
|--------|-------------|----------|
| Hardcoded thresholds | Baked into extractor — simple, not user-configurable | ✓ |
| Configurable in config.yaml | pdfOptions section with minWordCount and minFileSizeKb | |

**User's choice:** Hardcoded — PDF heuristics don't belong in user config

---

| Option | Description | Selected |
|--------|-------------|----------|
| Extend outcome type + add counter now | 'needsReview' added to CandidateDecision.outcome + needsReview counter in main loop | ✓ |
| Add outcome type now, counter in Phase 4 | Extend type now; defer counter to Phase 4 INFRA-03 implementation | |

**User's choice:** Add both outcome type extension and counter in Phase 2

---

## Claude's Discretion

- File location for `CandidateContext` type (`src/bamboohr/types.ts` vs new `src/pipeline/types.ts`)
- Whether `needsReviewReason` uses a string union type or string enum
- PDF download implementation (method on BambooHRClient vs standalone utility)
- Word count calculation method

## Deferred Ideas

None — discussion stayed within phase scope.
