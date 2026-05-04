// src/__tests__/CandidateProcessor.test.ts
// Integration-level tests for CandidateProcessor with mocked dependencies (D-11).
// Covers all five outcome paths (Paths A–E from the plan behavior contract) plus the
// dry-run invariant (no live writes, no OpenAI calls).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CandidateProcessor } from '../pipeline/candidate-processor.js';
import { LiveModeWriter } from '../pipeline/live-mode-writer.js';
import type { IBambooHRClient } from '../interfaces/IBambooHRClient.js';
import type { ISoftEvaluator } from '../interfaces/ISoftEvaluator.js';
import type { ILogger } from '../interfaces/ILogger.js';
import type { JobConfig } from '../config/schema.js';
import type { BambooHRApplication } from '../bamboohr/types.js';
import type { EvaluationResult } from '../agent/types.js';
import type { CandidateContext } from '../pipeline/types.js';

// Module-level mock for buildCandidateContext so we don't need a real PDF
vi.mock('../pipeline/extract-cv.js', () => ({
  buildCandidateContext: vi.fn(),
}));

/**
 * Build a default JobConfig (per-job slice) for tests.
 */
function makeConfig(): JobConfig {
  return {
    openingId: 'job-1',
    stages: { intake: 'New', pass: 'Schedule Phone Screen', fail: 'Reviewed' },
    hardRules: {
      maxSalary: { value: 100000, label: 'Salary above ceiling' },
    },
    fieldMap: { salary: 'desiredSalary', resume: 'resumeFileId' },
    softRules: {
      required: [{ label: 'Years of experience', description: '5+ years' }],
      optional: [],
    },
  };
}

function makeApplication(extra: Partial<BambooHRApplication> = {}): BambooHRApplication {
  return {
    id: 1,
    applicant: { id: 100, firstName: 'Test', lastName: 'User', email: 't@u.com' },
    status: { id: 1, label: 'New' },
    desiredSalary: 50000,
    resumeFileId: 999,
    questionsAndAnswers: {},
    ...extra,
  } as BambooHRApplication;
}

function makeStageMap(): Map<string, number> {
  return new Map([
    ['New', 1],
    ['Schedule Phone Screen', 2],
    ['Reviewed', 3],
  ]);
}

/** Build a default IBambooHRClient mock with all 7 methods stubbed. */
function makeBambooMock(): IBambooHRClient {
  return {
    get: vi.fn(),
    postComment: vi.fn().mockResolvedValue(undefined),
    moveStage: vi.fn().mockResolvedValue(undefined),
    validateStages: vi.fn().mockResolvedValue(makeStageMap()),
    fetchApplicationDetails: vi.fn(),
    downloadPdf: vi.fn(),
    fetchCandidates: vi.fn(),
  } as unknown as IBambooHRClient;
}

function makeSoftEvalMock(result: Partial<EvaluationResult> = {}): ISoftEvaluator {
  const defaultResult: EvaluationResult = {
    applicationId: 1,
    applicantId: 100,
    outcome: 'pass',
    required: [],
    optional: [],
    comment: 'GPT-formatted comment',
    timestamp: '2026-05-03T00:00:00Z',
    ...result,
  };
  return { evaluate: vi.fn().mockResolvedValue(defaultResult) };
}

function makeLoggerMock(): ILogger {
  return { logDecision: vi.fn(), logEvaluation: vi.fn() };
}

function makeSuccessfulCandidateContext(app: BambooHRApplication): CandidateContext {
  return {
    applicationId: app.id,
    applicantId: app.applicant.id,
    hardRuleResult: { outcome: 'pass', reasons: [] },
    cvText: 'extracted text',
    needsReviewReason: null,
    applicationAnswers: {},
  };
}

describe('CandidateProcessor — Path A: hard-rule pass + soft-eval pass', () => {
  it('returns "pass" when soft-eval outcome is pass (live mode + writes happen)', async () => {
    const bambooHrClient = makeBambooMock();
    const softEvaluator = makeSoftEvalMock({ outcome: 'pass' });
    const logger = makeLoggerMock();
    const config = makeConfig();
    const liveWriter = new LiveModeWriter(bambooHrClient);

    const app = makeApplication();
    (bambooHrClient.fetchApplicationDetails as ReturnType<typeof vi.fn>).mockResolvedValue(app);

    // Set up buildCandidateContext mock to return successful context
    const { buildCandidateContext } = await import('../pipeline/extract-cv.js');
    (buildCandidateContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSuccessfulCandidateContext(app),
    );

    const processor = new CandidateProcessor(
      bambooHrClient, softEvaluator, logger, liveWriter, config, false /* dryRun */,
    );
    const outcome = await processor.process(app, makeStageMap());
    expect(outcome).toBe('pass');
    expect(logger.logEvaluation).toHaveBeenCalledTimes(1);
    // Live writes invoked with PASS stage
    expect(bambooHrClient.postComment).toHaveBeenCalledTimes(1);
    expect(bambooHrClient.moveStage).toHaveBeenCalledWith(app.id, 2 /* Schedule Phone Screen */);
  });
});

describe('CandidateProcessor — Path E: hard-rule fail', () => {
  it('returns "fail", logs decision, never invokes soft-eval, writes to fail stage in live mode', async () => {
    const bambooHrClient = makeBambooMock();
    const softEvaluator = makeSoftEvalMock();
    const logger = makeLoggerMock();
    const config = makeConfig();
    const liveWriter = new LiveModeWriter(bambooHrClient);

    // Application that fails maxSalary
    const app = makeApplication({ desiredSalary: 999999 } as Partial<BambooHRApplication>);
    (bambooHrClient.fetchApplicationDetails as ReturnType<typeof vi.fn>).mockResolvedValue(app);

    const processor = new CandidateProcessor(
      bambooHrClient, softEvaluator, logger, liveWriter, config, false,
    );
    const outcome = await processor.process(app, makeStageMap());
    expect(outcome).toBe('fail');
    expect(logger.logDecision).toHaveBeenCalledTimes(1);
    expect(softEvaluator.evaluate).not.toHaveBeenCalled();
    expect(bambooHrClient.postComment).toHaveBeenCalledTimes(1);
    expect(bambooHrClient.moveStage).toHaveBeenCalledWith(app.id, 3 /* Reviewed */);
    // Comment must contain hard-rule fail header
    const commentArg = (bambooHrClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(commentArg).toContain('FAIL — Hard rules');
  });

  it('writes nothing in dry-run mode but still logs and returns "fail"', async () => {
    const bambooHrClient = makeBambooMock();
    const softEvaluator = makeSoftEvalMock();
    const logger = makeLoggerMock();
    const config = makeConfig();
    const liveWriter = new LiveModeWriter(bambooHrClient);

    const app = makeApplication({ desiredSalary: 999999 } as Partial<BambooHRApplication>);
    (bambooHrClient.fetchApplicationDetails as ReturnType<typeof vi.fn>).mockResolvedValue(app);

    const processor = new CandidateProcessor(
      bambooHrClient, softEvaluator, logger, liveWriter, config, true /* dryRun */,
    );
    const outcome = await processor.process(app, makeStageMap());
    expect(outcome).toBe('fail');
    expect(logger.logDecision).toHaveBeenCalledTimes(1);
    expect(bambooHrClient.postComment).not.toHaveBeenCalled();
    expect(bambooHrClient.moveStage).not.toHaveBeenCalled();
  });
});

describe('CandidateProcessor — Path D: CV needsReview (extraction failed)', () => {
  it('returns "needsReview", skips soft-eval, writes to fail stage with NEEDS REVIEW comment', async () => {
    const bambooHrClient = makeBambooMock();
    const softEvaluator = makeSoftEvalMock();
    const logger = makeLoggerMock();
    const config = makeConfig();
    const liveWriter = new LiveModeWriter(bambooHrClient);

    const app = makeApplication();
    (bambooHrClient.fetchApplicationDetails as ReturnType<typeof vi.fn>).mockResolvedValue(app);

    // Force CV path to needsReview by returning needsReviewReason from mock
    const { buildCandidateContext } = await import('../pipeline/extract-cv.js');
    (buildCandidateContext as ReturnType<typeof vi.fn>).mockResolvedValue({
      applicationId: app.id,
      applicantId: app.applicant.id,
      hardRuleResult: { outcome: 'pass', reasons: [] },
      cvText: null,
      needsReviewReason: 'extraction-failed',
      applicationAnswers: {},
    } satisfies CandidateContext);

    const processor = new CandidateProcessor(
      bambooHrClient, softEvaluator, logger, liveWriter, config, false,
    );
    const outcome = await processor.process(app, makeStageMap());
    expect(outcome).toBe('needsReview');
    expect(softEvaluator.evaluate).not.toHaveBeenCalled();
    expect(logger.logDecision).toHaveBeenCalledTimes(1);
    expect(bambooHrClient.postComment).toHaveBeenCalledTimes(1);
    const commentArg = (bambooHrClient.postComment as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(commentArg).toContain('NEEDS REVIEW — Automated screening incomplete');
    expect(bambooHrClient.moveStage).toHaveBeenCalledWith(app.id, 3 /* Reviewed */);
  });
});

describe('CandidateProcessor — Paths B/C: soft-eval fail / soft-eval needsReview', () => {
  beforeEach(async () => {
    // Reset mock to successful context for these tests
    const { buildCandidateContext } = await import('../pipeline/extract-cv.js');
    (buildCandidateContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSuccessfulCandidateContext(makeApplication()),
    );
  });

  it('returns "fail" and writes to fail stage when soft-eval outcome is fail', async () => {
    const bambooHrClient = makeBambooMock();
    const softEvaluator = makeSoftEvalMock({ outcome: 'fail', comment: 'GPT fail comment' });
    const logger = makeLoggerMock();
    const config = makeConfig();
    const liveWriter = new LiveModeWriter(bambooHrClient);

    const app = makeApplication();
    (bambooHrClient.fetchApplicationDetails as ReturnType<typeof vi.fn>).mockResolvedValue(app);

    const processor = new CandidateProcessor(
      bambooHrClient, softEvaluator, logger, liveWriter, config, false,
    );
    const outcome = await processor.process(app, makeStageMap());
    expect(outcome).toBe('fail');
    expect(bambooHrClient.moveStage).toHaveBeenCalledWith(app.id, 3 /* Reviewed */);
  });

  it('returns "needsReview" and writes to fail stage when soft-eval outcome is needsReview', async () => {
    const bambooHrClient = makeBambooMock();
    const softEvaluator = makeSoftEvalMock({ outcome: 'needsReview', comment: 'review me' });
    const logger = makeLoggerMock();
    const config = makeConfig();
    const liveWriter = new LiveModeWriter(bambooHrClient);

    const app = makeApplication();
    (bambooHrClient.fetchApplicationDetails as ReturnType<typeof vi.fn>).mockResolvedValue(app);

    const processor = new CandidateProcessor(
      bambooHrClient, softEvaluator, logger, liveWriter, config, false,
    );
    const outcome = await processor.process(app, makeStageMap());
    expect(outcome).toBe('needsReview');
    expect(bambooHrClient.moveStage).toHaveBeenCalledWith(app.id, 3 /* Reviewed */);
  });
});

describe('CandidateProcessor — error propagation (SAFE-01 surface)', () => {
  it('rethrows unrecoverable errors so ScreeningPipeline can count them', async () => {
    const bambooHrClient = makeBambooMock();
    (bambooHrClient.fetchApplicationDetails as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network error'),
    );
    const softEvaluator = makeSoftEvalMock();
    const logger = makeLoggerMock();
    const config = makeConfig();
    const liveWriter = new LiveModeWriter(bambooHrClient);

    const processor = new CandidateProcessor(
      bambooHrClient, softEvaluator, logger, liveWriter, config, false,
    );
    await expect(processor.process(makeApplication(), makeStageMap())).rejects.toThrow(
      'network error',
    );
  });
});

describe('CandidateProcessor — dry-run invariant', () => {
  it('never calls softEvaluator.evaluate in dry-run (CR-01)', async () => {
    const bambooHrClient = makeBambooMock();
    const softEvaluator = makeSoftEvalMock();
    const logger = makeLoggerMock();
    const config = makeConfig();
    const liveWriter = new LiveModeWriter(bambooHrClient);

    const app = makeApplication();
    (bambooHrClient.fetchApplicationDetails as ReturnType<typeof vi.fn>).mockResolvedValue(app);

    // Return successful candidate context
    const { buildCandidateContext } = await import('../pipeline/extract-cv.js');
    (buildCandidateContext as ReturnType<typeof vi.fn>).mockResolvedValue(
      makeSuccessfulCandidateContext(app),
    );

    const processor = new CandidateProcessor(
      bambooHrClient, softEvaluator, logger, liveWriter, config, true /* dryRun */,
    );
    const outcome = await processor.process(app, makeStageMap());
    expect(outcome).toBe('pass'); // synthetic dry-run result is always 'pass'
    expect(softEvaluator.evaluate).not.toHaveBeenCalled();
    expect(bambooHrClient.postComment).not.toHaveBeenCalled();
    expect(bambooHrClient.moveStage).not.toHaveBeenCalled();
    // logEvaluation IS called (for the synthetic dry-run record)
    expect(logger.logEvaluation).toHaveBeenCalledTimes(1);
  });
});
