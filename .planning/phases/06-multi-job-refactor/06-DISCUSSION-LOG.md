# Phase 6: Multi-Job Refactor - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-04
**Phase:** 06-multi-job-refactor
**Areas discussed:** Config YAML shape, Orchestration architecture, Lock file location, Summary JSON format

---

## Config YAML shape

| Option | Description | Selected |
|--------|-------------|----------|
| Flat | `openingId` and `stages` directly in each job entry | ✓ |
| Nested under `job:` | `openingId` and `stages` under a `job:` sub-key, matching current single-job structure | (initial pick, then revised) |

**User's choice:** Flat — after seeing both options side-by-side, the user preferred the flatter structure (less nesting, easier to write).

**Normalization:**

| Option | Description | Selected |
|--------|-------------|----------|
| Lift into jobs[] silently | Detect `job:` vs `jobs:`, normalize to multi-job shape without warning | ✓ |
| Log a deprecation warning | Same normalization but emit a stderr warning | |
| Accept both via Zod union | Schema handles both shapes natively | |

**User's choice:** Silent normalization — no deprecation warning.

**Enable flag:**

| Option | Description | Selected |
|--------|-------------|----------|
| No enable flag | Remove an entry to skip it | ✓ |
| Optional `enabled: false` | Disable jobs without removing the config entry | |

**User's choice:** No enable flag. Keep it simple.

---

## Orchestration architecture

| Option | Description | Selected |
|--------|-------------|----------|
| New orchestrator wraps existing | Keep `ScreeningPipeline` as per-job runner, add `MultiJobOrchestrator` | ✓ |
| Refactor ScreeningPipeline internally | Extend `ScreeningPipeline.run()` to loop over jobs internally | |

**User's choice:** New orchestrator pattern.

**Rename ScreeningPipeline:**

| Option | Description | Selected |
|--------|-------------|----------|
| Rename to `JobRunner` | Explicit role naming — `JobRunner` + `MultiJobOrchestrator` hierarchy | ✓ |
| Keep as `ScreeningPipeline` | Less churn on imports and test files | |

**User's choice:** Rename to `JobRunner`.

**Test strategy:**

| Option | Description | Selected |
|--------|-------------|----------|
| Rename to `JobRunner.test.ts` + add `MultiJobOrchestrator.test.ts` | Two clean test files | ✓ |
| Reuse existing test file, extend it | Less file churn | |

**User's choice:** Rename + new file.

---

## Lock file location

| Option | Description | Selected |
|--------|-------------|----------|
| Volume-mounted path via env var | `LOCK_FILE_PATH` env var for flexible placement | |
| `/tmp/screener.lock` (Docker-internal only) | Simple, container-ephemeral | |
| Config-relative `./screener.lock` | Persists if config dir is volume-mounted | |
| **DEFERRED** | Remove from Phase 6 scope entirely | ✓ |

**User's choice:** Defer — user noted this overcomplicates the milestone. SAFE-03 removed from Phase 6.

**Notes:** Docker concern discussed: `/tmp/` is wiped on each `docker run --rm`, making cross-invocation overlap prevention non-trivial. User agreed to defer rather than design a full solution here.

---

## Summary JSON format

| Option | Description | Selected |
|--------|-------------|----------|
| Per-job breakdown + aggregate totals (single JSON line) | `{ jobs: [...], totals: {...} }` | ✓ |
| One JSON line per job + one totals line | Streaming-friendly, multiple stdout lines | |

**User's choice:** Single JSON object with `jobs` array and `totals`.

**Failed job representation:**

| Option | Description | Selected |
|--------|-------------|----------|
| Include with `error: true` flag | Failed jobs appear in `jobs[]` with `errorReason` | ✓ |
| Omit from array | Only successful jobs in output | |

**User's choice:** Include failed jobs with `error: true` and `errorReason`.

---

## Claude's Discretion

- Exact Zod schema structure for per-job entry (reuse vs extract sub-schemas)
- Whether `JobRunner` receives a per-job config slice or full config + job index
- Test mock strategy for `MultiJobOrchestrator` tests

## Deferred Ideas

- **SAFE-03 (lock file)**: Deliberately removed from Phase 6. May be revisited in Phase 7/8 or as a standalone quick task with a volume-mounted path strategy.
