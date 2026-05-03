// src/agent/evaluator.ts
// Soft-rule evaluation as a class (Phase 5, D-05/D-06).
// SoftEvaluator structurally satisfies ISoftEvaluator — no `implements` keyword needed.
//
// Behavior preserved end-to-end from Phase 3:
//   Recoverable-vs-rethrow split (canonical pattern in src/pipeline/extract-cv.ts:79-86):
//     MaxTurnsExceededError → return EvaluationResult{outcome:'needsReview'}
//     All other errors      → re-throw to outer try/catch in CandidateProcessor (SAFE-01)
//
// SAFE-02: Turn cap of 5 enforced via SDK option on every run() call.
// CONF-03: OPENAI_API_KEY read automatically by SDK via getDefaultOpenAIKey() — never set here.
// T-03-03-04: CV text is NEVER logged (PII); only applicationId appears in diagnostics.
import { Agent, run, MaxTurnsExceededError } from '@openai/agents';
import type { CandidateContext } from '../pipeline/types.js';
import type { EvaluationResult } from './types.js';
import { EvaluationOutputSchema } from './types.js';
import { buildSystemPrompt, buildUserMessage } from './prompt.js';
import type { SoftRulesInput } from '../interfaces/ISoftEvaluator.js';

/**
 * Evaluate a candidate against configured soft rules using GPT-4o.
 * Structurally satisfies ISoftEvaluator (D-05) — no `implements` keyword.
 *
 * Returns Promise<EvaluationResult> — never throws for recoverable failures.
 * Recoverable: MaxTurnsExceededError → outcome:'needsReview'
 * Unrecoverable (network, auth, unexpected): re-throws to CandidateProcessor's
 * per-candidate try/catch (SAFE-01).
 *
 * Short-circuit: when softRules is undefined OR both arrays are empty, returns
 * outcome:'pass' with comment 'No soft rules configured' WITHOUT calling run().
 */
export class SoftEvaluator {
  async evaluate(
    candidateContext: CandidateContext,
    softRules: SoftRulesInput | undefined,
  ): Promise<EvaluationResult> {
    // (A) softRules absent / empty short-circuit — skip GPT-4o entirely
    if (
      softRules === undefined ||
      (softRules.required.length === 0 && softRules.optional.length === 0)
    ) {
      return {
        applicationId: candidateContext.applicationId,
        applicantId: candidateContext.applicantId,
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
    const userMessage = buildUserMessage(candidateContext);

    // (C) Construct Agent — gpt-4.1 model explicit; better instruction following than gpt-4o
    const agent = new Agent({
      name: 'Candidate Evaluator',
      model: 'gpt-4.1',
      instructions: systemPrompt,
      outputType: EvaluationOutputSchema,
    });

    // (D) Call run() with a maxTurns cap (SAFE-02).
    //     Catch MaxTurnsExceededError as recoverable → needsReview.
    //     Re-throw all other errors so CandidateProcessor's outer try/catch logs
    //     CandidateDecision{outcome:'error'} (RESEARCH.md anti-pattern: never catch all
    //     errors as needsReview; only the SDK-specific recoverable cases).
    try {
      const result = await run(agent, userMessage, { maxTurns: 5 });
      const agentOutput = result.finalOutput;
      if (!agentOutput) {
        // Defensive: SDK guarantees finalOutput when outputType is set and parse succeeds.
        // If somehow undefined, treat as needsReview rather than crashing.
        console.error(
          `[evaluator] Empty finalOutput for applicationId=${candidateContext.applicationId}`,
        );
        return this.needsReviewResult(candidateContext);
      }
      return {
        applicationId: candidateContext.applicationId,
        applicantId: candidateContext.applicantId,
        outcome: agentOutput.outcome,
        required: agentOutput.required,
        optional: agentOutput.optional,
        comment: agentOutput.comment,
        timestamp: new Date().toISOString(),
      };
    } catch (err) {
      if (err instanceof MaxTurnsExceededError) {
        console.error(
          `[evaluator] Max turns (5) exceeded for applicationId=${candidateContext.applicationId}`,
        );
        return this.needsReviewResult(candidateContext);
      }
      // Network / auth / unexpected errors — re-throw
      throw err;
    }
  }

  /**
   * Construct a needsReview EvaluationResult for a candidate that could not be auto-screened.
   * Used for MaxTurnsExceededError and the empty-finalOutput defensive branch.
   */
  private needsReviewResult(candidateContext: CandidateContext): EvaluationResult {
    return {
      applicationId: candidateContext.applicationId,
      applicantId: candidateContext.applicantId,
      outcome: 'needsReview',
      required: [],
      optional: [],
      comment:
        'Soft evaluation could not be completed automatically — please review manually.',
      timestamp: new Date().toISOString(),
    };
  }
}
