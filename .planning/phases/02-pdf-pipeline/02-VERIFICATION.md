---
phase: 02-pdf-pipeline
verified: 2026-05-01T20:00:00Z
status: human_needed
score: 15/16 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Run DRY_RUN=true with a BambooHR candidate that has a real PDF attachment"
    expected: "Script logs outcome='pass' with reasons=['CV extracted; pending Phase 3 agent evaluation'] and the CandidateContext.cvText is populated with truncated (<=8000 char) text extracted from the PDF"
    why_human: "SC1 requires a live BambooHR account with a real PDF attachment. pdf-parse extraction and the download endpoint paths are assumptions (A1, A2) that cannot be confirmed without real credentials."
  - test: "Run DRY_RUN=true with a BambooHR candidate whose attachment is not a PDF (e.g., .docx)"
    expected: "Script logs outcome='needsReview' with reasons=['non-pdf-content-type'] and does not call pdf-parse"
    why_human: "SC2 requires a live candidate with a non-PDF attachment. Content-Type header behavior is BambooHR-dependent and cannot be verified without a real API call."
  - test: "Run DRY_RUN=true with a BambooHR candidate who uploaded an image-only scanned PDF (large file, no extractable text)"
    expected: "Script logs outcome='needsReview' with reasons=['image-only-pdf']"
    why_human: "SC3 requires a real scanned PDF candidate. The dual-condition heuristic (wordCount < 50 AND buffer.length > 50KB) is code-verified but its behavior against real BambooHR PDFs must be confirmed."
---

# Phase 2: PDF Pipeline Verification Report

**Phase Goal:** For each candidate passing hard rules, the system downloads their CV PDF, validates it, extracts plain text, truncates it to a safe size, and produces a structured candidate context object ready for agent evaluation — with appropriate "Needs Human Review" fallback for unextractable CVs
**Verified:** 2026-05-01T20:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

All truths derived from ROADMAP.md success criteria and merged with PLAN frontmatter must_haves across plans 02-01 through 02-04.

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | src/pipeline/types.ts exports CandidateContext with exactly 6 fields (applicationId, applicantId, hardRuleResult, cvText, needsReviewReason, applicationAnswers) | ✓ VERIFIED | All 6 fields present at lines 26-48 of src/pipeline/types.ts |
| 2 | src/pipeline/types.ts exports NeedsReviewReason as a string literal union of exactly 3 values | ✓ VERIFIED | Lines 16-19: 'non-pdf-content-type' | 'extraction-failed' | 'image-only-pdf' |
| 3 | src/rules/types.ts CandidateDecision.outcome includes 'needsReview' | ✓ VERIFIED | Line 26: `outcome: 'pass' | 'fail' | 'needsReview' | 'error'` |
| 4 | pdf-parse@1.1.4 pinned in package.json (exact, no caret) | ✓ VERIFIED | `"pdf-parse": "1.1.4"` — no caret confirmed via python3 json parse |
| 5 | @types/pdf-parse in devDependencies | ✓ VERIFIED | `"@types/pdf-parse": "^1.1.5"` in devDependencies |
| 6 | BambooHRClient.downloadPdf() returns Promise<{ buffer: Buffer; contentType: string }> | ✓ VERIFIED | Method present at line 114 of src/bamboohr/client.ts with correct return type |
| 7 | downloadPdf() does NOT set Accept: application/json | ✓ VERIFIED | Only a comment `// NO Accept: application/json` inside the method; no actual Accept header set in downloadPdf body |
| 8 | downloadPdf() tries multiple endpoint paths on 404 and logs attempted paths | ✓ VERIFIED | candidatePaths array with 2 paths; 404 branch logs path and continues; all-fail throws with discovery instructions |
| 9 | src/pipeline/extract-cv.ts exports buildCandidateContext() returning Promise<CandidateContext> | ✓ VERIFIED | `export async function buildCandidateContext` at line 32 with correct return type |
| 10 | buildCandidateContext() logs Object.keys(detail) when resumeFileId is absent | ✓ VERIFIED | Lines 56-63: logs `Object.keys(detail)` with discovery message when rawFileId is absent/null/0 |
| 11 | buildCandidateContext() returns needsReviewReason for all 3 failure paths | ✓ VERIFIED | 'non-pdf-content-type' (line 88), 'extraction-failed' (lines 63, 79, 100), 'image-only-pdf' (line 112) |
| 12 | CV text truncated to 8000 characters via MAX_CV_CHARS | ✓ VERIFIED | `const MAX_CV_CHARS = 8000` at line 16; `rawText.slice(0, MAX_CV_CHARS)` at line 116 |
| 13 | src/index.ts imports buildCandidateContext and calls it for pass candidates | ✓ VERIFIED | Import at line 13-14; `await buildCandidateContext(client, detail, result)` at line 99 |
| 14 | needsReview counter declared, incremented, and included in summary line | ✓ VERIFIED | `let needsReview = 0` (line 75); `needsReview++` (line 110); summary line 156: `needsReview=${needsReview}` |
| 15 | tsc --noEmit exits 0 | ✓ VERIFIED | Confirmed clean exit with no errors |
| 16 | SC1: Running script against valid PDF candidate logs extracted CV text as part of candidate context | ? UNCERTAIN | Code correctly produces CandidateContext.cvText from pdf-parse output, but end-to-end behavior requires a live BambooHR run with a real PDF attachment |

**Score:** 15/16 truths verified (1 uncertain requiring human verification)

### Deferred Items

None — all Phase 2 items are implemented. SC1's human verification requirement is about confirming live-run behavior, not a deferred implementation.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/pipeline/types.ts` | CandidateContext + NeedsReviewReason | ✓ VERIFIED | 49 lines, substantive, exports both types |
| `src/rules/types.ts` | Extended CandidateDecision.outcome | ✓ VERIFIED | 'needsReview' added to outcome union (D-07) |
| `package.json` | pdf-parse@1.1.4 pinned | ✓ VERIFIED | Exact pin `"1.1.4"` (no caret), @types/pdf-parse in devDependencies |
| `src/bamboohr/client.ts` | downloadPdf() binary method | ✓ VERIFIED | 60-line method with multi-path discovery, arrayBuffer(), no Accept header |
| `src/pipeline/extract-cv.ts` | buildCandidateContext() orchestrator | ✓ VERIFIED | 148 lines, all 5 failure paths, image-only heuristic, truncation |
| `src/index.ts` | PDF pipeline wired into candidate loop | ✓ VERIFIED | needsReview counter, buildCandidateContext() call, summary line updated |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/pipeline/types.ts | src/rules/types.ts | `import type { RuleResult } from '../rules/types.js'` | ✓ WIRED | Line 9 of types.ts |
| src/pipeline/extract-cv.ts | src/bamboohr/client.ts downloadPdf() | `client.downloadPdf(applicationId, resumeFileId)` | ✓ WIRED | Line 75 of extract-cv.ts |
| src/pipeline/extract-cv.ts | src/pipeline/types.ts | `import type { CandidateContext, NeedsReviewReason } from './types.js'` | ✓ WIRED | Line 13 of extract-cv.ts |
| src/index.ts pass branch | src/pipeline/extract-cv.ts buildCandidateContext() | `await buildCandidateContext(client, detail, result)` | ✓ WIRED | Line 99 of index.ts |
| src/index.ts summary | needsReview counter | template string in console.error | ✓ WIRED | Line 156: `needsReview=${needsReview}` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| src/pipeline/extract-cv.ts | cvText | `pdfParse(buffer).text.slice(0, MAX_CV_CHARS)` | Yes — from real PDF binary buffer obtained via BambooHR API | ✓ FLOWING (code path correct; live confirmation is human verification item) |
| src/index.ts | CandidateContext | `buildCandidateContext(client, detail, result)` | Yes — flows from real BambooHR application detail to CandidateContext | ✓ FLOWING |
| logDecision (pass branch) | reasons[] | Placeholder string, NOT cvText | N/A — cvText intentionally excluded (GDPR T-02-04-01) | ✓ CORRECT by design |

Note: cvText is not logged in the JSON output (GDPR requirement) — it is held in memory for Phase 3 agent evaluation. This is not a stub; it is intentional design.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| pdf-parse@1.1.4 module loads | `node -e "import('pdf-parse').then(m=>console.log(typeof m.default))"` | `function` | ✓ PASS |
| tsc --noEmit exits 0 | `npx tsc --noEmit` | exit code 0, no errors | ✓ PASS |
| All 6 Phase 2 commits exist in git | `git log --oneline` | 33edee8, 93bf91b, 9095bd9, e32b42c, 56c16f2, cc8da16 all present | ✓ PASS |
| pdf-parse version is exactly 1.1.4 | python3 json parse of package.json | `'1.1.4'` — no caret | ✓ PASS |
| End-to-end live run with BambooHR | Requires live credentials + real candidates | Cannot test without external service | ? SKIP (human verification) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BAMB-04 | 02-02, 02-04 | Downloads candidate CV as a PDF buffer from BambooHR attachment URL | ✓ SATISFIED | `downloadPdf()` implemented in client.ts (lines 114-173); wired in extract-cv.ts (line 75) |
| PDF-01 | 02-03, 02-04 | Validates Content-Type: application/pdf; extracts plain text with pdf-parse | ✓ SATISFIED | `contentType.includes('application/pdf')` check (line 84); `pdfParse(buffer)` call (line 95) in extract-cv.ts |
| PDF-02 | 02-03, 02-04 | Truncates extracted CV text to max ~8000 characters | ✓ SATISFIED | `MAX_CV_CHARS = 8000`; `rawText.slice(0, MAX_CV_CHARS)` at line 116 of extract-cv.ts |
| RULE-03 | 02-01, 02-03, 02-04 | Produces "Needs Human Review" outcome for unextractable CVs | ✓ SATISFIED | All 3 NeedsReviewReason paths implemented; needsReview outcome wired in index.ts; CandidateDecision.outcome includes 'needsReview' |

All 4 Phase 2 requirements are satisfied by the implementation.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/index.ts | 122 | `reasons: ['CV extracted; pending Phase 3 agent evaluation']` | ℹ️ Info | Intentional placeholder — pass branch logs a stub reason string until Phase 3 adds real agent evaluation. Documented in 02-04-SUMMARY.md as a known and intentional stub. Does NOT prevent Phase 2 goal achievement. |

No blocker or warning-level anti-patterns found. The placeholder pass reason is explicitly documented and is the correct Phase 2 behavior.

### Human Verification Required

#### 1. Valid PDF Candidate End-to-End (SC1)

**Test:** Run `DRY_RUN=true npx tsx src/index.ts` with real BambooHR credentials pointing to a job opening that has at least one candidate with a PDF resume attachment.

**Expected:**
- Script logs a line to stdout like: `{"candidateId":N,"applicationId":N,"outcome":"pass","reasons":["CV extracted; pending Phase 3 agent evaluation"],"timestamp":"..."}`
- No crash from downloadPdf() (confirming the endpoint path assumption A2 is correct or the 404 fallback logs the correct discovery instructions)
- Internal CandidateContext.cvText is populated (can be confirmed by adding a temporary debug log or checking that `outcome: 'pass'` is reached rather than `outcome: 'needsReview'`)

**Why human:** Requires live BAMBOOHR_API_KEY, BAMBOOHR_SUBDOMAIN, and a real candidate with a PDF attachment. The BambooHR attachment endpoint path (A2 assumption) is undocumented and may need discovery via the 404 fallback on first run.

#### 2. Non-PDF Attachment Candidate (SC2)

**Test:** Run with a BambooHR candidate whose resume attachment is a .docx or .png file (not a PDF).

**Expected:** stdout contains `{"outcome":"needsReview","reasons":["non-pdf-content-type"],...}` with no pdf-parse call attempted.

**Why human:** Requires a candidate with a non-PDF attachment. The Content-Type header returned by BambooHR for non-PDF files is an assumption that must be confirmed against the live API.

#### 3. Image-Only PDF Candidate (SC3)

**Test:** Run with a BambooHR candidate who uploaded a scanned/image-only PDF resume (large file, no selectable text).

**Expected:** stdout contains `{"outcome":"needsReview","reasons":["image-only-pdf"],...}` — confirmed by wordCount < 50 AND buffer.length > 50KB both being true.

**Why human:** Requires a real scanned PDF candidate. The dual-threshold heuristic is code-correct but must be confirmed against real BambooHR PDF files.

### Gaps Summary

No implementation gaps found. All Phase 2 code is substantive, wired, and data-flowing. The 3 human verification items are behavioral end-to-end tests that require a live BambooHR environment — they are not code deficiencies.

The single UNCERTAIN truth (SC1) is uncertain because:
1. The BambooHR PDF download endpoint path is an undocumented assumption (A2) requiring live discovery
2. The `resumeFileId` field name is an assumption (A1) requiring live confirmation
3. SC2 and SC3 also fall under human_needed for the same reason

The implementation is complete and correct for Phase 2's scope. Phase 3 will consume `CandidateContext.cvText` for GPT-4o agent evaluation — the pass branch placeholder in index.ts is intentional and does not constitute a gap.

---

_Verified: 2026-05-01T20:00:00Z_
_Verifier: Claude (gsd-verifier)_
