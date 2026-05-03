# Phase 1: Foundation - Context

**Gathered:** 2026-05-01
**Status:** Ready for planning

<domain>
## Phase Boundary

A runnable TypeScript script that loads and validates a YAML config file, connects to BambooHR, fetches all candidates in the "New" pipeline stage for the configured job opening, evaluates them deterministically against hard rules (salary ceiling, required fields, boolean criteria, keyword/location match), and logs a structured JSON decision line per candidate — all in dry-run mode with no LLM invocation and no writes to BambooHR.

</domain>

<decisions>
## Implementation Decisions

### YAML Config Shape

- **D-01:** Hard rules use **named typed fields** — each rule type has a dedicated key (`maxSalary`, `requiredFields`, `requiredBoolean`, `requiredKeyword`), not a generic operator list. Simple, readable YAML.
- **D-02:** Each rule type carries an explicit **human-readable `label`** field used verbatim as the rejection reason in log output. Example: `label: "Salary above ceiling"`.
- **D-03:** Rule evaluation is **collect-all** — every rule is evaluated and all unmet labels are accumulated into the `reasons` array. No fail-fast on first failure.
- **D-04:** **Single flat `config.yaml`** file containing both `job:` section (openingId, stage IDs/names) and `hardRules:` section. One file to mount in Docker.

Example config shape (researcher fills in actual BambooHR field names/IDs):
```yaml
job:
  openingId: "12345"
  stages:
    pass: "Schedule Phone Screen"
    fail: "Reviewed"

hardRules:
  maxSalary:
    value: 100000
    label: "Salary above ceiling"
  requiredFields:
    fields: [resume]
    label: "CV not attached"
  requiredBoolean:
    - field: rightToWork
      expectedValue: true
      label: "Must have right to work"
  requiredKeyword:
    - field: city
      expectedValue: "YourCity"
      label: "Must be based in the required location"

fieldMap:
  rightToWork: "customField_???"   # researcher to fill in actual BambooHR field ID
  city: "???"                       # researcher to fill in
  salary: "???"                     # researcher to fill in
```

### Specific Hard Rule Types

- **D-05:** Phase 1 implements **four rule types**: salary ceiling, required fields present, boolean/yes-no criteria, location/keyword match.
- **D-06:** Expected salary is of **unknown origin** — could be a custom application form field or a standard BambooHR field. **Researcher must verify** where it lives in the API response before writing the rule evaluator.
- **D-07:** Boolean and keyword rule fields are a **mix of custom application questions and standard BambooHR fields**. The `fieldMap` section in config decouples readable names from BambooHR field IDs/paths. **Researcher must document** actual field names/paths for the specific job opening.
- **D-08:** Fields referenced in rules use **human-readable names** in the config (e.g., `rightToWork`, `city`). A `fieldMap` section maps those names to BambooHR API field paths. This allows config changes without code changes when field IDs shift.

### Local Development & Testing

- **D-09:** Testing strategy is **real BambooHR API with `DRY_RUN=true`**. No writes happen. Real data validates the client and rule evaluator. No fixture files needed for Phase 1.
- **D-10:** Project supports a **`.env` file for local dev** (via `dotenv`) alongside Docker env vars for production. `.env` listed in `.gitignore`. Credentials: `BAMBOOHR_API_KEY`, `BAMBOOHR_SUBDOMAIN`, `OPENAI_API_KEY`, `DRY_RUN`, `CONFIG_PATH`.
- **D-11:** Local run command: **`npx tsx src/index.ts`** (zero-config, no compile step). Production uses compiled JS inside Docker.

### Claude's Discretion

- TypeScript project structure within `src/` (suggested: `src/config/`, `src/bamboohr/`, `src/rules/`, `src/logger/`) — standard modular layout is fine.
- Zod schema design for config validation.
- Exact pagination implementation for BambooHR BAMB-01 (cursor vs. offset depends on API variant — researcher determines).
- HTTP client choice: `fetch` (Node 22 built-in) preferred over adding `axios`/`node-fetch`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project Specs
- `.planning/REQUIREMENTS.md` — All REQ-IDs with acceptance criteria; Phase 1 requirements are CONF-01..04, BAMB-01, RULE-01, SAFE-01, INFRA-02
- `.planning/ROADMAP.md` — Phase 1 success criteria (5 items); dependency chain
- `.planning/PROJECT.md` — Key decisions table, constraints, tech stack

### External Docs (researcher must verify before planning)
- `https://documentation.bamboohr.com` — BambooHR ATS API: confirm whether legacy `/ats/` or newer `/v1/applicant-tracking/` endpoint is correct; find candidate list, field names, pagination, and attachment URL format
- `https://www.npmjs.com/package/js-yaml` — YAML loading API
- `https://zod.dev` — Zod schema validation patterns for config loader

### CLAUDE.md Constraints
- `CLAUDE.md` — Key constraints: `applicationId` (not `applicantId`) for writes; dry-run default; ESM `"module": "NodeNext"`; `@openai/agents` deferred to Phase 3

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- None — clean repo, no existing TypeScript source files.

### Established Patterns
- ESM TypeScript with `"module": "NodeNext"` is mandated (CLAUDE.md). All imports must use `.js` extensions (ESM NodeNext requirement).
- `node:22-alpine` Docker target — no native npm dependencies allowed (keep stack Alpine-compatible).

### Integration Points
- Phase 1 output is a **candidate context object** — the structured data model flowing into Phase 2 (PDF pipeline) and Phase 3 (agent evaluation). The shape of this object should be defined now even if only hard-rule fields are populated in Phase 1.

</code_context>

<specifics>
## Specific Ideas

- The `fieldMap` section in `config.yaml` is the key extensibility mechanism — new BambooHR fields can be added without code changes.
- The candidate context object produced by Phase 1 (candidateId, applicationId, applied fields, hard-rule results) will be extended in Phases 2 and 3, so it should be typed as an interface from the start.
- Log format per INFRA-02: `{ candidateId, applicationId, outcome, reasons, timestamp }` at minimum. Claude discretion on additional fields.

</specifics>

<deferred>
## Deferred Ideas

- None — discussion stayed within phase scope.

</deferred>

---

*Phase: 1-Foundation*
*Context gathered: 2026-05-01*
