---
status: partial
phase: 02-pdf-pipeline
source: [02-VERIFICATION.md]
started: 2026-05-01T21:00:00Z
updated: 2026-05-01T21:00:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Valid PDF candidate end-to-end (SC1)
expected: Script logs outcome='pass' with reasons=['CV extracted; pending Phase 3 agent evaluation'] and CandidateContext.cvText is populated with truncated (<=8000 char) text extracted from the PDF. Also confirms resumeFileId field name assumption (A1) and download endpoint assumption (A2).
result: [pending]

### 2. Non-PDF attachment candidate (SC2)
expected: Script logs outcome='needsReview' with reasons=['non-pdf-content-type'] when candidate has a .docx or similar non-PDF attachment. pdf-parse is NOT called.
result: [pending]

### 3. Image-only scanned PDF candidate (SC3)
expected: Script logs outcome='needsReview' with reasons=['image-only-pdf'] for a candidate who uploaded a real scanned PDF (large file size, no extractable text). Dual-condition heuristic confirmed: wordCount < 50 AND buffer.length > 50KB.
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
