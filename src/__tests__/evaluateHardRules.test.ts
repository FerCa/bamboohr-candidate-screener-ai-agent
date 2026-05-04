// src/__tests__/evaluateHardRules.test.ts
// Pure-function tests for the hard-rule evaluator (D-11).
// No mocks needed — evaluateHardRules is deterministic and side-effect-free.
// The collect-all invariant (D-03 from Phase 1) is the most important regression check.
import { describe, it, expect } from 'vitest';
import { evaluateHardRules } from '../rules/hard-rules.js';
import type { JobConfig } from '../config/schema.js';
import type { BambooHRApplication } from '../bamboohr/types.js';

/**
 * Build a minimal JobConfig for hard-rule tests.
 * Tests override the rule blocks they care about.
 */
function makeConfig(overrides: Partial<JobConfig['hardRules']> = {}, fieldMap: Record<string, string> = {}): JobConfig {
  return {
    openingId: 'test-job',
    stages: { intake: 'New', pass: 'Schedule Phone Screen', fail: 'Reviewed' },
    hardRules: overrides as JobConfig['hardRules'],
    fieldMap: {
      salary: 'desiredSalary',
      rightToWork: 'rightToWorkAnswer',
      location: 'applicant.address.city',
      resume: 'resumeFileId',
      ...fieldMap,
    },
    softRules: undefined,
  };
}

/**
 * Build a minimal BambooHRApplication. Tests override the fields they care about.
 */
function makeApp(extra: Record<string, unknown> = {}): BambooHRApplication {
  return {
    id: 1,
    applicant: { id: 100, firstName: 'Test', lastName: 'User', email: 't@u.com' },
    status: { id: 1, label: 'New' },
    ...extra,
  } as BambooHRApplication;
}

describe('evaluateHardRules — maxSalary', () => {
  it('passes when salary is below the ceiling', () => {
    const config = makeConfig({ maxSalary: { value: 60000, label: 'Salary above ceiling' } });
    const app = makeApp({ desiredSalary: 50000 });
    expect(evaluateHardRules(config, app)).toEqual({ outcome: 'pass', reasons: [] });
  });

  it('fails when salary is above the ceiling', () => {
    const config = makeConfig({ maxSalary: { value: 60000, label: 'Salary above ceiling' } });
    const app = makeApp({ desiredSalary: 70000 });
    const result = evaluateHardRules(config, app);
    expect(result.outcome).toBe('fail');
    expect(result.reasons).toContain('Salary above ceiling');
  });

  it('fails conservatively when salary field is missing', () => {
    const config = makeConfig({ maxSalary: { value: 60000, label: 'Salary above ceiling' } });
    const app = makeApp({}); // no desiredSalary key
    const result = evaluateHardRules(config, app);
    expect(result.outcome).toBe('fail');
    expect(result.reasons).toContain('Salary above ceiling');
  });

  it('handles comma-formatted salary strings ("55,000")', () => {
    const config = makeConfig({ maxSalary: { value: 60000, label: 'Salary above ceiling' } });
    const app = makeApp({ desiredSalary: '55,000' });
    expect(evaluateHardRules(config, app)).toEqual({ outcome: 'pass', reasons: [] });
  });
});

describe('evaluateHardRules — requiredFields', () => {
  it('passes when all required fields are present and non-empty', () => {
    const config = makeConfig({
      requiredFields: { fields: ['resume'], label: 'Required field missing' },
    });
    const app = makeApp({ resumeFileId: 999 });
    expect(evaluateHardRules(config, app)).toEqual({ outcome: 'pass', reasons: [] });
  });

  it('fails when at least one required field is missing', () => {
    const config = makeConfig({
      requiredFields: { fields: ['resume'], label: 'Required field missing' },
    });
    const app = makeApp({}); // no resumeFileId
    const result = evaluateHardRules(config, app);
    expect(result.outcome).toBe('fail');
    expect(result.reasons).toContain('Required field missing');
  });
});

describe('evaluateHardRules — requiredBoolean', () => {
  const ruleConfig = {
    requiredBoolean: [
      { field: 'rightToWork', expectedValue: true, label: 'No right to work' },
    ],
  };

  it('passes when raw boolean true matches expectedValue true', () => {
    const config = makeConfig(ruleConfig);
    const app = makeApp({ rightToWorkAnswer: true });
    expect(evaluateHardRules(config, app).outcome).toBe('pass');
  });

  it('passes when raw "yes" coerces to true matching expectedValue true', () => {
    const config = makeConfig(ruleConfig);
    const app = makeApp({ rightToWorkAnswer: 'yes' });
    expect(evaluateHardRules(config, app).outcome).toBe('pass');
  });

  it('passes when expectedValue false and raw "no" coerces to false', () => {
    const config = makeConfig({
      requiredBoolean: [
        { field: 'rightToWork', expectedValue: false, label: 'Should not have right' },
      ],
    });
    const app = makeApp({ rightToWorkAnswer: 'no' });
    expect(evaluateHardRules(config, app).outcome).toBe('pass');
  });

  it('fails when raw value mismatches expectedValue', () => {
    const config = makeConfig(ruleConfig);
    const app = makeApp({ rightToWorkAnswer: 'no' });
    const result = evaluateHardRules(config, app);
    expect(result.outcome).toBe('fail');
    expect(result.reasons).toContain('No right to work');
  });
});

describe('evaluateHardRules — requiredKeyword', () => {
  it('passes when field contains expected substring (case-insensitive)', () => {
    const config = makeConfig({
      requiredKeyword: [
        { field: 'location', expectedValue: 'Madrid', label: 'Wrong location', nullBehavior: 'fail' },
      ],
    });
    const app = makeApp({ applicant: { id: 1, firstName: 'a', lastName: 'b', email: 'c', address: { city: 'Madrid, Spain' } } } as Partial<BambooHRApplication>);
    expect(evaluateHardRules(config, app).outcome).toBe('pass');
  });

  it('fails when field does not contain expected substring', () => {
    const config = makeConfig({
      requiredKeyword: [
        { field: 'location', expectedValue: 'Madrid', label: 'Wrong location', nullBehavior: 'fail' },
      ],
    });
    const app = makeApp({ applicant: { id: 1, firstName: 'a', lastName: 'b', email: 'c', address: { city: 'Berlin' } } } as Partial<BambooHRApplication>);
    const result = evaluateHardRules(config, app);
    expect(result.outcome).toBe('fail');
    expect(result.reasons).toContain('Wrong location');
  });

  it('fails when field missing and nullBehavior is fail (default)', () => {
    const config = makeConfig({
      requiredKeyword: [
        { field: 'location', expectedValue: 'Madrid', label: 'Wrong location', nullBehavior: 'fail' },
      ],
    });
    const app = makeApp({});
    expect(evaluateHardRules(config, app).outcome).toBe('fail');
  });

  it('passes when field missing and nullBehavior is pass', () => {
    const config = makeConfig({
      requiredKeyword: [
        { field: 'location', expectedValue: 'Madrid', label: 'Wrong location', nullBehavior: 'pass' },
      ],
    });
    const app = makeApp({});
    expect(evaluateHardRules(config, app).outcome).toBe('pass');
  });
});

describe('evaluateHardRules — collect-all invariant (D-03)', () => {
  it('accumulates ALL unmet rule labels — never short-circuits on first failure', () => {
    const config = makeConfig({
      maxSalary: { value: 60000, label: 'Salary above ceiling' },
      requiredFields: { fields: ['resume'], label: 'Resume missing' },
      requiredBoolean: [
        { field: 'rightToWork', expectedValue: true, label: 'No right to work' },
      ],
    });
    // Application that fails ALL THREE rules simultaneously
    const app = makeApp({ desiredSalary: 99999, rightToWorkAnswer: 'no' /* no resume */ });
    const result = evaluateHardRules(config, app);
    expect(result.outcome).toBe('fail');
    // All three labels MUST be present — proves no early return
    expect(result.reasons).toContain('Salary above ceiling');
    expect(result.reasons).toContain('Resume missing');
    expect(result.reasons).toContain('No right to work');
    expect(result.reasons).toHaveLength(3);
  });
});
