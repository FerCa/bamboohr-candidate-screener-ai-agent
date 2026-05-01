// src/pipeline/extract-cv.ts
// CV extraction and CandidateContext assembly for the Phase 2 PDF pipeline.
// buildCandidateContext() is the orchestrator: download → validate → extract → truncate → assemble.
// D-05, D-06: Image-only detection thresholds are hardcoded (not configurable).
// D-02: applicationAnswers is raw pass-through from BambooHR — no normalization.
// D-03: cvText is null when needsReviewReason !== null.
// SAFE-01: recoverable failures return CandidateContext with needsReviewReason set; never throw.
// Only unrecoverable failures (network timeout, auth error) propagate as throws.
import pdfParse from 'pdf-parse';
import type { BambooHRClient } from '../bamboohr/client.js';
import type { BambooHRApplication } from '../bamboohr/types.js';
import type { RuleResult } from '../rules/types.js';
import type { CandidateContext, NeedsReviewReason } from './types.js';

/** PDF-02: Maximum CV text length in characters before sending to GPT-4o. */
const MAX_CV_CHARS = 8000;

/** D-05, D-06: Image-only detection — BOTH conditions must be true. Hardcoded. */
const IMAGE_ONLY_WORD_THRESHOLD = 50;
const IMAGE_ONLY_SIZE_THRESHOLD = 50 * 1024; // 50 KB in bytes

/**
 * Build the typed CandidateContext for a candidate that passed hard rules.
 *
 * Recoverable failures set needsReviewReason and return — never throw.
 * Unrecoverable failures (network, auth) propagate as throws to index.ts outer catch.
 *
 * ASSUMPTION A1: The resume file ID field is named 'resumeFileId' (camelCase) on the detail object.
 * ASSUMPTION A5: Application answers live at detail['questionsAndAnswers'].
 * Both assumptions are logged on first DRY_RUN so the developer can verify field names.
 */
export async function buildCandidateContext(
  client: BambooHRClient,
  detail: BambooHRApplication,
  hardRuleResult: RuleResult,
): Promise<CandidateContext> {
  const applicationId = detail.id;
  const applicantId = detail.applicant.id;

  // D-02: Raw pass-through — no normalization of application answers.
  // ASSUMPTION A5: field is 'questionsAndAnswers'. Log Object.keys if absent.
  const rawAnswers = detail['questionsAndAnswers'];
  if (rawAnswers === undefined) {
    console.error(
      `[extract-cv] 'questionsAndAnswers' not found on applicationId=${applicationId}. ` +
      `Available keys: ${Object.keys(detail).filter((k) => k !== 'applicant').join(', ')} ` +
      `— update field reference if BambooHR uses a different key.`,
    );
  }
  const applicationAnswers = (rawAnswers ?? {}) as Record<string, unknown>;

  // --- Step 1: Discover and validate the resume file ID ---
  // ASSUMPTION A1: field is 'resumeFileId' (camelCase). Discovery guard logs keys if absent.
  const rawFileId = detail['resumeFileId'];
  if (rawFileId === undefined || rawFileId === null || rawFileId === 0) {
    console.error(
      `[extract-cv] Resume file ID not found at detail['resumeFileId'] for applicationId=${applicationId}. ` +
      `Value: ${JSON.stringify(rawFileId)}. ` +
      `Top-level keys on application detail: ${Object.keys(detail).join(', ')} ` +
      `— if BambooHR uses a different field name (e.g. 'resume_file_id', 'attachments[0].id'), ` +
      `update this file accordingly after the first DRY_RUN.`,
    );
    return makeNeedsReview(applicationId, applicantId, hardRuleResult, applicationAnswers, 'extraction-failed');
  }

  const resumeFileId = rawFileId as number;

  // --- Step 2: Download PDF binary (BAMB-04) ---
  // downloadPdf() throws for network/auth errors — those propagate to outer catch (SAFE-01).
  // downloadPdf() throws for 404 after trying all candidate paths — also propagate.
  // We treat download errors as recoverable needsReview here via inner try/catch.
  let buffer: Buffer;
  let contentType: string;
  try {
    ({ buffer, contentType } = await client.downloadPdf(applicationId, resumeFileId));
  } catch (downloadErr) {
    const message = downloadErr instanceof Error ? downloadErr.message : String(downloadErr);
    console.error(`[extract-cv] PDF download failed for applicationId=${applicationId}: ${message}`);
    return makeNeedsReview(applicationId, applicantId, hardRuleResult, applicationAnswers, 'extraction-failed');
  }

  // --- Step 3: Validate Content-Type (PDF-01) ---
  // Use includes() not === to handle 'application/pdf; charset=utf-8' variants.
  if (!contentType.includes('application/pdf')) {
    console.error(
      `[extract-cv] Non-PDF content-type for applicationId=${applicationId}: "${contentType}"`,
    );
    return makeNeedsReview(applicationId, applicantId, hardRuleResult, applicationAnswers, 'non-pdf-content-type');
  }

  // --- Step 4: Extract text with pdf-parse v1 (PDF-01) ---
  // pdf-parse throws on encrypted, corrupt, or unreadable PDFs.
  let rawText: string;
  try {
    const parsed = await pdfParse(buffer);
    rawText = parsed.text;
  } catch (parseErr) {
    const message = parseErr instanceof Error ? parseErr.message : String(parseErr);
    console.error(`[extract-cv] pdf-parse failed for applicationId=${applicationId}: ${message}`);
    return makeNeedsReview(applicationId, applicantId, hardRuleResult, applicationAnswers, 'extraction-failed');
  }

  // --- Step 5: Image-only heuristic (D-05, D-06) ---
  // Both conditions required: word count AND file size. Either alone is insufficient.
  const wordCount = rawText.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount < IMAGE_ONLY_WORD_THRESHOLD && buffer.length > IMAGE_ONLY_SIZE_THRESHOLD) {
    console.error(
      `[extract-cv] Image-only PDF detected for applicationId=${applicationId}: ` +
      `wordCount=${wordCount} (threshold: <${IMAGE_ONLY_WORD_THRESHOLD}), ` +
      `fileSize=${buffer.length} bytes (threshold: >${IMAGE_ONLY_SIZE_THRESHOLD})`,
    );
    return makeNeedsReview(applicationId, applicantId, hardRuleResult, applicationAnswers, 'image-only-pdf');
  }

  // --- Step 6: Truncate to safe size (PDF-02) ---
  const cvText = rawText.slice(0, MAX_CV_CHARS);

  return {
    applicationId,
    applicantId,
    hardRuleResult,
    cvText,
    needsReviewReason: null,
    applicationAnswers,
  };
}

/**
 * Construct a CandidateContext for a candidate that cannot be auto-screened.
 * cvText is null per D-03. needsReviewReason is always set.
 */
function makeNeedsReview(
  applicationId: number,
  applicantId: number,
  hardRuleResult: RuleResult,
  applicationAnswers: Record<string, unknown>,
  reason: NeedsReviewReason,
): CandidateContext {
  return {
    applicationId,
    applicantId,
    hardRuleResult,
    cvText: null,
    needsReviewReason: reason,
    applicationAnswers,
  };
}
