// src/agent/evaluator.ts
// Soft-rule evaluation orchestrator.
// Constructs an OpenAI Agents SDK Agent with model:'gpt-4.1' and outputType: EvaluationOutputSchema,
// and outputType: EvaluationOutputSchema, then calls run() with maxTurns:5 (SAFE-02).
//
// Recoverable-vs-rethrow split (same pattern as src/pipeline/extract-cv.ts lines 79-86):
//   MaxTurnsExceededError → return EvaluationResult{outcome:'needsReview'} (Pitfall #3)
//   All other errors → re-throw to outer try/catch in src/index.ts (logs outcome:'error')
//
// SAFE-02: Turn cap of 5 enforced via SDK option on every run() call.
// CONF-03: OPENAI_API_KEY read automatically by SDK via getDefaultOpenAIKey() — never set here.
// T-03-03-04: CV text is NEVER logged (PII); only applicationId appears in diagnostics.
import { Agent, run, MaxTurnsExceededError } from '@openai/agents';
import type { CandidateContext } from '../pipeline/types.js';
import type { EvaluationResult } from './types.js';
import { EvaluationOutputSchema } from './types.js';
import { buildSystemPrompt, buildUserMessage } from './prompt.js';

// Local type — mirrors Config['softRules'] structurally without depending on the Zod-derived
// Config type. This keeps evaluator.ts decoupled and easy to unit-test in isolation.
interface SoftRulesInput {
  required: Array<{ label: string; description: string }>;
  optional: Array<{ label: string; description: string }>;
}

/**
 * Evaluate a candidate against configured soft rules using GPT-4o.
 *
 * Returns Promise<EvaluationResult> — never throws for recoverable failures.
 * Recoverable: MaxTurnsExceededError → outcome:'needsReview'
 * Unrecoverable (network, auth, unexpected): re-throws to outer handler in src/index.ts
 *
 * Short-circuit: when softRules is undefined OR both arrays are empty, returns
 * outcome:'pass' with comment 'No soft rules configured' WITHOUT calling run().
 * (D-Discretion in CONTEXT.md — backward-compatible with Phase 1/2 configs)
 */
export async function evaluateSoftRules(
  ctx: CandidateContext,
  softRules: SoftRulesInput | undefined,
): Promise<EvaluationResult> {
  // (A) softRules absent / empty short-circuit — skip GPT-4o entirely
  if (
    softRules === undefined ||
    (softRules.required.length === 0 && softRules.optional.length === 0)
  ) {
    return {
      applicationId: ctx.applicationId,
      applicantId: ctx.applicantId,
      outcome: 'pass',
      required: [],
      optional: [],
      comment: 'No soft rules configured',
      timestamp: new Date().toISOString(),
    };
  }

  // (B) Build prompts from CandidateContext and softRules
  const systemPrompt = buildSystemPrompt({
    required: softRules.required,
    optional: softRules.optional,
  });
  const userMessage = buildUserMessage(ctx);

  // (C) Construct Agent — model: 'gpt-4.1' explicit; better instruction following than gpt-4o
  const agent = new Agent({
    name: 'Candidate Evaluator',
    model: 'gpt-4.1',
    instructions: systemPrompt,
    outputType: EvaluationOutputSchema,
  });

  // (D) Call run() with a maxTurns cap (SAFE-02).
  //     Catch MaxTurnsExceededError as recoverable → needsReview.
  //     Re-throw all other errors (network, auth) to outer handler in src/index.ts.
  try {
    const result = await run(agent, userMessage, { maxTurns: 5 });
    const out = result.finalOutput;
    if (!out) {
      // Defensive: SDK guarantees finalOutput when outputType is set and parse succeeds.
      // If somehow undefined, treat as needsReview rather than crashing.
      console.error(`[evaluator] Empty finalOutput for applicationId=${ctx.applicationId}`);
      return needsReviewResult(ctx);
    }
    return {
      applicationId: ctx.applicationId,
      applicantId: ctx.applicantId,
      outcome: out.outcome,
      required: out.required,
      optional: out.optional,
      comment: out.comment,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    if (err instanceof MaxTurnsExceededError) {
      console.error(
        `[evaluator] Max turns (5) exceeded for applicationId=${ctx.applicationId}`,
      );
      return needsReviewResult(ctx);
    }
    // Network / auth / unexpected errors — re-throw so outer try/catch in src/index.ts
    // logs CandidateDecision{outcome:'error'} (RESEARCH.md anti-pattern: never catch all
    // errors as needsReview; only the SDK-specific recoverable cases).
    throw err;
  }
}

/**
 * Construct a needsReview EvaluationResult for a candidate that could not be auto-screened.
 * Used for MaxTurnsExceededError and empty finalOutput defensive branch.
 */
function needsReviewResult(ctx: CandidateContext): EvaluationResult {
  return {
    applicationId: ctx.applicationId,
    applicantId: ctx.applicantId,
    outcome: 'needsReview',
    required: [],
    optional: [],
    comment: 'Soft evaluation could not be completed automatically — please review manually.',
    timestamp: new Date().toISOString(),
  };
}
