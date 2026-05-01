---
status: diagnosed
phase: 02-pdf-pipeline
source: [02-VERIFICATION.md]
started: 2026-05-01T21:00:00Z
updated: 2026-05-01T23:55:00Z
---

## Current Test

Run 2 — 2026-05-01 with live credentials after gap-closure plans 02-05 and 02-06:
N candidates processed.
All 6 still result in needsReview(extraction-failed) — both download paths return 404.

## Tests

### 1. Valid PDF candidate end-to-end (SC1)
expected: Script logs outcome='pass' with reasons=['CV extracted; pending Phase 3 agent evaluation'] and CandidateContext.cvText is populated with truncated (<=8000 char) text extracted from the PDF. Also confirms resumeFileId field name assumption (A1) and download endpoint assumption (A2).
result: FAILED — resumeFileId field found correctly (A1 ✓), but both download paths 404 on all 6 candidates.
  - Path 1 (tried): /applicant_tracking/applications/{applicationId}/documents/{resumeFileId}
  - Path 2 (tried): /employees/{applicantId}/files/{resumeFileId}
  - Analysis: resumeFileId is a valid positive integer but doesn't map to either endpoint.
    Root cause: BambooHR likely requires fetching the documents list first (GET /applicant_tracking/applications/{id}/documents)
    and using the document's actual download URL or endpoint from that response — not constructing a path from resumeFileId directly.

### 2. Non-PDF attachment candidate (SC2)
expected: Script logs outcome='needsReview' with reasons=['non-pdf-content-type'] when candidate has a .docx or similar non-PDF attachment. pdf-parse is NOT called.
result: BLOCKED — blocked by GAP-02 (PDF download endpoint still unknown after CR-01/CR-02 fixes).

### 3. Image-only scanned PDF candidate (SC3)
expected: Script logs outcome='needsReview' with reasons=['image-only-pdf'] for a candidate who uploaded a real scanned PDF (large file size, no extractable text). Dual-condition heuristic confirmed: wordCount < 50 AND buffer.length > 50KB.
result: BLOCKED — blocked by GAP-02 (PDF download endpoint still unknown after CR-01/CR-02 fixes).

## Summary

total: 3
passed: 0
issues: 1
pending: 0
skipped: 0
blocked: 2

## Gaps

### GAP-01: PDF download endpoint — double /v1 and wrong entity ID
status: resolved
description: Fallback path had double /v1/ prefix (CR-01) and used applicationId instead of applicantId (CR-02). Both structural bugs fixed in plan 02-05.
resolved_by: 02-05

### GAP-02: PDF download still 404 after structural fixes — documents list API needed
status: resolved
resolved_by: 02-07
description: Both structurally-correct paths still return 404 for all 6 candidates passing hard rules.
  Attempted: /applicant_tracking/applications/{applicationId}/documents/{resumeFileId}
  Attempted: /employees/{applicantId}/files/{resumeFileId}
  Root cause: resumeFileId from application detail is not a direct download ID recognized by either endpoint.
  Resolution (plan 02-07): Two-step approach implemented — first fetches document list via
    GET /applicant_tracking/applications/{applicationId}/documents, then extracts actual
    download URL from the document object (tries url/downloadUrl/download_url/original/href/link/fileUrl/file_url).
    Full response logged to stderr on all failure paths for shape discovery.
blocks: SC1, SC2, SC3
