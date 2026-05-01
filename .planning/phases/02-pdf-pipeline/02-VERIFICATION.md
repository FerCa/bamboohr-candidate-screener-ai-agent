---
phase: 02-pdf-pipeline
verified: 2026-05-01T20:46:19Z
status: human_needed
score: 21/22 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 15/16
  gaps_closed:
    - "downloadPdf() now accepts (applicationId, applicantId, fileId) — 3-argument signature (CR-02)"
    - "candidatePaths[1] uses applicantId (not applicationId) and has no leading /v1 segment (CR-01)"
    - "rawFileId validated at runtime as positive integer via Number.isInteger; unsafe 'as number' cast eliminated (CR-04)"
    - "extract-cv.ts call site passes applicantId as second argument to downloadPdf() (CR-02 call site)"
    - "validateStages() returns Promise<Map<string, number>> instead of Promise<void> (WR-03)"
    - "index.ts captures stageMap from validateStages(); no duplicate /applicant_tracking/statuses API call (WR-03)"
    - "index.ts resolves intake stage from config.job.stages.intake via stageMap (CR-03)"
    - "hasPlaceholders uses fieldMapValues.length === 0 || fieldMapValues.some(...) — vacuous-true bug fixed (WR-01)"
    - "PII log (JSON.stringify(detail)) replaced with structure-only typeof log (WR-02)"
    - "config.yaml stages block has intake: 'New' entry (CR-03)"
    - "src/config/schema.ts stages object has intake: z.string().min(1) field (CR-03)"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Run DRY_RUN=true with a BambooHR candidate that has a real PDF attachment"
    expected: "Script logs outcome='pass' with reasons=['CV extracted; pending Phase 3 agent evaluation'] and CandidateContext.cvText is populated with truncated (<=8000 char) text extracted from the PDF"
    why_human: "The BambooHR PDF download endpoint path (Assumption A2) is undocumented and cannot be confirmed without live credentials. The resumeFileId field name (Assumption A1) also requires live confirmation."
  - test: "Run DRY_RUN=true with a BambooHR candidate whose attachment is not a PDF (e.g. .docx)"
    expected: "Script logs outcome='needsReview' with reasons=['non-pdf-content-type'] and does not call pdf-parse"
    why_human: "Requires a live candidate with a non-PDF attachment. Content-Type header behavior from BambooHR for non-PDF files is an assumption that must be confirmed against the live API."
  - test: "Run DRY_RUN=true with a BambooHR candidate who uploaded an image-only scanned PDF (large file, no extractable text)"
    expected: "Script logs outcome='needsReview' with reasons=['image-only-pdf'] — confirmed by wordCount < 50 AND buffer.length > 50KB both being true"
    why_human: "Requires a real scanned PDF candidate. The dual-threshold heuristic is code-correct but must be confirmed against real BambooHR PDF files."
---

# Phase 2: PDF Pipeline Verification Report

**Phase Goal:** For each candidate passing hard rules, the system downloads their CV PDF, validates it, extracts plain text, truncates it to a safe size, and produces a structured candidate context object ready for agent evaluation — with appropriate "Needs Human Review" fallback for unextractable CVs
**Verified:** 2026-05-01T20:46:19Z
**Status:** human_needed
**Re-verification:** Yes — after gap-closure plans 02-05 and 02-06

## Goal Achievement

### Observable Truths

Must-haves merged from PLAN frontmatter across plans 02-01 through 02-06 (gap-closure plans included).

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | src/pipeline/types.ts exports CandidateContext with exactly 6 fields (applicationId, applicantId, hardRuleResult, cvText, needsReviewReason, applicationAnswers) | ✓ VERIFIED | All 6 fields at lines 26-48 of src/pipeline/types.ts |
| 2 | src/pipeline/types.ts exports NeedsReviewReason as a string literal union of exactly 3 values | ✓ VERIFIED | Lines 16-19: 'non-pdf-content-type' \| 'extraction-failed' \| 'image-only-pdf' |
| 3 | src/rules/types.ts CandidateDecision.outcome includes 'needsReview' | ✓ VERIFIED | Line 26: `outcome: 'pass' \| 'fail' \| 'needsReview' \| 'error'` with D-07 comment |
| 4 | pdf-parse@1.1.4 pinned in package.json (exact, no caret) | ✓ VERIFIED | `"pdf-parse": "1.1.4"` — no caret |
| 5 | @types/pdf-parse in devDependencies | ✓ VERIFIED | `"@types/pdf-parse": "^1.1.5"` in devDependencies |
| 6 | BambooHRClient.downloadPdf() signature is (applicationId: number, applicantId: number, fileId: number) | ✓ VERIFIED | Lines 118-121 of src/bamboohr/client.ts — 3-argument signature confirmed |
| 7 | downloadPdf() does NOT set Accept: application/json | ✓ VERIFIED | Comment `// NO Accept: application/json` inside the method; no Accept header in downloadPdf body |
| 8 | downloadPdf() tries multiple endpoint paths on 404 and logs attempted paths | ✓ VERIFIED | candidatePaths array with 2 paths; 404 branch logs path and continues; all-fail throws with discovery instructions |
| 9 | candidatePaths[1] uses applicantId (not applicationId) and has no leading /v1 segment | ✓ VERIFIED | Line 130: `/employees/${applicantId}/files/${fileId}` — no /v1 prefix (baseUrl already ends with /api/v1) |
| 10 | validateStages() return type is Promise<Map<string, number>> | ✓ VERIFIED | Line 61 of client.ts: `async validateStages(config: Config): Promise<Map<string, number>>` |
| 11 | src/pipeline/extract-cv.ts exports buildCandidateContext() returning Promise<CandidateContext> | ✓ VERIFIED | `export async function buildCandidateContext` at line 32 with correct return type |
| 12 | rawFileId validated at runtime as positive integer before use; returns needsReview('extraction-failed') if not | ✓ VERIFIED | Lines 55-70: `typeof rawFileId === 'number' && Number.isInteger(rawFileId) && rawFileId > 0` — no `as number` cast remaining |
| 13 | extract-cv.ts call site passes detail.applicant.id as second argument to downloadPdf() | ✓ VERIFIED | Line 79: `client.downloadPdf(applicationId, applicantId, resumeFileId)` |
| 14 | buildCandidateContext() returns needsReviewReason for all 3 failure paths | ✓ VERIFIED | 'non-pdf-content-type' (line 92), 'extraction-failed' (lines 69, 83, 104), 'image-only-pdf' (line 116) |
| 15 | CV text truncated to 8000 characters via MAX_CV_CHARS | ✓ VERIFIED | `const MAX_CV_CHARS = 8000` at line 16; `rawText.slice(0, MAX_CV_CHARS)` at line 120 |
| 16 | src/index.ts imports buildCandidateContext and calls it for pass candidates | ✓ VERIFIED | Import at lines 13-14; `await buildCandidateContext(client, detail, result)` at line 102 |
| 17 | needsReview counter declared, incremented, and included in summary line | ✓ VERIFIED | `let needsReview = 0` (line 72); `needsReview++` (line 113); summary at line 159: `needsReview=${needsReview}` |
| 18 | index.ts captures stageMap from validateStages(); no duplicate /applicant_tracking/statuses API call | ✓ VERIFIED | Line 47: `const stageMap = await client.validateStages(config)`; grep returns 0 occurrences of `applicant_tracking/statuses` in index.ts |
| 19 | configSchema stages object has intake: z.string().min(1) field | ✓ VERIFIED | Line 37 of src/config/schema.ts: `intake: z.string().min(1)` inside stages z.object() |
| 20 | config.yaml stages block has intake: 'New' entry | ✓ VERIFIED | Line 9 of config.yaml: `intake: "New"` |
| 21 | hasPlaceholders uses fieldMapValues.length === 0 \|\| fieldMapValues.some(...) | ✓ VERIFIED | Lines 76-77 of index.ts: vacuous-true bug fixed |
| 22 | End-to-end: running script with a valid PDF candidate logs outcome='pass' with extracted CV text | ? UNCERTAIN | Code path is correct and complete; live BambooHR run required to confirm Assumption A1 (resumeFileId field name) and Assumption A2 (download endpoint path) |

**Score:** 21/22 truths verified (1 uncertain requiring human verification)

### Deferred Items

None — all Phase 2 items are implemented. SC1's human verification requirement is about confirming live-run behavior against undocumented BambooHR assumptions, not a deferred implementation.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/pipeline/types.ts` | CandidateContext + NeedsReviewReason | ✓ VERIFIED | 49 lines, substantive, exports both types with correct shapes |
| `src/rules/types.ts` | Extended CandidateDecision.outcome | ✓ VERIFIED | 'needsReview' added to outcome union (D-07) |
| `package.json` | pdf-parse@1.1.4 pinned | ✓ VERIFIED | Exact pin `"1.1.4"` (no caret), @types/pdf-parse in devDependencies |
| `src/bamboohr/client.ts` | downloadPdf() with (applicationId, applicantId, fileId); validateStages() returning Map | ✓ VERIFIED | 3-arg signature; candidatePaths[1] uses applicantId, no /v1 prefix; validateStages returns Map<string, number> |
| `src/pipeline/extract-cv.ts` | buildCandidateContext() with runtime fileId validation; 3-arg downloadPdf call | ✓ VERIFIED | 152 lines; Number.isInteger validation; no `as number` cast; downloadPdf(applicationId, applicantId, resumeFileId) |
| `src/index.ts` | stageMap wiring, fixed hasPlaceholders, safe PII log, PDF pipeline wired | ✓ VERIFIED | stageMap captured; no duplicate statuses call; fieldMapValues.some() fix; no JSON.stringify(detail) |
| `src/config/schema.ts` | intake field in stages Zod schema | ✓ VERIFIED | `intake: z.string().min(1)` at line 37 |
| `config.yaml` | intake stage value | ✓ VERIFIED | `intake: "New"` at line 9 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/pipeline/types.ts | src/rules/types.ts | `import type { RuleResult } from '../rules/types.js'` | ✓ WIRED | Line 9 of types.ts |
| src/pipeline/extract-cv.ts | src/pipeline/types.ts | `import type { CandidateContext, NeedsReviewReason } from './types.js'` | ✓ WIRED | Line 13 of extract-cv.ts |
| src/pipeline/extract-cv.ts | src/bamboohr/client.ts downloadPdf() | `client.downloadPdf(applicationId, applicantId, resumeFileId)` | ✓ WIRED | Line 79 of extract-cv.ts — 3-argument call confirmed |
| src/index.ts pass branch | src/pipeline/extract-cv.ts buildCandidateContext() | `await buildCandidateContext(client, detail, result)` | ✓ WIRED | Line 102 of index.ts |
| src/index.ts | client.validateStages() | `const stageMap = await client.validateStages(config)` | ✓ WIRED | Line 47 of index.ts; return value captured |
| src/index.ts | config.job.stages.intake | `stageMap.get(intakeStageName)` where `intakeStageName = config.job.stages.intake` | ✓ WIRED | Lines 52-53 of index.ts |
| src/index.ts summary | needsReview counter | template string in console.error | ✓ WIRED | Line 159: `needsReview=${needsReview}` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| src/pipeline/extract-cv.ts | cvText | `pdfParse(buffer).text.slice(0, MAX_CV_CHARS)` | Yes — from real PDF binary buffer obtained via BambooHR API | ✓ FLOWING (code path correct; live endpoint confirmation is human verification item) |
| src/index.ts | CandidateContext | `buildCandidateContext(client, detail, result)` | Yes — flows from real BambooHR application detail through PDF download to CandidateContext | ✓ FLOWING |
| src/index.ts | stageMap / intakeId | `validateStages(config)` returns Map populated from `/applicant_tracking/statuses` API | Yes — populated from live API response, no static values | ✓ FLOWING |
| logDecision (pass branch) | reasons[] | Placeholder string, NOT cvText | N/A — cvText intentionally excluded from logs (GDPR; T-02-04-01) | ✓ CORRECT by design |

Note: cvText is not logged in JSON output — it is held in memory for Phase 3 agent evaluation. This is intentional design, not a stub.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| pdf-parse@1.1.4 module loads | `node -e "require('pdf-parse'); console.log('ok')"` | `ok` | ✓ PASS |
| tsc --noEmit exits 0 | `npx tsc --noEmit` | exit code 0, no output | ✓ PASS |
| No double /v1 in downloadPdf fallback path | `grep -c "/v1/employees" src/bamboohr/client.ts` | `0` | ✓ PASS |
| Unsafe fileId cast eliminated | `grep -c "rawFileId as number" src/pipeline/extract-cv.ts` | `0` | ✓ PASS |
| PII log removed from index.ts | `grep -c 'JSON.stringify(detail, null, 2)' src/index.ts` | `0` | ✓ PASS |
| Duplicate statuses API call removed | `grep -c "applicant_tracking/statuses" src/index.ts` | `0` | ✓ PASS |
| End-to-end live run with BambooHR | Requires live credentials + real candidates | Cannot test without external service | ? SKIP (human verification) |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BAMB-04 | 02-02, 02-04, 02-05 | Downloads candidate CV as a PDF buffer from BambooHR attachment URL | ✓ SATISFIED | `downloadPdf()` in client.ts with 3-arg signature (applicationId, applicantId, fileId); multi-path fallback; wired from extract-cv.ts line 79 |
| PDF-01 | 02-03, 02-04 | Validates Content-Type: application/pdf; extracts plain text with pdf-parse | ✓ SATISFIED | `contentType.includes('application/pdf')` check (line 88); `pdfParse(buffer)` call (line 99) in extract-cv.ts |
| PDF-02 | 02-03, 02-04 | Truncates extracted CV text to max ~8000 characters | ✓ SATISFIED | `MAX_CV_CHARS = 8000`; `rawText.slice(0, MAX_CV_CHARS)` at line 120 of extract-cv.ts |
| RULE-03 | 02-01, 02-03, 02-04 | Produces "Needs Human Review" outcome for unextractable CVs | ✓ SATISFIED | All 3 NeedsReviewReason paths implemented; needsReview outcome wired in index.ts; CandidateDecision.outcome includes 'needsReview' |

All 4 Phase 2 requirements are satisfied by the implementation.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/index.ts | 125 | `reasons: ['CV extracted; pending Phase 3 agent evaluation']` | ℹ️ Info | Intentional placeholder — pass branch logs a stub reason string until Phase 3 adds real agent evaluation. Documented behavior; does NOT prevent Phase 2 goal achievement. |

No blocker or warning-level anti-patterns found. The placeholder pass reason is explicitly documented and is the correct Phase 2 behavior (Phase 3 will replace it with GPT-4o evaluation results).

Gap-closure plans 02-05 and 02-06 resolved all 6 code-review findings identified in 02-REVIEW.md:

- CR-01: Double /v1 in fallback path — FIXED
- CR-02: Wrong entity ID (applicationId vs applicantId) in employee-files path — FIXED
- CR-03: Hardcoded "New" stage, missing intake config — FIXED
- CR-04: Unsafe fileId cast — FIXED
- WR-01: Vacuous-true hasPlaceholders — FIXED
- WR-02: PII log (JSON.stringify(detail)) — FIXED
- WR-03: Duplicate statuses API call + discarded validateStages return — FIXED

### Human Verification Required

#### 1. Valid PDF Candidate End-to-End (SC1)

**Test:** Run `DRY_RUN=true npx tsx src/index.ts` with real BambooHR credentials pointing to a job opening with at least one candidate who has a PDF resume attachment.

**Expected:**
- Script logs a stdout JSON line like: `{"candidateId":N,"applicationId":N,"outcome":"pass","reasons":["CV extracted; pending Phase 3 agent evaluation"],"timestamp":"..."}`
- No crash from downloadPdf() (confirming Assumption A2 endpoint path is correct, or the 404 fallback logs the correct discovery instructions)
- outcome is 'pass' rather than 'needsReview', confirming Assumption A1 (resumeFileId field name) is correct

**Why human:** Requires live BAMBOOHR_API_KEY, BAMBOOHR_SUBDOMAIN, and a real candidate with a PDF attachment. The BambooHR attachment endpoint path (Assumption A2) is undocumented and may need discovery via the 404 fallback on first run.

#### 2. Non-PDF Attachment Candidate (SC2)

**Test:** Run with a BambooHR candidate whose resume attachment is a .docx or .png file (not a PDF).

**Expected:** stdout contains `{"outcome":"needsReview","reasons":["non-pdf-content-type"],...}` with no pdf-parse call attempted.

**Why human:** Requires a candidate with a non-PDF attachment. The Content-Type header returned by BambooHR for non-PDF files is an assumption that must be confirmed against the live API.

#### 3. Image-Only PDF Candidate (SC3)

**Test:** Run with a BambooHR candidate who uploaded a scanned/image-only PDF resume (large file, no selectable text).

**Expected:** stdout contains `{"outcome":"needsReview","reasons":["image-only-pdf"],...}` — confirmed by wordCount < 50 AND buffer.length > 50KB both being true.

**Why human:** Requires a real scanned PDF candidate. The dual-threshold heuristic (wordCount < IMAGE_ONLY_WORD_THRESHOLD && buffer.length > IMAGE_ONLY_SIZE_THRESHOLD) is code-correct but must be confirmed against real BambooHR PDF files.

### Gaps Summary

No implementation gaps found. All Phase 2 code is substantive, wired, and data-flowing. All 6 code-review findings from 02-REVIEW.md were resolved by gap-closure plans 02-05 and 02-06. The 3 human verification items are behavioral end-to-end tests that require a live BambooHR environment — they are not code deficiencies.

The single UNCERTAIN truth (end-to-end live run) is uncertain because:
1. The BambooHR PDF download endpoint path is an undocumented assumption (A2) requiring live discovery
2. The `resumeFileId` field name on the application detail object is an assumption (A1) requiring live confirmation

Both of these are structural limitations of the BambooHR API's incomplete public documentation, not implementation gaps. The code has a correct 404 fallback with discovery instructions (stderr logs attempted paths and Postman collection URL) that will surface the correct path on the first DRY_RUN.

---

_Verified: 2026-05-01T20:46:19Z_
_Verifier: Claude (gsd-verifier)_
