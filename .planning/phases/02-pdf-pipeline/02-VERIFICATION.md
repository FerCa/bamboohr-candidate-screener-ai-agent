---
phase: 02-pdf-pipeline
verified: 2026-05-01T22:15:00Z
status: human_needed
score: 21/22 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: human_needed
  previous_score: 21/22
  gaps_closed:
    - "getApplicationDocuments() method added to BambooHRClient — two-step PDF download approach (GAP-02)"
    - "downloadPdf() calls getApplicationDocuments() before binary download; candidatePaths loop removed (GAP-02)"
    - "downloadPdf() logs raw docsRaw JSON on docs.length===0 and no-URL-found failure paths (GAP-02)"
    - "downloadPdf() throws on all failure paths; extract-cv.ts try/catch returns needsReview('extraction-failed') (GAP-02)"
    - "tsc --noEmit exits 0 after plan 07 changes"
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Run DRY_RUN=true with a BambooHR candidate that has a real PDF attachment"
    expected: "Script logs outcome='pass' with reasons=['CV extracted; pending Phase 3 agent evaluation'] and CandidateContext.cvText is populated with truncated (<=8000 char) text extracted from the PDF"
    why_human: "The BambooHR documents list endpoint response shape (field name for download URL) is undocumented and cannot be confirmed without live credentials. The resumeFileId field name (Assumption A1) also requires live confirmation."
  - test: "Run DRY_RUN=true with a BambooHR candidate whose attachment is not a PDF (e.g. .docx)"
    expected: "Script logs outcome='needsReview' with reasons=['non-pdf-content-type'] and does not call pdf-parse"
    why_human: "Requires a live candidate with a non-PDF attachment. Content-Type header behavior from BambooHR for non-PDF files is an assumption that must be confirmed against the live API."
  - test: "Run DRY_RUN=true with a BambooHR candidate who uploaded an image-only scanned PDF (large file, no extractable text)"
    expected: "Script logs outcome='needsReview' with reasons=['image-only-pdf'] — confirmed by wordCount < 50 AND buffer.length > 50KB both being true"
    why_human: "Requires a real scanned PDF candidate. The dual-threshold heuristic is code-correct but must be confirmed against real BambooHR PDF files."
---

# Phase 2: PDF Pipeline Verification Report

**Phase Goal:** For each candidate passing hard rules, the system downloads their CV PDF, validates it, extracts plain text, truncates it to a safe size, and produces a structured candidate context object ready for agent evaluation — with appropriate "Needs Human Review" fallback for unextractable CVs
**Verified:** 2026-05-01T22:15:00Z
**Status:** human_needed
**Re-verification:** Yes — after gap-closure plans 02-05, 02-06, and 02-07

## Goal Achievement

### Observable Truths

Must-haves merged from PLAN frontmatter across plans 02-01 through 02-07 (gap-closure plans included).

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | src/pipeline/types.ts exports CandidateContext with exactly 6 fields (applicationId, applicantId, hardRuleResult, cvText, needsReviewReason, applicationAnswers) | ✓ VERIFIED | All 6 fields at lines 26-48 of src/pipeline/types.ts |
| 2 | src/pipeline/types.ts exports NeedsReviewReason as a string literal union of exactly 3 values | ✓ VERIFIED | Lines 16-19: 'non-pdf-content-type' \| 'extraction-failed' \| 'image-only-pdf' |
| 3 | src/rules/types.ts CandidateDecision.outcome includes 'needsReview' | ✓ VERIFIED | Line 26: `outcome: 'pass' \| 'fail' \| 'needsReview' \| 'error'` with D-07 comment |
| 4 | pdf-parse@1.1.4 pinned in package.json (exact, no caret) | ✓ VERIFIED | `"pdf-parse": "1.1.4"` — no caret |
| 5 | @types/pdf-parse in devDependencies | ✓ VERIFIED | `"@types/pdf-parse": "^1.1.5"` in devDependencies |
| 6 | BambooHRClient.downloadPdf() signature is (applicationId: number, applicantId: number, fileId: number) | ✓ VERIFIED | Lines 128-132 of src/bamboohr/client.ts — 3-argument signature unchanged |
| 7 | downloadPdf() does NOT set Accept: application/json on the binary download step | ✓ VERIFIED | Comment `// NO Accept: application/json — binary response` inside binary fetch block; no Accept header set on Step 2 fetch |
| 8 | downloadPdf() uses a two-step approach: calls getApplicationDocuments() first, then extracts a download URL from the document list and performs a binary fetch | ✓ VERIFIED | getApplicationDocuments() added at client.ts line 110; called inside downloadPdf() at line 136 (Step 1); binary fetch performed at line 254 (Step 2). candidatePaths loop is gone (grep returns 0 occurrences). extractUrl helper tries 8 URL field names defensively; matchesFileId helper prefers document matching fileId before falling back to first document with any URL |
| 9 | The old candidatePaths two-URL loop is replaced; no /v1 double-prefix or wrong-entity-ID risk remains | ✓ VERIFIED | `grep -c "candidatePaths" src/bamboohr/client.ts` returns 0. The two-step documents-list approach eliminates the applicantId/applicationId path confusion entirely — the URL comes from the BambooHR document object itself, not from a constructed path |
| 10 | validateStages() return type is Promise<Map<string, number>> | ✓ VERIFIED | Line 61 of client.ts: `async validateStages(config: Config): Promise<Map<string, number>>` |
| 11 | src/pipeline/extract-cv.ts exports buildCandidateContext() returning Promise<CandidateContext> | ✓ VERIFIED | `export async function buildCandidateContext` at line 32 with correct return type |
| 12 | rawFileId validated at runtime as positive integer before use; returns needsReview('extraction-failed') if not | ✓ VERIFIED | Lines 55-69: `typeof rawFileId === 'number' && Number.isInteger(rawFileId) && rawFileId > 0` — no `as number` cast remaining |
| 13 | extract-cv.ts call site passes detail.applicant.id as second argument to downloadPdf() | ✓ VERIFIED | Line 81: `client.downloadPdf(applicationId, applicantId, resumeFileId)` — unchanged |
| 14 | buildCandidateContext() returns needsReviewReason for all 3 failure paths | ✓ VERIFIED | 'non-pdf-content-type' (line 94), 'extraction-failed' (lines 69, 85, 106), 'image-only-pdf' (line 118) |
| 15 | CV text truncated to 8000 characters via MAX_CV_CHARS | ✓ VERIFIED | `const MAX_CV_CHARS = 8000` at line 16; `rawText.slice(0, MAX_CV_CHARS)` at line 122 of extract-cv.ts |
| 16 | src/index.ts imports buildCandidateContext and calls it for pass candidates | ✓ VERIFIED | Import at lines 13-14; `await buildCandidateContext(client, detail, result)` at line 102 |
| 17 | needsReview counter declared, incremented, and included in summary line | ✓ VERIFIED | `let needsReview = 0` (line 72); `needsReview++` (line 113); summary at line 159: `needsReview=${needsReview}` |
| 18 | index.ts captures stageMap from validateStages(); no duplicate /applicant_tracking/statuses API call | ✓ VERIFIED | Line 47: `const stageMap = await client.validateStages(config)`; grep returns 0 occurrences of `applicant_tracking/statuses` in index.ts |
| 19 | configSchema stages object has intake: z.string().min(1) field | ✓ VERIFIED | Line 37 of src/config/schema.ts: `intake: z.string().min(1)` inside stages z.object() |
| 20 | config.yaml stages block has intake: 'New' entry | ✓ VERIFIED | Line 9 of config.yaml: `intake: "New"` |
| 21 | hasPlaceholders uses fieldMapValues.length === 0 \|\| fieldMapValues.some(...) | ✓ VERIFIED | Lines 76-77 of index.ts: vacuous-true bug fixed |
| 22 | End-to-end: running script with a valid PDF candidate logs outcome='pass' with extracted CV text | ? UNCERTAIN | Code path is correct and complete; live BambooHR run required to confirm Assumption A1 (resumeFileId field name) and the documents list URL field name (Assumption A2 updated — direct path confirmed wrong in UAT Run 2; two-step approach is the fix, but URL field name in document objects is still unconfirmed without live credentials) |

**Score:** 21/22 truths verified (1 uncertain requiring human verification)

### Deferred Items

None — all Phase 2 items are implemented. SC1's human verification requirement is about confirming live-run behavior against undocumented BambooHR assumptions, not a deferred implementation.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/pipeline/types.ts` | CandidateContext + NeedsReviewReason | ✓ VERIFIED | 49 lines, substantive, exports both types with correct shapes |
| `src/rules/types.ts` | Extended CandidateDecision.outcome | ✓ VERIFIED | 'needsReview' added to outcome union (D-07) |
| `package.json` | pdf-parse@1.1.4 pinned | ✓ VERIFIED | Exact pin `"1.1.4"` (no caret), @types/pdf-parse in devDependencies |
| `src/bamboohr/client.ts` | getApplicationDocuments() + two-step downloadPdf(); validateStages() returning Map | ✓ VERIFIED | getApplicationDocuments() at line 110; downloadPdf() two-step at lines 128-275; validateStages returns Map<string, number>; candidatePaths fully removed |
| `src/pipeline/extract-cv.ts` | buildCandidateContext() with runtime fileId validation; 3-arg downloadPdf call; updated comment block | ✓ VERIFIED | 154 lines; Number.isInteger validation; no `as number` cast; downloadPdf(applicationId, applicantId, resumeFileId) at line 81; GAP-02 comment at line 73 |
| `src/index.ts` | stageMap wiring, fixed hasPlaceholders, safe PII log, PDF pipeline wired | ✓ VERIFIED | stageMap captured; no duplicate statuses call; fieldMapValues.some() fix; no JSON.stringify(detail) |
| `src/config/schema.ts` | intake field in stages Zod schema | ✓ VERIFIED | `intake: z.string().min(1)` at line 37 |
| `config.yaml` | intake stage value | ✓ VERIFIED | `intake: "New"` at line 9 |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| src/pipeline/types.ts | src/rules/types.ts | `import type { RuleResult } from '../rules/types.js'` | ✓ WIRED | Line 9 of types.ts |
| src/pipeline/extract-cv.ts | src/pipeline/types.ts | `import type { CandidateContext, NeedsReviewReason } from './types.js'` | ✓ WIRED | Line 13 of extract-cv.ts |
| src/bamboohr/client.ts downloadPdf() | getApplicationDocuments() | `docsRaw = await this.getApplicationDocuments(applicationId)` | ✓ WIRED | Line 136 of client.ts — Step 1 of two-step download |
| src/pipeline/extract-cv.ts | src/bamboohr/client.ts downloadPdf() | `client.downloadPdf(applicationId, applicantId, resumeFileId)` | ✓ WIRED | Line 81 of extract-cv.ts — 3-argument call, signature unchanged |
| src/index.ts pass branch | src/pipeline/extract-cv.ts buildCandidateContext() | `await buildCandidateContext(client, detail, result)` | ✓ WIRED | Line 102 of index.ts |
| src/index.ts | client.validateStages() | `const stageMap = await client.validateStages(config)` | ✓ WIRED | Line 47 of index.ts; return value captured |
| src/index.ts | config.job.stages.intake | `stageMap.get(intakeStageName)` where `intakeStageName = config.job.stages.intake` | ✓ WIRED | Lines 52-53 of index.ts |
| src/index.ts summary | needsReview counter | template string in console.error | ✓ WIRED | Line 159: `needsReview=${needsReview}` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| src/pipeline/extract-cv.ts | cvText | `pdfParse(buffer).text.slice(0, MAX_CV_CHARS)` | Yes — from real PDF binary buffer obtained via BambooHR documents list API + binary fetch | ✓ FLOWING (code path correct; live endpoint confirmation is human verification item) |
| src/bamboohr/client.ts | buffer / contentType | `fetch(absoluteUrl)` where absoluteUrl is extracted from documents list response | Yes — binary content from BambooHR storage URL returned by documents API | ✓ FLOWING (URL extraction defensive; shape-discovery logs on failure) |
| src/index.ts | CandidateContext | `buildCandidateContext(client, detail, result)` | Yes — flows from real BambooHR application detail through documents list → binary download → PDF parse → CandidateContext | ✓ FLOWING |
| src/index.ts | stageMap / intakeId | `validateStages(config)` returns Map populated from `/applicant_tracking/statuses` API | Yes — populated from live API response, no static values | ✓ FLOWING |
| logDecision (pass branch) | reasons[] | Placeholder string, NOT cvText | N/A — cvText intentionally excluded from logs (GDPR; T-02-04-01) | ✓ CORRECT by design |

Note: cvText is not logged in JSON output — it is held in memory for Phase 3 agent evaluation. This is intentional design, not a stub.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| pdf-parse@1.1.4 module loads | `node -e "require('pdf-parse'); console.log('ok')"` | `ok` | ✓ PASS |
| tsc --noEmit exits 0 | `npx tsc --noEmit` | exit code 0, no output | ✓ PASS |
| candidatePaths fully removed | `grep -c "candidatePaths" src/bamboohr/client.ts` | `0` | ✓ PASS |
| getApplicationDocuments defined and called | `grep -c "getApplicationDocuments" src/bamboohr/client.ts` | `3` (definition + call in downloadPdf + Step 1 comment) | ✓ PASS |
| extractUrl helper present | `grep -c "extractUrl" src/bamboohr/client.ts` | `4` (definition + call sites) | ✓ PASS |
| matchesFileId helper present | `grep -c "matchesFileId" src/bamboohr/client.ts` | `2` (definition + call site) | ✓ PASS |
| Shape-discovery log on failure | `grep -c "JSON.stringify(docsRaw)" src/bamboohr/client.ts` | `2` (docs.length===0 path + no-URL path) | ✓ PASS |
| Unsafe fileId cast eliminated | `grep -c "rawFileId as number" src/pipeline/extract-cv.ts` | `0` | ✓ PASS |
| PII log removed from index.ts | `grep -c 'JSON.stringify(detail, null, 2)' src/index.ts` | `0` | ✓ PASS |
| Duplicate statuses API call removed | `grep -c "applicant_tracking/statuses" src/index.ts` | `0` | ✓ PASS |
| GAP-02 comment in extract-cv.ts | `grep -c "GAP-02" src/pipeline/extract-cv.ts` | `1` | ✓ PASS |
| End-to-end live run with BambooHR | Requires live credentials + real candidates | Cannot test without external service | ? SKIP (human verification) |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| BAMB-04 | 02-02, 02-04, 02-05, 02-07 | Downloads candidate CV as a PDF buffer from BambooHR attachment URL | ✓ SATISFIED | `downloadPdf()` in client.ts: two-step approach — getApplicationDocuments() fetches documents list, binary fetch uses URL from document object; wired from extract-cv.ts line 81 |
| PDF-01 | 02-03, 02-04 | Validates Content-Type: application/pdf; extracts plain text with pdf-parse | ✓ SATISFIED | `contentType.includes('application/pdf')` check (line 90); `pdfParse(buffer)` call (line 101) in extract-cv.ts |
| PDF-02 | 02-03, 02-04 | Truncates extracted CV text to max ~8000 characters | ✓ SATISFIED | `MAX_CV_CHARS = 8000`; `rawText.slice(0, MAX_CV_CHARS)` at line 122 of extract-cv.ts |
| RULE-03 | 02-01, 02-03, 02-04 | Produces "Needs Human Review" outcome for unextractable CVs | ✓ SATISFIED | All 3 NeedsReviewReason paths implemented; needsReview outcome wired in index.ts; CandidateDecision.outcome includes 'needsReview' |

All 4 Phase 2 requirements are satisfied by the implementation.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| src/index.ts | 125 | `reasons: ['CV extracted; pending Phase 3 agent evaluation']` | ℹ️ Info | Intentional placeholder — pass branch logs a stub reason string until Phase 3 adds real agent evaluation. Documented behavior; does NOT prevent Phase 2 goal achievement. |

No blocker or warning-level anti-patterns found. The placeholder pass reason is explicitly documented and is the correct Phase 2 behavior (Phase 3 will replace it with GPT-4o evaluation results).

Gap-closure plans 02-05, 02-06, and 02-07 resolved all identified issues:

- CR-01: Double /v1 in fallback path — FIXED (path approach removed entirely by plan 07)
- CR-02: Wrong entity ID (applicationId vs applicantId) in employee-files path — FIXED (employee-files path removed entirely by plan 07)
- CR-03: Hardcoded "New" stage, missing intake config — FIXED
- CR-04: Unsafe fileId cast — FIXED
- WR-01: Vacuous-true hasPlaceholders — FIXED
- WR-02: PII log (JSON.stringify(detail)) — FIXED
- WR-03: Duplicate statuses API call + discarded validateStages return — FIXED
- GAP-02: PDF download 404 (candidatePaths both return 404) — FIXED via two-step documents list approach

### Human Verification Required

#### 1. Valid PDF Candidate End-to-End (SC1)

**Test:** Run `DRY_RUN=true npx tsx src/index.ts` with real BambooHR credentials pointing to a job opening with at least one candidate who has a PDF resume attachment.

**Expected:**
- Script logs a stdout JSON line like: `{"candidateId":N,"applicationId":N,"outcome":"pass","reasons":["CV extracted; pending Phase 3 agent evaluation"],"timestamp":"..."}`
- No crash from downloadPdf() — confirming that the documents list returns a document with a usable URL field, and that the binary download from that URL succeeds
- outcome is 'pass' rather than 'needsReview', confirming Assumption A1 (resumeFileId field name) is correct and the documents list URL field is one of the 8 tried by extractUrl

**Why human:** Requires live BAMBOOHR_API_KEY, BAMBOOHR_SUBDOMAIN, and a real candidate with a PDF attachment. The BambooHR documents list URL field name (e.g. 'url', 'downloadUrl', 'original') is undocumented and must be confirmed against the live API. On first failure, stderr will log the full document shapes to aid discovery.

#### 2. Non-PDF Attachment Candidate (SC2)

**Test:** Run with a BambooHR candidate whose resume attachment is a .docx or .png file (not a PDF).

**Expected:** stdout contains `{"outcome":"needsReview","reasons":["non-pdf-content-type"],...}` with no pdf-parse call attempted.

**Why human:** Requires a candidate with a non-PDF attachment. The Content-Type header returned by BambooHR for non-PDF files is an assumption that must be confirmed against the live API.

#### 3. Image-Only PDF Candidate (SC3)

**Test:** Run with a BambooHR candidate who uploaded a scanned/image-only PDF resume (large file, no selectable text).

**Expected:** stdout contains `{"outcome":"needsReview","reasons":["image-only-pdf"],...}` — confirmed by wordCount < 50 AND buffer.length > 50KB both being true.

**Why human:** Requires a real scanned PDF candidate. The dual-threshold heuristic (wordCount < IMAGE_ONLY_WORD_THRESHOLD && buffer.length > IMAGE_ONLY_SIZE_THRESHOLD) is code-correct but must be confirmed against real BambooHR PDF files.

### Gaps Summary

No implementation gaps found. All Phase 2 code is substantive, wired, and data-flowing. All issues identified through code review and UAT were resolved by gap-closure plans 02-05, 02-06, and 02-07. The 3 human verification items are behavioral end-to-end tests that require a live BambooHR environment — they are not code deficiencies.

The single UNCERTAIN truth (end-to-end live run) is uncertain because:
1. The BambooHR documents list URL field name is undocumented — extractUrl tries 8 field names defensively, but the actual field used by BambooHR requires live confirmation
2. The `resumeFileId` field name on the application detail object (Assumption A1) requires live confirmation

Both are structural limitations of BambooHR's incomplete public documentation, not implementation gaps. The code has comprehensive failure logging (stderr logs raw document shapes on any failure path) that will surface the correct field name on the first DRY_RUN.

Plan 07 replaced the fragile path-construction approach (which produced 404s in UAT Run 2) with the correct two-step documents list approach — `getApplicationDocuments()` fetches the list, `extractUrl` defensively tries 8 possible URL field names, `matchesFileId` prefers the document matching `resumeFileId` but falls back to the first document with any URL. This is the most robust approach possible without live BambooHR credentials to confirm the exact response shape.

---

_Verified: 2026-05-01T22:15:00Z_
_Verifier: Claude (gsd-verifier)_
