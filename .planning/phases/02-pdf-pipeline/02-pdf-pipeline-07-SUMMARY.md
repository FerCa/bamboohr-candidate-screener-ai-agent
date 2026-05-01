---
phase: 02-pdf-pipeline
plan: "07"
status: complete
completed: "2026-05-01"
requirements:
  - BAMB-04
  - PDF-01
  - PDF-02
  - RULE-03
self_check: PASSED
---

# Plan 02-07 Summary: Two-Step PDF Download via Documents List API (GAP-02)

## What Was Built

Replaced the failing `candidatePaths` two-URL loop in `downloadPdf()` with a two-step
BambooHR documents list API approach. The root cause (confirmed in UAT Run 2, 2026-05-01)
was that `resumeFileId` from the application detail is not a direct download endpoint ID —
BambooHR requires first fetching the documents list for the application, then using the
document object's actual URL for the binary download.

## Files Changed

- `src/bamboohr/client.ts` — new `getApplicationDocuments()` + rewritten `downloadPdf()`
- `src/pipeline/extract-cv.ts` — comment update only (no executable changes)

## Key Decisions

### getApplicationDocuments() Method

**Endpoint:** `GET /applicant_tracking/applications/{applicationId}/documents`

Uses the existing `this.get<T>()` which already sets `Authorization` and `Accept: application/json`.
Return type is `Promise<unknown>` — response shape is undocumented by BambooHR.

### Defensive URL Extraction (extractUrl helper)

URL field names tried in order:
`url`, `downloadUrl`, `download_url`, `original`, `href`, `link`, `fileUrl`, `file_url`

### Defensive ID Matching (matchesFileId helper)

Document ID fields checked against `resumeFileId`:
`id`, `fileId`, `file_id`

### Response Shape Normalization

Handles multiple wrapper shapes BambooHR may return:
- Direct array: `[...]`
- Wrapped: `{ data: [...] }`, `{ documents: [...] }`, `{ items: [...] }`, `{ files: [...] }`
- Falls back to empty array `[]` for any other shape

### URL Resolution

If the extracted URL is absolute (`startsWith('http')`): used as-is.
If relative: prepended with `this.baseUrl` with path-separator handling.

## Logging on Failure Paths

| Condition | What is Logged |
|-----------|----------------|
| Documents list fetch fails | Error message |
| `docs.length === 0` | Raw `docsRaw` JSON (shape discovery) |
| No document matched `fileId` (fallback to first) | Warning + `fileId` + `applicationId` |
| No usable URL found in any document | First 3 document shapes + full raw response + expected field list |
| Binary download HTTP error | Status code + URL used |

## Verification Results

```
grep -c "getApplicationDocuments" src/bamboohr/client.ts  → 3 (definition + 2 call sites: downloadPdf + test)
grep -c "extractUrl" src/bamboohr/client.ts              → 4 (definition + 3 call sites)
grep -c "matchesFileId" src/bamboohr/client.ts           → 2 (definition + call site)
grep -c "candidatePaths" src/bamboohr/client.ts          → 0 (old approach fully removed)
grep -n "downloadPdf(applicationId, applicantId, resumeFileId)" src/pipeline/extract-cv.ts → 1 line (unchanged)
npx tsc --noEmit                                          → exit 0, no output
```

## Self-Check: PASSED

All must-have truths confirmed:
- [x] `getApplicationDocuments()` method exists on `BambooHRClient`
- [x] `downloadPdf()` calls `getApplicationDocuments()` before attempting binary download
- [x] `downloadPdf()` logs the documents list response shape when all download attempts fail
- [x] `downloadPdf()` falls back to `needsReview('extraction-failed')` path when no downloadable document is found (via throw caught in extract-cv.ts)
- [x] `tsc --noEmit` exits 0 after all changes
- [x] `extract-cv.ts` call site unchanged: `client.downloadPdf(applicationId, applicantId, resumeFileId)`
