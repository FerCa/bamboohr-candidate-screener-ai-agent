# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-01
**Phase:** 1-Foundation
**Areas discussed:** Hard rules YAML schema, Specific hard rule criteria, Local dev testing approach

---

## Hard Rules YAML Schema

| Option | Description | Selected |
|--------|-------------|----------|
| Named typed fields | Each rule type has a dedicated key (maxSalary, requiredFields). Simple, readable, but adding a new rule type requires code changes. | ✓ |
| Operator-based list | Generic `{field, operator, value}` list. Flexible but verbose YAML. | |

**User's choice:** Named typed fields

**Follow-up: Human-readable labels?**

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit labels per rule | Optional `label` field per rule, used verbatim in log output. | ✓ |
| Auto-generated from rule type | Code generates reason strings like "maxSalary: 60000 (candidate: 75000)". | |

**User's choice:** Explicit labels per rule

**Follow-up: Fail-fast or collect all?**

| Option | Description | Selected |
|--------|-------------|----------|
| All failures | Evaluate every rule, collect all unmet ones in reasons array. | ✓ |
| Fail-fast on first failure | Stop evaluating after the first failed rule. | |

**User's choice:** All failures

**Follow-up: Single config file or separate files?**

| Option | Description | Selected |
|--------|-------------|----------|
| Single flat config file | One config.yaml with job section + hardRules section. One Docker volume mount. | ✓ |
| Separate files | job.yaml + rules.yaml. More modular but two mounts. | |

**User's choice:** Single flat config file

---

## Specific Hard Rule Criteria

**Rule types needed:**

| Option | Selected |
|--------|----------|
| Salary ceiling | ✓ |
| Required fields present | ✓ |
| Boolean / yes-no criteria | ✓ |
| Location / keyword match | ✓ |

**Salary field origin:**

| Option | Description | Selected |
|--------|-------------|----------|
| Custom field | User-added question on BambooHR application form. | |
| Standard BambooHR field | Built-in compensation field. | |
| Not sure — researcher to verify | Leave for research phase. | ✓ |

**Boolean and keyword fields origin:**

| Option | Description | Selected |
|--------|-------------|----------|
| Custom application questions | Form questions like "Do you have right to work?". | |
| Fixed BambooHR fields | Standard BambooHR applicant fields. | |
| Mix of both | Some custom, some standard. | ✓ |

**Field referencing in config:**

| Option | Description | Selected |
|--------|-------------|----------|
| Human-readable names + fieldMap | Config uses names like `rightToWork`, `city`. fieldMap section maps to BambooHR IDs. | ✓ |
| BambooHR field IDs directly | Raw IDs in config. No mapping layer. | |

---

## Local Dev Testing Approach

**Testing strategy:**

| Option | Description | Selected |
|--------|-------------|----------|
| Real BambooHR API, dry-run safe | Run against real company with DRY_RUN=true. No writes. | ✓ |
| Fixture JSON files | Mock responses stored as JSON. No credentials needed. | |
| Both (fixtures + real API) | Unit tests use fixtures; integration tests hit real API. | |

**User's choice:** Real BambooHR API, dry-run safe

**dotenv support:**

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — .env file for local dev | dotenv loads credentials locally; Docker uses env vars in prod. | ✓ |
| No — env vars only | Manual shell exports. Simpler, no dotenv dependency. | |

**Local run command:**

| Option | Description | Selected |
|--------|-------------|----------|
| npx tsx | `npx tsx src/index.ts` — zero-config, no compile step. | ✓ |
| ts-node with ESM flags | Heavier ESM setup. | |
| Compile first (tsc + node) | `tsc && node dist/index.js`. Same as prod but slow iteration. | |

---

## Claude's Discretion

- TypeScript project structure within `src/` (config/, bamboohr/, rules/, logger/)
- Zod schema design for config validation
- Pagination implementation (depends on API variant — researcher determines)
- HTTP client: `fetch` (Node 22 built-in) preferred over axios/node-fetch

## Deferred Ideas

None — discussion stayed within phase scope.
