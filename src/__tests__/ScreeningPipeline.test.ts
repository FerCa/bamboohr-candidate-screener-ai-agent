// src/__tests__/ScreeningPipeline.test.ts
// Integration-level tests for ScreeningPipeline.
// Mocks CandidateProcessor.process and asserts counter aggregation, SAFE-01 isolation,
// and the INFRA-03 JSON summary shape.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ScreeningPipeline } from '../screener/screening-pipeline.js';
import { CandidateProcessor } from '../pipeline/candidate-processor.js';
import { LiveModeWriter } from '../pipeline/live-mode-writer.js';
import type { IBambooHRClient } from '../interfaces/IBambooHRClient.js';
import type { ISoftEvaluator } from '../interfaces/ISoftEvaluator.js';
import type { ILogger } from '../interfaces/ILogger.js';
import type { Config } from '../config/schema.js';
import type { BambooHRApplication } from '../bamboohr/types.js';

function makeConfig(): Config {
  return {
    job: { openingId: 'job-1', stages: { intake: 'New', pass: 'Schedule Phone Screen', fail: 'Reviewed' } },
    hardRules: { maxSalary: { value: 100000, label: 'Salary above ceiling' } },
    fieldMap: { salary: 'desiredSalary' },
    softRules: undefined,
  } as Config;
}

function makeApp(id: number): BambooHRApplication {
  return {
    id,
    applicant: { id: id * 100, firstName: 'Test', lastName: `${id}`, email: `t${id}@u.com` },
    status: { id: 1, label: 'New' },
  } as BambooHRApplication;
}

function makeStageMap(): Map<string, number> {
  return new Map([
    ['New', 1],
    ['Schedule Phone Screen', 2],
    ['Reviewed', 3],
  ]);
}

function makeBambooMock(applications: BambooHRApplication[] = []): IBambooHRClient {
  return {
    get: vi.fn(),
    postComment: vi.fn(),
    moveStage: vi.fn(),
    validateStages: vi.fn().mockResolvedValue(makeStageMap()),
    fetchApplicationDetails: vi.fn(),
    downloadPdf: vi.fn(),
    fetchCandidates: vi.fn().mockResolvedValue(applications),
  } as unknown as IBambooHRClient;
}

function makeLoggerMock(): ILogger {
  return { logDecision: vi.fn(), logEvaluation: vi.fn() };
}

/** Build a CandidateProcessor whose .process is replaced with a vi.fn() — preserves shape. */
function makeProcessorMock(processImpl: (app: BambooHRApplication) => Promise<'pass' | 'fail' | 'needsReview'>): CandidateProcessor {
  const bambooMock = makeBambooMock();
  const softMock: ISoftEvaluator = { evaluate: vi.fn() };
  const loggerMock = makeLoggerMock();
  const liveWriter = new LiveModeWriter(bambooMock);
  const proc = new CandidateProcessor(
    bambooMock, softMock, loggerMock, liveWriter, makeConfig(), true,
  );
  proc.process = vi.fn(processImpl) as unknown as CandidateProcessor['process'];
  return proc;
}

describe('ScreeningPipeline.run', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    stderrSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  it('emits zero-candidate summary when fetchCandidates returns []', async () => {
    const bambooHrClient = makeBambooMock([]);
    const logger = makeLoggerMock();
    const processor = makeProcessorMock(async () => 'pass');
    const pipeline = new ScreeningPipeline(bambooHrClient, processor, logger, makeConfig(), true);

    await pipeline.run();

    expect(processor.process).not.toHaveBeenCalled();
    expect(stdoutSpy).toHaveBeenCalledWith(
      JSON.stringify({ processed: 0, pass: 0, fail: 0, needsReview: 0, errors: 0 }),
    );
  });

  it('aggregates counters across pass/fail/needsReview outcomes', async () => {
    const apps = [makeApp(1), makeApp(2), makeApp(3), makeApp(4)];
    const outcomes = ['pass', 'fail', 'needsReview', 'pass'] as const;
    let i = 0;
    const processor = makeProcessorMock(async () => outcomes[i++]!);
    const bambooHrClient = makeBambooMock(apps);
    const logger = makeLoggerMock();
    const pipeline = new ScreeningPipeline(bambooHrClient, processor, logger, makeConfig(), true);

    await pipeline.run();

    expect(processor.process).toHaveBeenCalledTimes(4);
    expect(stdoutSpy).toHaveBeenCalledWith(
      JSON.stringify({ processed: 4, pass: 2, fail: 1, needsReview: 1, errors: 0 }),
    );
  });

  it('logs error and continues when CandidateProcessor.process throws (SAFE-01)', async () => {
    const apps = [makeApp(1), makeApp(2), makeApp(3)];
    const processor = makeProcessorMock(async (app) => {
      if (app.id === 2) throw new Error('boom');
      return 'pass';
    });
    const bambooHrClient = makeBambooMock(apps);
    const logger = makeLoggerMock();
    const pipeline = new ScreeningPipeline(bambooHrClient, processor, logger, makeConfig(), true);

    await pipeline.run();

    // 2 successful + 1 errored = 2 processed (pass) + 1 error
    expect(stdoutSpy).toHaveBeenCalledWith(
      JSON.stringify({ processed: 2, pass: 2, fail: 0, needsReview: 0, errors: 1 }),
    );
    // logger.logDecision called once with outcome 'error'
    expect(logger.logDecision).toHaveBeenCalledTimes(1);
    const errorCall = (logger.logDecision as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(errorCall.outcome).toBe('error');
    expect(errorCall.reasons).toContain('boom');
  });

  it('calls validateStages exactly once and fetchCandidates exactly once', async () => {
    const bambooHrClient = makeBambooMock([]);
    const logger = makeLoggerMock();
    const processor = makeProcessorMock(async () => 'pass');
    const pipeline = new ScreeningPipeline(bambooHrClient, processor, logger, makeConfig(), true);

    await pipeline.run();

    expect(bambooHrClient.validateStages).toHaveBeenCalledTimes(1);
    expect(bambooHrClient.fetchCandidates).toHaveBeenCalledTimes(1);
    expect(bambooHrClient.fetchCandidates).toHaveBeenCalledWith('job-1', '1');
  });

  it('throws StageValidationError when intake stage missing from stageMap', async () => {
    const bambooHrClient = makeBambooMock([]);
    // Override validateStages to return a map that does NOT include 'New'
    (bambooHrClient.validateStages as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Map([['Schedule Phone Screen', 2], ['Reviewed', 3]]),
    );
    const logger = makeLoggerMock();
    const processor = makeProcessorMock(async () => 'pass');
    const pipeline = new ScreeningPipeline(bambooHrClient, processor, logger, makeConfig(), true);

    await expect(pipeline.run()).rejects.toThrowError(/Intake stage "New" not found/);
  });
});
