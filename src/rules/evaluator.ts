// src/rules/evaluator.ts
// Hard-rule evaluation engine.
// D-03: Collect-all — EVERY rule is evaluated; all unmet labels accumulate in reasons[].
// D-07/D-08: Field values resolved via config.fieldMap — never hardcoded paths.
// RULE-01: Deterministic evaluation; no LLM invocation.
import type { Config } from '../config/schema.js';
import type { BambooHRApplication } from '../bamboohr/types.js';
import type { RuleResult } from './types.js';

/**
 * Resolve a human-readable field name to its value in the application object.
 * Uses config.fieldMap to map names like "rightToWork" → BambooHR field paths.
 *
 * Supports dot-notation paths, e.g.:
 *   "applicant.address.city" → application["applicant"]["address"]["city"]
 *   "questions.0.answer"     → application["questions"][0]["answer"]
 *
 * Returns undefined if the path does not exist in the application.
 */
function resolveField(
  application: BambooHRApplication,
  fieldName: string,
  fieldMap: Record<string, string>,
): unknown {
  const path = fieldMap[fieldName];
  if (path === undefined) {
    // Field name not in fieldMap — likely a placeholder; treat as absent
    return undefined;
  }

  // Walk the dot-notation path
  const parts = path.split('.');
  let current: unknown = application;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Evaluate all configured hard rules against a single candidate application.
 * Returns { outcome: 'pass' | 'fail', reasons: string[] }.
 *
 * IMPORTANT: This function MUST evaluate every rule — do NOT return early on first failure.
 * D-03: All unmet rule labels must be present in reasons[] for a complete rejection message.
 */
export function evaluateHardRules(
  config: Config,
  application: BambooHRApplication,
): RuleResult {
  const reasons: string[] = [];
  const { hardRules, fieldMap } = config;

  // --- Rule 1: maxSalary ---
  // Checks that the candidate's expected salary does not exceed the configured ceiling.
  // D-06: Salary field origin unknown; resolved via fieldMap.
  // Pitfall 6: Salary may come back as a string ("55,000"); always parse as float.
  if (hardRules.maxSalary !== undefined) {
    const { value: ceiling, label } = hardRules.maxSalary;
    const rawSalary = resolveField(application, 'salary', fieldMap);

    if (rawSalary === undefined || rawSalary === null || rawSalary === '') {
      // Field absent — cannot verify; treat as failing rule (conservative)
      reasons.push(label);
    } else {
      // Strip commas and parse; handles "55,000" and "55000" and 55000
      const salary = parseFloat(String(rawSalary).replace(/,/g, ''));
      if (Number.isNaN(salary) || salary > ceiling) {
        reasons.push(label);
      }
    }
  }

  // --- Rule 2: requiredFields ---
  // Checks that specific application fields are present and non-empty.
  // D-07/D-08: Field names are human-readable keys resolved via fieldMap — NOT top-level keys.
  // "resume" maps to the BambooHR field path via config.fieldMap, same as other rule types.
  if (hardRules.requiredFields !== undefined) {
    const { fields, label } = hardRules.requiredFields;
    let allPresent = true;
    for (const fieldName of fields) {
      const value = resolveField(application, fieldName, fieldMap);
      if (value === undefined || value === null || value === '') {
        allPresent = false;
        break;
      }
    }
    if (!allPresent) {
      reasons.push(label);
    }
  }

  // --- Rule 3: requiredBoolean ---
  // Checks boolean yes/no application form answers.
  // D-07: Fields are custom application questions; resolved via fieldMap.
  if (hardRules.requiredBoolean !== undefined) {
    for (const rule of hardRules.requiredBoolean) {
      const { field, expectedValue, label } = rule;
      const raw = resolveField(application, field, fieldMap);

      // BambooHR may return booleans as actual booleans or as strings "yes"/"no"/"true"/"false"
      let actual: boolean | undefined;
      if (typeof raw === 'boolean') {
        actual = raw;
      } else if (typeof raw === 'string') {
        const lower = raw.toLowerCase().trim();
        if (lower === 'yes' || lower === 'true') actual = true;
        else if (lower === 'no' || lower === 'false') actual = false;
      }

      if (actual === undefined || actual !== expectedValue) {
        reasons.push(label);
      }
    }
  }

  // --- Rule 4: requiredKeyword ---
  // Checks that a field contains an expected string value (case-insensitive substring match).
  // D-08: Human-readable field names resolved via fieldMap.
  if (hardRules.requiredKeyword !== undefined) {
    for (const rule of hardRules.requiredKeyword) {
      const { field, expectedValue, label, nullBehavior = 'fail' } = rule;
      const raw = resolveField(application, field, fieldMap);

      if (raw === undefined || raw === null) {
        if (nullBehavior === 'fail') reasons.push(label);
        // nullBehavior === 'pass': field absent → skip rule, candidate passes
      } else {
        const actual = String(raw).toLowerCase().trim();
        const expected = expectedValue.toLowerCase().trim();
        if (!actual.includes(expected)) {
          reasons.push(label);
        }
      }
    }
  }

  return {
    outcome: reasons.length === 0 ? 'pass' : 'fail',
    reasons,
  };
}
