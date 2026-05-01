---
status: partial
phase: 02-pdf-pipeline
source: [02-VERIFICATION.md]
started: 2026-05-01T21:00:00Z
updated: 2026-05-01T22:30:00Z
---

## Current Test

Ran 2026-05-01 with live credentials: N candidates processed.

## Tests

### 1. Valid PDF candidate end-to-end (SC1)
expected: Script logs outcome='pass' with reasons=['CV extracted; pending Phase 3 agent evaluation'] and CandidateContext.cvText is populated with truncated (<=8000 char) text extracted from the PDF. Also confirms resumeFileId field name assumption (A1) and download endpoint assumption (A2).
result: FAILED — resumeFileId field found correctly (A1 ✓), but download endpoint 404 on all 6 candidates. Both candidate paths fail: /applicant_tracking/applications/{id}/documents/{fileId} and /v1/employees/{id}/files/{fileId}.

### 2. Non-PDF attachment candidate (SC2)
expected: Script logs outcome='needsReview' with reasons=['non-pdf-content-type'] when candidate has a .docx or similar non-PDF attachment. pdf-parse is NOT called.
result: BLOCKED — blocked by GAP-01 (PDF endpoint unknown). Cannot reach content-type validation.

### 3. Image-only scanned PDF candidate (SC3)
expected: Script logs outcome='needsReview' with reasons=['image-only-pdf'] for a candidate who uploaded a real scanned PDF (large file size, no extractable text). Dual-condition heuristic confirmed: wordCount < 50 AND buffer.length > 50KB.
result: BLOCKED — blocked by GAP-01 (PDF endpoint unknown).

## Summary

total: 3
passed: 0
issues: 1
pending: 0
skipped: 0
blocked: 2

## Gaps

### GAP-01: PDF download endpoint returns 404
status: resolved
description: Both candidate paths in downloadPdf() return 404. Primary path /applicant_tracking/applications/{applicationId}/documents/{fileId} not found. Fallback path has double /v1/ bug (CR-01) and wrong entity ID (CR-02). Correct BambooHR ATS attachment endpoint is unknown.
resolved_by: 02-05 (fixed CR-01 double-/v1, CR-02 applicantId in fallback path)
blocks: SC1, SC2, SC3
