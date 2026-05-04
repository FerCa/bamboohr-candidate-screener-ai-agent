# Phase 6: Multi-Job Refactor - Context

**Gathered:** 2026-05-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Extend the TypeScript codebase to process N jobs per container run — each job runs the full pipeline independently with its own stage validation, candidate fetch, hard rules, soft rules, and write path. Failures in one job do not abort others. Backward-compatible with the existing single-job `config.yaml`.

SAFE-03 (lock file guard) is explicitly DEFERRED from this phase — see Deferred Ideas section.

</domain>

<decisions>
## Implementation Decisions

### Config YAML shape

- **D-01:** Each entry in the `jobs[]` array is **flat** — `openingId`, `stages`, `hardRules`, `fieldMap`, and `softRules` appear directly at the entry level (no `job:` sub-key). Every field is per-job; nothing is shared across jobs.

  ```yaml
  jobs:
    - openingId: "19"
      stages:
        intake: "New"
        pass: "Schedule Phone Screen"
        fail: "Reviewed"
      hardRules:
        maxSalary: { value: 70000, label: "Salary above ceiling" }
      fieldMap:
        salary: "desiredSalary"
      softRules:
        required:
          - label: "PHP experience"
            description: "..."

    - openingId: "23"
      stages:
        intake: "Applied"
        pass: "Technical Interview"
        fail: "Not Selected"
      hardRules:
        requiredFields: { fields: [resume], label: "CV required" }
      fieldMap:
        resume: "resumeFileId"
      softRules:
        required:
          - label: "React experience"
            description: "..."
  ```

- **D-02:** **Backward-compatible normalization** — `loadConfig()` detects whether the YAML has a `job:` key (legacy) or a `jobs:` key (multi-job). If `job:` is found, the loader silently normalizes it to `jobs: [{ openingId, stages, hardRules, fieldMap, softRules }]` before Zod validation. No warning is emitted. The internal `Config` type always uses the normalized multi-job shape.

  ```ts
  // loader.ts — normalization logic (before Zod parse)
  if ('job' in raw && !('jobs' in raw)) {
    raw = {
      jobs: [{
        openingId: (raw as any).job.openingId,
        stages: (raw as any).job.stages,
        hardRules: (raw as any).hardRules,
        fieldMap: (raw as any).fieldMap,
        softRules: (raw as any).softRules,
      }],
    };
  }
  ```

- **D-03:** **No `enabled:` flag** — all jobs in `jobs[]` are always processed. To skip a job, remove its entry from the array.

### Orchestration architecture

- **D-04:** **New top-level orchestrator pattern** — the current `ScreeningPipeline` class is renamed to `JobRunner` and handles one job's full pipeline (unchanged behavior). A new `MultiJobOrchestrator` class loops over `config.jobs[]`, instantiates one `JobRunner` per job, runs them sequentially, and aggregates results.

  File layout:
  ```
  src/screener/
    job-runner.ts                  ← renamed from screening-pipeline.ts
    multi-job-orchestrator.ts      ← new
  ```

- **D-05:** `validateStages()` is called per-job inside `JobRunner.run()` (not once globally) — prevents the wrong stage map being applied across jobs. This was a pre-decided constraint from STATE.md (PITFALL MJ-04).

- **D-06:** `index.ts` constructs `MultiJobOrchestrator` and calls `orchestrator.run()` instead of `ScreeningPipeline`. The DI wiring pattern from Phase 5 is preserved.

- **D-07:** **Test strategy** — rename `ScreeningPipeline.test.ts` → `JobRunner.test.ts` (update class name only; logic preserved). Add `MultiJobOrchestrator.test.ts` to cover: N-job iteration, per-job failure isolation, and aggregate count correctness.

### Summary JSON format

- **D-08:** The final stdout line is a single JSON object with a `jobs` array and a `totals` key:

  ```json
  {
    "jobs": [
      { "openingId": "19", "processed": 5, "pass": 3, "fail": 1, "needsReview": 1, "errors": 0 },
      { "openingId": "23", "processed": 3, "pass": 1, "fail": 2, "needsReview": 0, "errors": 0 }
    ],
    "totals": { "processed": 8, "pass": 4, "fail": 3, "needsReview": 1, "errors": 0 }
  }
  ```

- **D-09:** Jobs that fail entirely (e.g., `StageValidationError` during stage validation) appear in the `jobs` array with `error: true` and an `errorReason` string. Their candidates are NOT counted in `totals`.

  ```json
  {
    "jobs": [
      { "openingId": "19", "processed": 5, "pass": 3, "fail": 1, "needsReview": 1, "errors": 0 },
      { "openingId": "23", "error": true, "errorReason": "Stage \"Applied\" not found in BambooHR" }
    ],
    "totals": { "processed": 5, "pass": 3, "fail": 1, "needsReview": 1, "errors": 0 }
  }
  ```

- **D-10:** The run exits with code 0 even when one or more jobs fail — matching the success criterion ("the run exits with code 0 and logs aggregate totals").

### Claude's Discretion

- Exact Zod schema for the per-job entry (whether `openingId` uses the existing `configSchema`'s sub-schemas for `hardRules`, `softRules`, etc., or whether these are extracted into a shared `jobEntrySchema`).
- Whether `JobRunner` accepts a per-job config slice as a typed object or receives the full `config` with a job index — Claude decides based on what keeps the Phase 5 DI pattern cleanest.
- Test mock shape for `MultiJobOrchestrator` tests — Claude decides mocking strategy.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Specs
- `.planning/REQUIREMENTS.md` — Requirements CONF-06, CONF-07, MULTI-01, MULTI-02, MULTI-03 (SAFE-03 deferred)
- `.planning/ROADMAP.md` — Phase 6 success criteria (5 items); phase dependency chain
- `.planning/PROJECT.md` — Key constraints (dry-run default, `applicationId` for writes, comment-before-stage atomicity)

### Phase 5 Context (must read — Phase 6 extends everything Phase 5 built)
- `.planning/phases/05-clean-code-solid-refactor/05-CONTEXT.md` — All D-01 to D-13: ScreeningPipeline, CandidateProcessor, LiveModeWriter, CommentBuilder, IBambooHRClient, ISoftEvaluator, ILogger, named error classes, process.exit policy

### Key Source Files
- `src/config/schema.ts` — Current single-job Zod schema (to be extended with `jobsSchema`)
- `src/config/loader.ts` — `loadConfig()` + normalization logic goes here (D-02)
- `src/screener/screening-pipeline.ts` — Renamed to `job-runner.ts` (D-04); contains per-job pipeline logic
- `src/index.ts` — Entry point wiring, updated to use `MultiJobOrchestrator` (D-06)
- `src/__tests__/ScreeningPipeline.test.ts` — Renamed to `JobRunner.test.ts` (D-07)
- `src/interfaces/IBambooHRClient.ts` — Interface used by both `JobRunner` and `MultiJobOrchestrator`

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ScreeningPipeline` (→ `JobRunner`): per-job orchestration logic is already complete; Phase 6 wraps it without changing it
- `CandidateProcessor`: unchanged — still handles per-candidate pipeline for one job
- `IBambooHRClient`, `ISoftEvaluator`, `ILogger`: all interfaces preserved; `MultiJobOrchestrator` uses same DI pattern
- `StageValidationError`: already defined in `src/bamboohr/errors.ts` — used for per-job error detection in D-09

### Established Patterns
- DI via constructor: `MultiJobOrchestrator` follows the same pattern established in Phase 5 — dependencies injected, not imported directly in business logic
- Named error classes: `StageValidationError` caught at job level in `MultiJobOrchestrator`, not propagated to kill the run
- `process.exit` only in `src/index.ts`: `MultiJobOrchestrator.run()` should NOT call `process.exit` — throw or resolve with error info instead

### Integration Points
- `loadConfig()` in `src/config/loader.ts`: normalization logic (D-02) added here before Zod parse
- `src/index.ts`: replaces `ScreeningPipeline` construction with `MultiJobOrchestrator`; per-job `CandidateProcessor` instances constructed inside `MultiJobOrchestrator` (one per job)

</code_context>

<specifics>
## Specific Ideas

- No specific UI or output format references beyond what's captured in D-08/D-09.
- The user confirmed the spirit: **every job is completely independent** — no shared stages, rules, or field mappings between jobs.

</specifics>

<deferred>
## Deferred Ideas

- **SAFE-03 (lock file guard)**: Deliberately removed from Phase 6 scope. The Docker concern (lock in `/tmp/` is wiped per `docker run --rm`, so it doesn't prevent cron overlap across invocations) makes this more complex than the milestone warrants. Can be revisited in Phase 7/8 or as a standalone quick task with a volume-mounted lock path.

</deferred>

---

*Phase: 6-Multi-Job-Refactor*
*Context gathered: 2026-05-04*
