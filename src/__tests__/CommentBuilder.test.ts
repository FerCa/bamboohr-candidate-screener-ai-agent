// src/__tests__/CommentBuilder.test.ts
// Lock down comment formatting bit-for-bit. Plan 04 will rely on these strings
// being identical to the current src/index.ts inline templates.
import { describe, it, expect } from 'vitest';
import { CommentBuilder } from '../pipeline/comment-builder.js';
import type { EvaluationResult } from '../agent/types.js';
import type { NeedsReviewReason } from '../pipeline/types.js';

describe('CommentBuilder.needsReview', () => {
  const reasons: NeedsReviewReason[] = [
    'non-pdf-content-type',
    'extraction-failed',
    'image-only-pdf',
  ];

  for (const reason of reasons) {
    it(`produces a 3-paragraph string for reason="${reason}"`, () => {
      const out = CommentBuilder.needsReview(reason);
      // Three paragraphs separated by exactly two newlines
      const paragraphs = out.split('\n\n');
      expect(paragraphs).toHaveLength(3);
      expect(paragraphs[0]).toBe('NEEDS REVIEW — Automated screening incomplete');
      expect(paragraphs[1]).toBe(reason);
      expect(paragraphs[2]).toBe(
        '[Auto-screened by AI — final decision rests with recruiter]',
      );
    });
  }

  it('matches the verbatim template from src/index.ts (regression lock)', () => {
    const reason: NeedsReviewReason = 'non-pdf-content-type';
    // Reproduce the exact src/index.ts:126-130 template here
    const expected = [
      'NEEDS REVIEW — Automated screening incomplete',
      reason,
      '[Auto-screened by AI — final decision rests with recruiter]',
    ].join('\n\n');
    expect(CommentBuilder.needsReview(reason)).toBe(expected);
  });
});

describe('CommentBuilder.hardRuleFail', () => {
  it('produces 3 paragraphs with bullet list for two reasons', () => {
    const out = CommentBuilder.hardRuleFail([
      'Salary above ceiling',
      'Missing right-to-work',
    ]);
    const paragraphs = out.split('\n\n');
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]).toBe('FAIL — Hard rules');
    expect(paragraphs[1]).toBe('• Salary above ceiling\n• Missing right-to-work');
    expect(paragraphs[2]).toBe(
      '[Auto-screened by AI — final decision rests with recruiter]',
    );
  });

  it('produces 3 paragraphs even when reasons array is empty', () => {
    const out = CommentBuilder.hardRuleFail([]);
    const paragraphs = out.split('\n\n');
    expect(paragraphs).toHaveLength(3);
    expect(paragraphs[0]).toBe('FAIL — Hard rules');
    expect(paragraphs[1]).toBe(''); // empty bullet list
    expect(paragraphs[2]).toBe(
      '[Auto-screened by AI — final decision rests with recruiter]',
    );
  });

  it('matches the verbatim template from src/index.ts (regression lock)', () => {
    const reasons = ['Reason A', 'Reason B'];
    const expected = [
      'FAIL — Hard rules',
      reasons.map((r) => `• ${r}`).join('\n'),
      '[Auto-screened by AI — final decision rests with recruiter]',
    ].join('\n\n');
    expect(CommentBuilder.hardRuleFail(reasons)).toBe(expected);
  });
});

describe('CommentBuilder.softEval', () => {
  it('returns result.comment verbatim — no transformation', () => {
    const result: EvaluationResult = {
      applicationId: 1,
      applicantId: 2,
      outcome: 'pass',
      required: [],
      optional: [],
      comment: 'GPT-formatted recruiter comment with bullets and headers',
      timestamp: '2026-05-03T00:00:00Z',
    };
    expect(CommentBuilder.softEval(result)).toBe(
      'GPT-formatted recruiter comment with bullets and headers',
    );
  });

  it('preserves multi-line GPT output exactly', () => {
    const result: EvaluationResult = {
      applicationId: 99,
      applicantId: 100,
      outcome: 'fail',
      required: [],
      optional: [],
      comment: 'Line 1\n\nLine 2\n• bullet',
      timestamp: '2026-05-03T00:00:00Z',
    };
    expect(CommentBuilder.softEval(result)).toBe('Line 1\n\nLine 2\n• bullet');
  });
});
