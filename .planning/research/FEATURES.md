# Feature Research

**Domain:** Automated HR candidate screening agent (internal tool, BambooHR + LLM)
**Researched:** 2026-05-01
**Confidence:** HIGH (domain well understood; BambooHR API patterns from training data + OpenAI Agents SDK; no external sources available in this session)

---

## Feature Landscape

### Table Stakes (Users Expect These)

These are non-negotiable. Missing any one makes the tool unreliable or unsafe to use in a real hiring context.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Fetch candidates in a specific pipeline stage | Without this, no automation is possible | LOW | BambooHR ATS API: `GET /v1/applicants` filtered by jobId + stage. Must handle pagination. |
| Hard rule evaluation (pay ceiling, required fields) | Deterministic criteria must never be misclassified by LLM | LOW | YAML-driven. Evaluate before calling LLM — fail fast, save API cost. |
| CV/resume text extraction from PDF | LLM cannot evaluate soft criteria without reading the resume | MEDIUM | Use `pdf-parse` (Node.js). Handle: no attachment, corrupted PDF, scanned image PDF (no text layer). |
| LLM-based soft criteria evaluation | Reasoning about experience quality, answer relevance, CV coherence | MEDIUM | GPT-4o with structured output (JSON). Soft criteria in YAML fed as prompt context. |
| Move candidate to correct pipeline stage | The whole point — automated disposition | LOW | BambooHR ATS API: `POST /v1/applications/{id}/status` or equivalent stage transition endpoint. |
| Write recruiter comment explaining the decision | Without a comment, recruiters can't audit or trust decisions | MEDIUM | Comment must cite specific matched/unmet criteria. Not "AI said no" — "Missing: 3+ years Python experience". |
| Idempotency / skip already-processed candidates | Re-runs the same day must not re-process and double-comment | MEDIUM | Track processed candidates by ID. Either in-memory per run (since runs are short-lived) or by checking if a comment from the bot already exists. The latter is more robust. |
| Structured JSON logging to stdout | Container orchestration and debugging require structured logs | LOW | Every candidate evaluated, every API call made, every error — logged with candidateId, action, outcome, reason. |
| YAML-based rule configuration | Rules must be changeable without code changes | LOW | Rules file mounted as Docker volume. Schema: hard rules section + soft rules section. |
| Environment variable credential injection | API keys must never be in code or config files | LOW | `BAMBOOHR_API_KEY`, `BAMBOOHR_SUBDOMAIN`, `OPENAI_API_KEY` — read from env at startup, fail fast if missing. |
| Graceful error handling with no silent failures | A crash halfway through must be visible, not swallowed | MEDIUM | Catch all API/LLM errors per candidate, log the error with context, continue processing remaining candidates. Never abort the whole run for one bad candidate. |
| Dry-run mode | Before trusting the agent with real stage changes, operators need to verify decisions | MEDIUM | `DRY_RUN=true` env var: evaluate all candidates, log what would happen, write no stage changes and no comments to BambooHR. |

### Differentiators (Competitive Advantage)

These are what make this specific tool better than a naive implementation. They increase reliability and recruiter trust.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Structured LLM output with confidence scores | Prevents hallucinated verdicts; makes LLM decisions auditable | MEDIUM | Use OpenAI structured outputs (JSON schema) — not free-text parsing. Include per-criterion pass/fail + reason string. |
| Rule validation on startup | Catches misconfigured rules before any API calls are made | LOW | Parse YAML on startup, validate schema, log all rules that will be applied. Fail fast with a clear error if YAML is invalid. |
| Per-candidate processing isolation | One bad PDF or API error must not cascade | LOW | Wrap each candidate in try/catch. Continue to next. Log error with candidateId. |
| Explicit "unknown/unscorable" verdict | When CV is unreadable or LLM returns unexpected output, candidate should not be auto-moved | LOW | Third outcome alongside pass/fail: `NEEDS_HUMAN_REVIEW`. Move to a "Review" stage or leave in New with a comment flagging the issue. |
| Comment templates with consistent structure | Recruiter can scan comments without reading every word | LOW | Fixed comment structure: decision line, then bullet list of matched criteria, then bullet list of unmet criteria. |
| Configurable minimum-pass threshold for soft criteria | Not all soft criteria need to be met — YAML can specify "pass if 3 of 5 soft criteria met" | MEDIUM | Enables nuanced rules without AND-all-or-nothing logic. Requires a scoring approach in the LLM prompt. |
| Pay expectation normalization | Candidates write pay in many formats ("80k", "$80,000/year", "80") | LOW | Normalize to integer before comparing to ceiling. Handle ambiguous formats conservatively (flag for human review). |
| Run summary at exit | A one-line summary of `N passed / M failed / K errors` logged at run end | LOW | Makes cron-driven runs monitorable at a glance from cron output. |
| Retry logic for transient API failures | BambooHR and OpenAI have transient rate-limit / 5xx errors | MEDIUM | Exponential backoff, max 3 retries. Log retry count. If all retries fail, treat as error, continue to next candidate. |
| Config-driven stage ID mapping | Stage IDs in BambooHR are numeric — YAML should use human names that map to IDs | LOW | `stages: schedule_phone_screen: 12345` in YAML. Avoids hardcoded magic numbers in code. |

### Anti-Features (Things to Deliberately NOT Build)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Fully autonomous rejection without dry-run first | Seems efficient | One misconfigured rule silently rejects every candidate. No recovery path. | Require at least one dry-run before enabling live mode. Enforce with a `LIVE_MODE=true` explicit opt-in. |
| Free-text LLM comment generation (no structure) | Seems more natural | Inconsistent, variable length, hard to audit, may leak bias signals in phrasing | Structured comment template: decision + criteria bullets. LLM fills criteria reasons; template controls structure. |
| Scoring/ranking candidates against each other | Seems like useful signal | Introduces relative bias — early candidates ranked lower just because later ones were stronger; illegal in some jurisdictions for initial screening | Evaluate each candidate independently against rules, not relative to other candidates. |
| Storing candidate PII outside BambooHR | Might seem useful for local caching | Data governance violation — candidate data should live in one system of record | Never write candidate data to disk. Process in memory. BambooHR is the source of truth. |
| Auto-emailing candidates | Seems like end-to-end automation | ATS stage changes often trigger BambooHR automated emails already; double-sending confuses candidates and creates legal exposure | Let BambooHR handle candidate communications. This tool moves stages only. |
| Learning rules from past decisions | Seems like it would improve over time | Feedback loops can encode and amplify historical bias into future decisions | Rules are explicitly authored by humans in YAML. Refinement is manual and intentional. |
| UI for rule management | More approachable for non-technical HR | Out of scope for internal tool; YAML with good comments is sufficient; UI adds a whole maintenance surface | Well-documented YAML with schema validation and inline comments. |
| Multi-job monitoring in v1 | Seems like obvious generalization | One job first validates that rules work and errors are handled correctly before multiplying failure surface | Explicit single-job scope. Generalize only after v1 is trusted. |
| Parallel candidate processing | Seems faster | Race conditions on shared state; BambooHR rate limits; harder to debug | Process candidates sequentially. Runs are short-lived; speed is not a constraint. |

---

## Feature Dependencies

```
[YAML config parsing + validation]
    └──requires──> [Hard rule evaluation]
                       └──requires──> [Candidate fetch from BambooHR]

[PDF extraction]
    └──requires──> [Candidate fetch from BambooHR]
    └──feeds──> [LLM soft criteria evaluation]

[LLM soft criteria evaluation]
    └──requires──> [PDF extraction]
    └──requires──> [Hard rule evaluation passes first] (fail-fast: don't call LLM if hard rules fail)

[Stage transition + comment write]
    └──requires──> [LLM soft criteria evaluation]
    └──requires──> [Idempotency check] (must confirm not already processed)

[Dry-run mode]
    └──enhances──> [Stage transition + comment write] (bypasses the write, logs intent instead)

[Structured logging]
    └──enhances──> all features (wraps every action)

[Run summary]
    └──requires──> [Structured logging] (aggregates log events at exit)
```

### Dependency Notes

- **Hard rule evaluation requires candidate fetch:** Self-evident — no data, no evaluation.
- **LLM evaluation requires hard rules to pass first:** Fail-fast pattern. If hard rules fail, the decision is already made; calling the LLM wastes tokens and adds latency.
- **PDF extraction feeds LLM evaluation:** Without CV text, LLM can only evaluate application form answers. This is a degraded but valid fallback — the agent should proceed with what it has and flag the missing CV in the comment.
- **Idempotency check must precede any write:** Checking for existing bot comments requires a comment fetch before stage transition. If already processed, skip all writes.
- **Dry-run mode wraps stage transition + comment write:** It does not skip evaluation — it skips writes only. This is what makes dry-run valuable: you see real decisions, just no side effects.

---

## MVP Definition

### Launch With (v1)

- [ ] Candidate fetch (BambooHR ATS API, single job, "New" stage) — core data acquisition
- [ ] YAML config parsing + startup validation — rule changes without code changes
- [ ] Hard rule evaluation (pay ceiling, required fields, boolean conditions) — cheap, deterministic, fail-fast
- [ ] PDF text extraction from BambooHR attachment URL — enables soft evaluation
- [ ] LLM soft criteria evaluation with structured JSON output — the differentiating capability
- [ ] Idempotency check via existing comment detection — prevents double-processing on re-runs
- [ ] Stage transition to "Schedule Phone Screen" (pass) or "Reviewed" (fail) — the action
- [ ] Recruiter comment with structured format (decision + matched criteria + unmet criteria) — audit trail
- [ ] "Needs human review" path for unscoreable candidates (bad PDF, LLM failure) — safety net
- [ ] Per-candidate error isolation (try/catch, log and continue) — resilience
- [ ] Dry-run mode via `DRY_RUN=true` — mandatory before trusting live mode
- [ ] Structured JSON logging to stdout — observability

### Add After Validation (v1.x)

- [ ] Retry logic with exponential backoff — add once rate-limit errors are observed in practice
- [ ] Configurable minimum-pass threshold for soft criteria — add if AND-all-or-nothing proves too strict in practice
- [ ] Run summary log line at exit — low-effort improvement to daily cron output readability
- [ ] Pay expectation normalization for edge-case formats — add if format variance is observed

### Future Consideration (v2+)

- [ ] Multi-job monitoring — defer until single-job is trusted and rule management is stable
- [ ] Slack/email run summaries — defer; stdout is sufficient for now
- [ ] Web UI for rule management — defer; YAML works fine for internal tool
- [ ] Confidence score thresholds per criterion — defer; adds complexity to prompt engineering before value is proven

---

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Candidate fetch (BambooHR API) | HIGH | LOW | P1 |
| Hard rule evaluation | HIGH | LOW | P1 |
| PDF text extraction | HIGH | MEDIUM | P1 |
| LLM soft criteria evaluation | HIGH | MEDIUM | P1 |
| Structured recruiter comment | HIGH | LOW | P1 |
| Stage transition | HIGH | LOW | P1 |
| Dry-run mode | HIGH | LOW | P1 |
| Idempotency check | HIGH | LOW | P1 |
| Per-candidate error isolation | HIGH | LOW | P1 |
| Structured JSON logging | MEDIUM | LOW | P1 |
| YAML rule config + startup validation | HIGH | LOW | P1 |
| "Needs human review" outcome | MEDIUM | LOW | P1 |
| Retry with exponential backoff | MEDIUM | MEDIUM | P2 |
| Run summary on exit | LOW | LOW | P2 |
| Pay normalization for edge cases | MEDIUM | LOW | P2 |
| Configurable soft criteria threshold | MEDIUM | MEDIUM | P2 |
| Multi-job monitoring | HIGH | HIGH | P3 |
| Slack/email summaries | LOW | MEDIUM | P3 |
| Rule learning from past decisions | LOW | HIGH | Anti-feature |

**Priority key:**
- P1: Must have for launch
- P2: Should have, add when possible
- P3: Nice to have, future consideration

---

## Compliance and Bias Considerations

This section replaces a competitor analysis, since this is an internal tool not a product.

### What Must Be True for Legal/Ethical Safety

| Consideration | Risk if Ignored | Mitigation Built In |
|---------------|-----------------|---------------------|
| Rules must be job-related | Rejecting on non-job-related criteria violates EEOC and EU anti-discrimination law | Rules are authored by humans in YAML; tool does not invent criteria |
| No proxy discrimination | Rules that seem neutral can screen out protected classes (e.g., requiring specific school names, gaps in work history) | Out of scope for tool to enforce — but PITFALLS.md should flag this; rule authors bear responsibility |
| Audit trail required | Many jurisdictions require records of how automated decisions were made | Structured comment + JSON log provides per-candidate decision record |
| Human remains in the loop | Fully autonomous rejection without human review creates legal exposure | Dry-run mode; "needs human review" outcome; comments explain reasoning so recruiter can override |
| No candidate PII stored outside BambooHR | Data retention obligations; GDPR Article 5 | Process in memory only; no disk writes of candidate data |
| Consistent criteria application | Applying different rules to different candidates is discriminatory | Rules applied identically from YAML config; no per-candidate rule modification |

### What the Tool Deliberately Cannot Guarantee

- That the rules configured in YAML are themselves fair or legal — this is the rule author's responsibility.
- That GPT-4o does not introduce bias when evaluating soft criteria — LLM outputs can reflect training data biases. Mitigation: structured output constrains what the LLM can say; prompt instructs evaluation against specific criteria only; human reviews borderline cases.
- That PDF text extraction preserves all relevant information from visually formatted CVs.

---

## Sources

- BambooHR ATS API: Training knowledge (REST API, stage transitions, applicant data model, comment endpoints) — MEDIUM confidence; verify exact endpoint paths against BambooHR API docs during implementation
- OpenAI structured outputs / JSON schema enforcement: Training knowledge through August 2025 — HIGH confidence for GPT-4o capability
- EEOC / EU anti-discrimination law in hiring automation: General domain knowledge — MEDIUM confidence; jurisdiction-specific legal review recommended before production deployment
- pdf-parse Node.js library: Training knowledge — MEDIUM confidence; verify active maintenance status during implementation
- ATS automation patterns (idempotency, dry-run, fail-fast, per-record isolation): General software engineering patterns applied to this domain — HIGH confidence

---

*Feature research for: BambooHR candidate screening agent (internal tool)*
*Researched: 2026-05-01*
