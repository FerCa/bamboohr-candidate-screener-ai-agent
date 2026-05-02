// src/config/schema.ts
// Zod v4 schema for config.yaml — matches D-01/D-05 named typed field shape
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

export const configSchema = z.object({
  job: z.object({
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

export type Config = z.infer<typeof configSchema>;
