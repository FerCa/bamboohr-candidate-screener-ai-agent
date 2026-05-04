// src/config/schema.ts
// Zod v4 schema for config.yaml — Phase 6 multi-job shape (D-01/D-05)
// jobEntrySchema: per-job entry with openingId, stages, hardRules, fieldMap, softRules
// configSchema: top-level { jobs: jobEntrySchema[] } (legacy `job:` key normalized in loader.ts)
// Source: zod.dev/api (safeParse, z.object, z.array, z.record)
import { z } from 'zod';

const maxSalaryRuleSchema = z.object({
  value: z.number().positive(),
  label: z.string().min(1),
});

const requiredFieldsRuleSchema = z.object({
  fields: z.array(z.string().min(1)).min(1),
  label: z.string().min(1),
});

const requiredBooleanRuleSchema = z.object({
  field: z.string().min(1),
  expectedValue: z.boolean(),
  label: z.string().min(1),
});

const requiredKeywordRuleSchema = z.object({
  field: z.string().min(1),
  expectedValue: z.string().min(1),
  label: z.string().min(1),
  nullBehavior: z.enum(['pass', 'fail']).optional().default('fail'),
});

// Phase 3: D-01 — each soft rule entry has a human-readable label and a GPT-4o
// evaluation description. Mirrors the hard-rule label pattern.
const softRuleEntrySchema = z.object({
  label: z.string().min(1),
  description: z.string().min(1),
});

// Phase 3: D-02 — softRules splits into `required` (dealbreakers) and `optional`
// (nice-to-haves). Both arrays default to [] when absent so consumers can iterate
// without null checks. The wrapping z.object is itself .optional() so existing
// configs without a softRules block remain valid (backward-compatible).
const softRulesSchema = z
  .object({
    required: z.array(softRuleEntrySchema).optional().default([]),
    optional: z.array(softRuleEntrySchema).optional().default([]),
  })
  .optional();

// Phase 6 (D-01): per-job entry schema — every field is per-job; nothing shared across jobs.
// Threat model: openingId refine rejects placeholder values (REPLACE_WITH_*) at load time.
// Threat model: hardRules refine requires at least one rule so empty configs are caught.
export const jobEntrySchema = z.object({
  openingId: z
    .string()
    .min(1)
    .refine((v) => !v.startsWith('REPLACE_WITH'), {
      message: 'openingId must be set to a real BambooHR job opening ID',
    }),
  stages: z.object({
    intake: z.string().min(1),
    pass: z.string().min(1),
    fail: z.string().min(1),
  }),
  hardRules: z
    .object({
      maxSalary: maxSalaryRuleSchema.optional(),
      requiredFields: requiredFieldsRuleSchema.optional(),
      requiredBoolean: z.array(requiredBooleanRuleSchema).optional(),
      requiredKeyword: z.array(requiredKeywordRuleSchema).optional(),
    })
    .refine(
      (rules) =>
        rules.maxSalary !== undefined ||
        rules.requiredFields !== undefined ||
        (rules.requiredBoolean !== undefined && rules.requiredBoolean.length > 0) ||
        (rules.requiredKeyword !== undefined && rules.requiredKeyword.length > 0),
      { message: 'hardRules must contain at least one rule' },
    ),
  fieldMap: z.record(z.string(), z.string()),
  // Phase 3: optional soft-rule criteria for GPT-4o evaluation (D-01, D-02).
  // Absent → Phase 3 logs candidates as 'pass' with comment 'No soft rules configured'.
  softRules: softRulesSchema,
});

// Phase 6: JobConfig is the type for a single job entry — used by JobRunner, CandidateProcessor,
// evaluateHardRules, IBambooHRClient.validateStages.
export type JobConfig = z.infer<typeof jobEntrySchema>;

// Phase 6 (D-01): top-level schema uses a `jobs` array (min 1).
// Legacy `job:` YAML shape is normalized to this format in loader.ts (D-02) before Zod parse.
export const configSchema = z.object({
  jobs: z.array(jobEntrySchema).min(1),
});

export type Config = z.infer<typeof configSchema>;
