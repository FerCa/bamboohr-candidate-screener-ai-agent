// src/__tests__/schema.test.ts
// TDD RED: Tests for Phase 6 Plan 01 — jobs-array configSchema + jobEntrySchema + JobConfig
import { describe, it, expect } from 'vitest';
import { jobEntrySchema, configSchema } from '../config/schema.js';

const validJob = {
  openingId: '19',
  stages: { intake: 'New', pass: 'Schedule Phone Screen', fail: 'Reviewed' },
  hardRules: { maxSalary: { value: 70000, label: 'Salary ceiling' } },
  fieldMap: { salary: 'desiredSalary' },
};

describe('jobEntrySchema', () => {
  it('Test 1: parses a valid job entry with all fields', () => {
    const result = jobEntrySchema.safeParse(validJob);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.openingId).toBe('19');
      expect(result.data.stages.intake).toBe('New');
    }
  });

  it('Test 2: rejects openingId starting with REPLACE_WITH', () => {
    const bad = { ...validJob, openingId: 'REPLACE_WITH_ID' };
    const result = jobEntrySchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = result.error.flatten();
      const allMessages = [
        ...Object.values(flat.fieldErrors).flat(),
        ...flat.formErrors,
      ];
      expect(allMessages.some((m) => m.includes('openingId must be set to a real BambooHR job opening ID'))).toBe(true);
    }
  });

  it('Test 4: rejects hardRules with no rules at all', () => {
    const bad = { ...validJob, hardRules: {} };
    const result = jobEntrySchema.safeParse(bad);
    expect(result.success).toBe(false);
    if (!result.success) {
      const flat = result.error.flatten();
      const allMessages = [
        ...Object.values(flat.fieldErrors).flat(),
        ...flat.formErrors,
      ];
      expect(allMessages.some((m) => m.includes('hardRules must contain at least one rule'))).toBe(true);
    }
  });
});

describe('configSchema', () => {
  it('Test 3: parses { jobs: [validJob] } successfully', () => {
    const result = configSchema.safeParse({ jobs: [validJob] });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.jobs[0]?.openingId).toBe('19');
    }
  });

  it('Test 3b: rejects { jobs: [] } — min(1) on array', () => {
    const result = configSchema.safeParse({ jobs: [] });
    expect(result.success).toBe(false);
  });

  it('Test 5: rejects old single-job shape { job: {...} } — loader handles normalization', () => {
    const oldShape = {
      job: { openingId: '19', stages: { intake: 'New', pass: 'Pass', fail: 'Fail' } },
      hardRules: { maxSalary: { value: 70000, label: 'Salary ceiling' } },
      fieldMap: { salary: 'desiredSalary' },
    };
    const result = configSchema.safeParse(oldShape);
    expect(result.success).toBe(false);
  });
});
