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
});

export const configSchema = z.object({
  job: z.object({
    openingId: z.string().min(1),
    stages: z.object({
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
});

export type Config = z.infer<typeof configSchema>;
