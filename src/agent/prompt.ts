// src/agent/prompt.ts
// Pure-function prompt builders for the GPT-4o soft evaluation agent.
//
// D-06: Comment format — structured list with fixed sections: outcome header, Met (required),
//   Unmet (required, if any), Optional results, and a hardcoded audit footer.
// D-07: Comment covers soft evaluation only — hard-rule pass is implicit. hardRuleResult
//   MUST NOT appear anywhere in the user message (Pitfall #5 in RESEARCH.md).
// D-08: Per-criterion rationale in the comment is GPT-4o-generated, grounded in actual
//   candidate content — not the rule description from config.yaml.
//
// These are pure functions: no async, no side effects, no SDK imports.
// Input objects → string outputs only.
import type { CandidateContext } from '../pipeline/types.js';

// Local types — intentionally decoupled from the Zod-derived Config type so this module
// stays easy to unit-test and has no runtime dependency on src/config/schema.js.
interface SoftRuleEntry {
  label: string;
  description: string;
}

interface SoftRulesPromptInput {
  required: SoftRuleEntry[];
  optional: SoftRuleEntry[];
}

/**
 * Build the GPT-4o system prompt for soft-rule evaluation.
 *
 * The returned string contains:
 *   - Role framing and structured-output schema reference
 *   - Numbered required and optional criteria lists
 *   - Evaluation rules (pass logic, rationale style, outcome computation)
 *   - The exact comment format GPT-4o must produce (D-06)
 *   - Hardcoded audit footer "[Auto-screened by AI — final decision rests with recruiter]"
 *     (locked by CONTEXT.md Specific Ideas — not configurable)
 */
export function buildSystemPrompt(softRules: SoftRulesPromptInput): string {
  // Build numbered list of required criteria
  const requiredList =
    softRules.required.length > 0
      ? softRules.required.map((r, i) => `${i + 1}. ${r.label} — ${r.description}`).join('\n')
      : '(none)';

  // Build numbered list of optional criteria
  const optionalList =
    softRules.optional.length > 0
      ? softRules.optional.map((r, i) => `${i + 1}. ${r.label} — ${r.description}`).join('\n')
      : '(none)';

  return [
    'You are a hiring screening assistant.',
    'You evaluate one job candidate against soft criteria provided below.',
    'Your output MUST conform exactly to the structured-output schema (required, optional, comment, outcome).',
    '',
    'REQUIRED CRITERIA (dealbreakers — every one must be met for a pass):',
    requiredList,
    '',
    'OPTIONAL CRITERIA (nice-to-haves — evaluate but never block the outcome):',
    optionalList,
    '',
    'EVALUATION RULES:',
    '1. For each required criterion, set met=true if the CV / application answers clearly support it; otherwise met=false.',
    '2. For each optional criterion, set met=true or false the same way.',
    '3. Compute outcome: "pass" if EVERY required criterion has met=true; "fail" if ANY required criterion has met=false. Never output "needsReview" — that value is reserved for system error handling.',
    '4. Each rationale string MUST be a single concise line citing specific evidence from the candidate (e.g., "5 years backend at company X per CV"). Do NOT repeat the criterion description verbatim.',
    '5. The comment field MUST be a recruiter-ready string formatted EXACTLY as shown below. Do not include hard-rule results or any pre-screening details — those are implicit.',
    '',
    'COMMENT FORMAT (use this exact structure, replacing bullet content with the actual results):',
    '',
    'PASS — Soft Evaluation',
    '',
    'Met (required):',
    '• <label>: <rationale>',
    '• <label>: <rationale>',
    '',
    'Optional (met):',
    '• <label>: <rationale>',
    '',
    '[Auto-screened by AI — final decision rests with recruiter]',
    '',
    'When the outcome is fail, replace the header with "FAIL — Soft Evaluation" and add an "Unmet (required):" section listing the failing required criteria with their rationales. Always include the audit footer line "[Auto-screened by AI — final decision rests with recruiter]" verbatim.',
    'If the optional list is empty, omit the "Optional" section entirely. If all required criteria are unmet, omit the "Met (required):" section.',
  ].join('\n');
}

/**
 * Build the GPT-4o user message from a candidate's context.
 *
 * Serializes ctx.cvText and ctx.applicationAnswers ONLY.
 * CRITICAL: ctx.hardRuleResult MUST NOT appear in this output (D-07 / Pitfall #5).
 * ctx.applicationId and ctx.applicantId are NOT included — they are reserved for the
 * EvaluationResult wrapper assembled in evaluator.ts.
 * ctx.needsReviewReason is NOT included — caller guarantees non-null cvText.
 */
export function buildUserMessage(ctx: CandidateContext): string {
  const cvText = ctx.cvText ?? '';
  const answersJson = JSON.stringify(ctx.applicationAnswers, null, 2);

  return [
    'Evaluate the following candidate against the criteria from your instructions.',
    '',
    '--- CV TEXT (extracted from PDF, may be truncated to 8000 characters) ---',
    cvText,
    '',
    '--- APPLICATION ANSWERS (raw JSON from BambooHR) ---',
    answersJson,
    '',
    'Return your evaluation as the structured output schema.',
  ].join('\n');
}
