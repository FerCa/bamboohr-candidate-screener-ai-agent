# Pitfalls Research

**Domain:** BambooHR candidate screening agent (TypeScript + OpenAI Agents SDK + Docker + cron)
**Researched:** 2026-05-01
**Confidence:** MEDIUM — External lookup tools unavailable; findings drawn from training knowledge (cutoff August 2025). BambooHR API behavior and OpenAI Agents SDK internals are well-documented in training data. Flag any BambooHR-specific claims for manual verification against https://documentation.bamboohr.com before shipping.

---

## Critical Pitfalls

### Pitfall 1: Double-Processing Candidates — No Idempotency Guard

**What goes wrong:**
The agent runs daily via cron. If a candidate is in "New" status and the run crashes after the OpenAI call but before the BambooHR status-move write, or the BambooHR write silently fails, the candidate remains in "New" on the next run and gets re-evaluated. GPT-4o generates a different comment (it is stochastic), a second comment gets posted to BambooHR, and the stage move fires again — possibly conflicting with a recruiter who manually moved the candidate in between.

**Why it happens:**
No persistent state. Each container run is stateless. Without a record of "this candidate ID was already processed," the agent cannot distinguish between truly new candidates and ones that slipped through on a prior run. The BambooHR `GET /v1/applicant_tracking/applications` endpoint returns candidates by current stage, not by "when they entered this stage," so checking the current stage is not a reliable idempotency key.

**How to avoid:**
Write a processed-candidates log to a mounted volume (e.g., `processed.json` with `{ candidateId, applicationId, processedAt, decision }` entries). At run start, load this log and skip any ID already present. Alternatively, use the BambooHR comment API to check if a comment from this agent already exists on the application before posting. A file-based log is simpler and survives container restarts; make the volume mount a first-class requirement in the Docker run command.

**Warning signs:**
- Recruiters report seeing two identical or near-identical automated comments on a single candidate
- Structured logs show the same `applicationId` appearing in two separate run outputs
- BambooHR audit trail shows the same stage transition twice within 24 hours

**Phase to address:**
Phase 1 (BambooHR integration foundation) — bake the idempotency log into the initial data-fetch design before any writes are implemented.

---

### Pitfall 2: BambooHR Pipeline Stage IDs Are Not Human-Readable — Wrong Stage Moves

**What goes wrong:**
BambooHR hiring pipeline stages are identified by integer IDs, not names. The IDs are account-specific and not globally standardized. "Schedule Phone Screen" in one BambooHR account is stage `12`, in another it is stage `7`. The YAML config requires the operator to look up and enter the correct integer IDs. If they enter the wrong IDs — or if a BambooHR admin renames or deletes a stage — the agent silently moves candidates to the wrong stage with no error (BambooHR typically returns HTTP 200 for a valid-but-wrong stage ID that exists in the account).

**Why it happens:**
The BambooHR ATS API uses numeric IDs throughout. There is no API endpoint that returns "the stage named X has ID Y" in a format that can be auto-resolved at runtime without extra calls. Developers assume names are portable.

**How to avoid:**
At startup, call `GET /v1/applicant_tracking/pipelines` (or the equivalent pipeline-fetch endpoint) to retrieve all pipeline stages for the configured job opening. Cross-reference the IDs in the YAML config against the returned stage names and log a startup validation warning if a configured ID is not found or the name does not match expectation. Never trust that a numeric ID is correct without this validation step. Document in the YAML config template that IDs must be obtained from the BambooHR UI or API, not guessed.

**Warning signs:**
- Candidates appear in unexpected stages in BambooHR
- Stage names in the BambooHR UI do not match what the YAML says they should be
- BambooHR admin reports deleted or renamed stages

**Phase to address:**
Phase 1 (BambooHR integration) — add startup config validation that verifies stage IDs resolve to expected names before any writes occur.

---

### Pitfall 3: BambooHR File URL Expiry — PDF Download Fails Silently

**What goes wrong:**
BambooHR attachment URLs (the URLs returned for CV/resume files on applications) are pre-signed, time-limited URLs. They expire — typically within minutes to a few hours of being issued. If the agent fetches the list of candidates, waits or retries, then attempts to download the PDF using a URL fetched earlier in the same run, the download returns HTTP 403 or redirects to an error page. `pdf-parse` then receives HTML error content instead of binary PDF data, produces garbage text or throws, and the CV is either skipped silently or the agent crashes.

**Why it happens:**
Developers treat the attachment URL as a stable resource URL rather than a short-lived signed token. The URL looks like a permanent link but has an embedded expiry (often visible as a `Expires=` or `X-Amz-Expires=` parameter in the query string if BambooHR uses S3-backed storage).

**How to avoid:**
Always download the PDF immediately after fetching the application data — never store the URL for later use. Process each candidate's PDF in the same logical step as fetching their application data. Add a check: if the HTTP response for the PDF is not `Content-Type: application/pdf`, log an error and skip that candidate rather than passing HTML or error text to the parser. Treat PDF download failures as non-fatal per-candidate errors that should be logged and skipped, not as run-stopping crashes.

**Warning signs:**
- `pdf-parse` returning empty string or throwing on candidates who definitely have CVs
- HTTP 403 or redirect responses when downloading attachments
- Intermittent failures that correlate with long run times (many candidates = URL expires by the time you get to it)

**Phase to address:**
Phase 2 (PDF parsing and CV extraction) — validate Content-Type before passing bytes to pdf-parse, and download immediately after fetching application metadata.

---

### Pitfall 4: Image-Only PDFs Return Empty Text — Agent Silently Evaluates Empty CV

**What goes wrong:**
Many candidates scan their CV as an image and export it as PDF. `pdf-parse` (and most Node.js PDF text-extraction libraries) extract embedded text streams — they do not perform OCR. An image-only PDF returns an empty string. The agent then sends an empty CV text to GPT-4o, which evaluates it as a candidate with no experience, no qualifications, nothing — and may confidently mark them as "does not meet criteria" with a plausible-sounding comment. The candidate is moved to "Reviewed" (rejected) when they may have been perfectly qualified.

**Why it happens:**
`pdf-parse` does not fail on image-only PDFs — it succeeds with an empty or near-empty result. No error is raised, so the agent proceeds normally. The LLM cannot distinguish "this person has no content" from "this PDF had no extractable text."

**How to avoid:**
After extraction, check the word count of the extracted text. If fewer than ~50 words are extracted from a PDF that is larger than ~50KB, treat it as a likely image-only PDF. Log a warning, skip the GPT-4o evaluation, and either: (a) leave the candidate in "New" with a comment noting "CV could not be parsed — manual review required," or (b) add a "Needs Manual Review" tag if the BambooHR API supports it. Do not evaluate a candidate on empty text. Document this limitation in the YAML config README.

**Warning signs:**
- Extracted text length is 0 or very short for a non-trivial PDF file size
- High rate of "does not meet criteria" decisions with comments that reference lack of experience, when candidates are plausible applicants

**Phase to address:**
Phase 2 (PDF parsing) — add a post-extraction validation step before any LLM call.

---

### Pitfall 5: OpenAI Agent Loop Does Not Terminate — Runaway Token Cost

**What goes wrong:**
The OpenAI Agents SDK runs a tool-calling loop: the model decides when to call tools and when it is "done." If the agent is poorly prompted or the termination condition is ambiguous, the agent may continue calling tools after it has all the information it needs — re-fetching BambooHR data, re-evaluating candidates already evaluated, or looping through candidates in an unbounded way. With `maxTurns` not explicitly set (or set too high) and a job opening that accumulates many candidates over time, a single run can cost tens of dollars in OpenAI API calls.

**Why it happens:**
Default `maxTurns` in the OpenAI Agents SDK is permissive (or relies on model judgment to stop). Developers focus on making the agent work and defer cost control. The agent's system prompt does not have an explicit "after processing all candidates, output your final summary and stop" instruction.

**How to avoid:**
Set `maxTurns` explicitly — a value like `(number_of_candidates * 3) + 5` is a reasonable ceiling, or use a hardcoded safe maximum like 50 for a daily screener. Structure the agent as a thin orchestrator: fetch the candidate list outside the agent loop (plain API call), then run a separate agent invocation per candidate with a very limited turn budget (e.g., `maxTurns: 4` — fetch CV, evaluate, decide, output). Per-candidate invocations are predictable, cost-bounded, and individually retryable. Log total token usage per run in structured JSON to stdout so cost anomalies are visible.

**Warning signs:**
- Run time exceeds expected ceiling (e.g., more than 2 minutes per candidate)
- OpenAI billing dashboard shows spikes on days the cron runs
- Structured logs show more tool calls than there are candidates
- Agent invocation never returns (the container runs indefinitely)

**Phase to address:**
Phase 3 (Agent orchestration) — implement per-candidate agent invocations with explicit maxTurns from day one. Do not build an open-ended single-agent loop.

---

### Pitfall 6: Timezone Mismatch — Cron Fires at Wrong Time, Candidates Missed

**What goes wrong:**
The macOS crontab uses the local system timezone. The Docker container runs with UTC by default (no TZ environment variable). Logs show timestamps in UTC; the recruiter interprets them as local time. Worse: if the cron is moved to a Linux server in a different timezone, the job fires at the "wrong" local hour. Additionally, BambooHR stores timestamps in the account's configured timezone (which may differ from both the host and Docker), so "applications submitted today" means different things depending on whose clock you use.

**Why it happens:**
Timezone handling is universally underestimated. Developers test locally where cron, Docker, and BambooHR all happen to align, then deploy to a server where they diverge.

**How to avoid:**
Always log timestamps in ISO 8601 UTC format (`new Date().toISOString()`). Set `TZ=UTC` explicitly in the Dockerfile (or as a Docker run `-e` flag) so the container's timezone is always deterministic. Document the system crontab timezone assumption in the README. Use a filter window of "applications updated in the last 48 hours" rather than "applications from today" to avoid edge-case misses at midnight boundaries. The idempotency log (Pitfall 1) prevents double-processing when the window is wider.

**Warning signs:**
- Run logs show timestamps that don't match expected local time
- Candidates who applied at midnight appear in the wrong day's batch
- Moving the cron to a server changes which candidates get processed

**Phase to address:**
Phase 4 (Docker + cron wiring) — set TZ=UTC in Dockerfile and document the assumption, use a safe time window in the BambooHR query.

---

### Pitfall 7: Failed Runs Go Unnoticed — Silent Cron Failures

**What goes wrong:**
cron does not alert on non-zero exit codes by default on macOS unless mail delivery is configured (which it typically is not). If the Docker container fails to start (image not found, env vars missing), crashes mid-run (unhandled exception), or exits with an error, the recruiter simply does not see new candidates moved. The recruiter may assume no new candidates arrived, when in reality the agent crashed on the first candidate. This can persist for days undetected.

**Why it happens:**
The "fire and forget" nature of cron is its default behavior. Developers assume they will notice problems; they do not.

**How to avoid:**
The cron command should redirect both stdout and stderr to a dated log file: `docker run ... >> /var/log/bamboo-screener/$(date +\%Y-\%m-\%d).log 2>&1`. Add a health-check convention: the last line of stdout on a successful run should always be a JSON object with `{ "status": "complete", "processed": N, "errors": M }`. A simple wrapper script can check for this sentinel line and send an alert (email, curl to a webhook) if it is absent. For a locally-run tool, even checking the log file manually once after first deployment is better than nothing.

**Warning signs:**
- No log file created for a given day
- Log file exists but contains only startup lines, no "complete" sentinel
- Recruiter reports no candidates were processed on a day where applications were known to have arrived

**Phase to address:**
Phase 4 (Docker + cron wiring) — implement structured final-status logging and a log-file wrapper from the start.

---

### Pitfall 8: GDPR / Data Privacy — CV Text Sent to OpenAI Without Disclosure

**What goes wrong:**
The agent sends raw CV text (name, address, employment history, education, potentially special category data) to OpenAI's API for processing. This is personal data under GDPR. Unless the company has a Data Processing Agreement (DPA) with OpenAI and candidates have been informed that their data may be processed by third-party AI systems (typically in the job application consent), this constitutes unlawful processing.

**Why it happens:**
Engineering-led projects ship the technical feature without looping in legal or HR. The developer is not the data controller; the recruiter/company is.

**How to avoid:**
Before deploying to production, verify: (1) OpenAI's DPA has been signed (OpenAI offers a DPA for API customers — distinct from ChatGPT ToS); (2) the job application form includes disclosure that applications may be processed by AI tools; (3) only the minimum necessary data is sent (do not send full CV if only specific fields are needed for evaluation); (4) the OpenAI API is called with the opt-out flag for model training if available (`user` parameter, data retention settings). Add a comment in the code at the OpenAI call site referencing the DPA requirement so future developers cannot miss it.

**Warning signs:**
- No DPA found in the company's vendor agreements with OpenAI
- Job application form has no AI processing disclosure
- CV text sent to OpenAI includes fields not needed for the evaluation criteria

**Phase to address:**
Phase 1 (project setup) — this is a pre-deployment blocker, not a code issue. Flag in README and in the YAML config template that legal review is required before production use.

---

### Pitfall 9: Applicant vs. Candidate Terminology Mismatch in BambooHR API

**What goes wrong:**
BambooHR's ATS API distinguishes between "applications" (a submission for a specific job opening), "applicants" (the person), and "candidates" (sometimes used interchangeably, sometimes referring to the applicant record). The API endpoint paths use `applicant_tracking/applications`, `applicant_tracking/applicants`, and `applicant_tracking/jobs`. Developers conflate these and build code that fetches applicants (the person record) when they need applications (the job-specific submission), missing application-specific data like answers to job-specific questions, the current pipeline stage, and the resume attachment for that specific application.

**Why it happens:**
The naming is genuinely confusing and inconsistently documented. Third-party blog posts about the BambooHR API frequently use "candidate" and "applicant" interchangeably, compounding the confusion.

**How to avoid:**
Always read the BambooHR ATS API reference directly. The entity model is: a `Job` has many `Applications`; each `Application` has one `Applicant` (person). Pipeline stage, comments, and attachments live on the `Application`, not on the `Applicant`. Fetch by `GET /v1/applicant_tracking/applications?jobId={id}&status=active` to get the right entity. Never use `applicantId` where `applicationId` is required and vice versa — they are different integer namespaces.

**Warning signs:**
- API calls return data but CV attachment fields are null
- Pipeline stage changes are not reflected after write
- Application-specific answers are missing from the response

**Phase to address:**
Phase 1 (BambooHR integration) — read the API reference and define the entity model explicitly in code comments before writing any integration code.

---

### Pitfall 10: BambooHR API Rate Limiting — No Retry Logic, Run Crashes

**What goes wrong:**
BambooHR's API enforces rate limits. The documented limit is 200 API requests per minute (per API key). For a single job opening with a moderate backlog of candidates, a naive implementation that fires all requests concurrently can hit this limit, receive HTTP 429 responses, and crash if there is no retry logic. The 429 response typically includes a `Retry-After` header, but without explicit handling, the code throws or continues with failed data.

**Why it happens:**
Developers process candidates in a `Promise.all()` for speed, or write sequential code that doesn't bother with backoff because "it'll never hit 200/min for a small job posting." On a backlog-clearing first run (20+ candidates), concurrent PDF downloads plus status updates plus comment posts can easily exceed the limit.

**How to avoid:**
Process candidates sequentially (one at a time in a for-of loop, not Promise.all). For a daily screener, throughput is not the priority — correctness and reliability are. Implement a simple exponential backoff retry wrapper (3 retries, 1s/2s/4s delays) around every BambooHR API call. Log each 429 occurrence so rate limit patterns are visible. Sequential processing of a typical daily batch (5–20 new candidates) will complete well within 2 minutes even with per-candidate retries.

**Warning signs:**
- HTTP 429 responses in logs
- Run crashes or partial processing on days with many new applications
- BambooHR API calls succeed for the first N candidates and fail for the rest

**Phase to address:**
Phase 1 (BambooHR integration) — wrap all API calls in a retry utility from the start, not after observing 429s in production.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Single monolithic agent that fetches + evaluates + writes | Simpler initial code | Untestable, hard to add retry logic, cost unpredictable | Never — split into orchestrator + per-candidate agent |
| Hardcoding stage IDs in source instead of YAML | Faster initial run | Any BambooHR account change requires code change, breaks for new deployments | Never |
| Skipping idempotency log for "v1" | Faster to ship | Double-processing and double-comments in production, very hard to undo | Never — adds 10 lines of code |
| `Promise.all()` for concurrent candidate processing | Faster batch | Rate limit crashes on any run with >10 candidates | Never for a screener — correctness beats speed |
| Passing full CV text to GPT-4o regardless of length | Simplest code path | Token cost blowup on long CVs (some CVs are 10k+ tokens), context window exceeded | Acceptable for MVP if a character truncation cap is added |
| Not validating YAML config at startup | Simpler code | Silent misconfiguration produces wrong stage moves or skipped evaluations | Never — fail fast with clear error messages |

---

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| BambooHR API | Using `Authorization: Basic` with only the API key as username, forgetting the password field | BambooHR Basic auth requires `apiKey:x` (any string as password) — omitting the `:x` causes 401 |
| BambooHR API | Fetching all applications without filtering by job opening ID | Results include applications across all jobs; always filter by `jobId` |
| BambooHR API | Assuming `GET /applications` response includes the resume URL directly | Resume/CV attachment may require a separate `GET /v1/applicant_tracking/applications/{id}` detail call to get attachment metadata, then another call to download |
| BambooHR API | Using the generic employee API for ATS data | ATS data lives under `/v1/applicant_tracking/`, not the main `/v1/` employee endpoints — different data model |
| pdf-parse | Calling `pdf.text` synchronously | pdf-parse is async; must `await pdfParse(buffer)` and access `.text` on the resolved result |
| pdf-parse | Passing a file path string to pdf-parse | pdf-parse requires a `Buffer`, not a path — must `fs.readFileSync()` or fetch the bytes first |
| OpenAI Agents SDK | Assuming the agent stops after the last tool call | The agent continues until it outputs a final message; prompt must explicitly instruct it to return a structured result and stop |
| Docker + env vars | Putting credentials in the Dockerfile `ENV` | Credentials end up in the image layer history; always pass via `docker run -e` or a `.env` file excluded from version control |

---

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Evaluating all candidates concurrently with GPT-4o | All evaluations finish fast but costs spike and rate limits hit | Process sequentially; daily screener does not need parallelism | Any batch >5 candidates with concurrent OpenAI calls |
| Sending full raw CV text without truncation | Occasional OpenAI context window exceeded errors for long CVs | Cap input text at ~6,000 tokens (~24,000 chars) before sending to GPT-4o | CVs with tables, long employment histories, or OCR-extracted multi-page documents |
| Loading the entire processed-candidates log into memory | Fine for 1,000 entries, slow for 10,000+ | Use a simple Set of processed IDs; the log file stays small for a single-job screener | Never a real issue at this project's scale |
| Re-fetching the pipeline stage list on every candidate | Unnecessary API calls, slower runs | Fetch once at startup and cache in memory for the run | Becomes a rate-limit contributor at scale |

---

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Committing `.env` file with API keys to git | API key exposure, unauthorized BambooHR and OpenAI access | Add `.env` to `.gitignore` before first commit; use `.env.example` with placeholder values |
| Logging full CV text to stdout | CV personal data ends up in log aggregation systems, violates GDPR | Log only `applicationId`, `decision`, `criteria_matched` — never CV text content |
| Logging the OpenAI API key in error messages | Key exposure in log files | Catch errors from OpenAI SDK; log the error type and message only, not the request headers |
| YAML config mounted as world-readable volume | Any process on the host can read stage IDs and rules | Restrict volume mount permissions; this is a minor risk for a local setup but matters on a shared server |
| Trusting extracted CV text for SQL or shell operations | Prompt injection if CV content is passed unsanitized into shell commands | Not a risk here (no shell calls with CV text), but relevant if logging infrastructure uses structured queries |

---

## "Looks Done But Isn't" Checklist

- [ ] **Idempotency:** Agent appears to process candidates correctly — verify it skips already-processed candidates on a second run with the same data
- [ ] **Stage validation:** YAML config has stage IDs entered — verify those IDs resolve to the correct stage names by calling the pipeline endpoint at startup
- [ ] **Empty CV handling:** PDF parsing returns text — verify behavior when a real image-only PDF is used (print a CV as image PDF and test)
- [ ] **Error recovery:** Agent processes one candidate successfully — verify it continues to the next candidate after a PDF download failure (does not crash the whole run)
- [ ] **Token logging:** GPT-4o calls work — verify structured logs include `prompt_tokens` and `completion_tokens` per candidate so cost is visible
- [ ] **Cron failure detection:** Cron job is scheduled — verify the log file contains a completion sentinel line after a successful run
- [ ] **Docker timezone:** Container runs correctly locally — verify `TZ` is set and timestamps in logs are UTC
- [ ] **Credential safety:** App works with env vars — verify no credentials appear in `docker inspect`, `docker history`, or log output

---

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Double-processing (comments already posted) | MEDIUM | Manually delete duplicate comments via BambooHR UI; clear the idempotency log; add idempotency before re-running |
| Wrong stage moves (candidates in wrong pipeline stage) | HIGH | Manually review affected candidates in BambooHR UI; move them back to correct stage; add startup stage validation |
| Image-only PDFs evaluated as empty | MEDIUM | Identify affected candidates by checking for "no CV text" log entries; flag them for manual review in BambooHR |
| Agent loop runaway (large OpenAI bill) | HIGH (cost) | Check OpenAI billing; set hard usage limits in OpenAI account settings; implement per-candidate maxTurns immediately |
| Cron silently failing for days | MEDIUM | Review cron logs; manually run the Docker command to verify it works; add completion sentinel logging |
| BambooHR API key rotated, agent stops working | LOW | Update env var in `.env` file and in the cron docker run command; verify no API key in code or Dockerfile |

---

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Double-processing (no idempotency) | Phase 1 — BambooHR integration | Run agent twice against same data; confirm second run processes 0 candidates |
| Wrong stage IDs (no startup validation) | Phase 1 — BambooHR integration | Startup logs show stage name validation output; misconfigured ID produces clear error |
| BambooHR file URL expiry | Phase 2 — PDF parsing | Test with deliberate delay between metadata fetch and PDF download; verify graceful skip |
| Image-only PDF returns empty text | Phase 2 — PDF parsing | Use an image-only test PDF; verify agent logs warning and skips evaluation |
| Agent loop not terminating (no maxTurns) | Phase 3 — Agent orchestration | Verify maxTurns is set; run with a mock candidate and confirm agent exits after N turns |
| Token cost runaway | Phase 3 — Agent orchestration | Log token counts; test with a long CV to verify truncation cap works |
| Timezone mismatch | Phase 4 — Docker + cron wiring | Inspect container with `docker exec ... date`; confirm UTC |
| Silent cron failures | Phase 4 — Docker + cron wiring | Kill run mid-execution; verify no completion sentinel in log; verify alert/detection fires |
| GDPR / data privacy | Phase 1 — Project setup (pre-code) | DPA confirmed in writing; job application form reviewed by legal |
| Applicant vs. application entity confusion | Phase 1 — BambooHR integration | Code review: confirm all stage/comment writes use applicationId not applicantId |
| Rate limiting (no retry logic) | Phase 1 — BambooHR integration | Load test with 20+ candidates; confirm no 429-caused crashes |

---

## Sources

- BambooHR ATS API reference (https://documentation.bamboohr.com/reference) — training data, MEDIUM confidence; verify current rate limits and endpoint paths before implementation
- OpenAI Agents SDK documentation and source (https://github.com/openai/openai-agents-python, TypeScript equivalent) — training data, MEDIUM confidence; verify maxTurns API shape against current SDK version
- `pdf-parse` npm package (https://www.npmjs.com/package/pdf-parse) — training data, HIGH confidence for known limitations (no OCR, async API)
- GDPR Article 28 (Data Processing Agreements) — HIGH confidence; requirement is stable law
- Docker TZ environment variable behavior — HIGH confidence; stable Docker behavior
- macOS crontab timezone behavior — HIGH confidence; stable OS behavior

---
*Pitfalls research for: BambooHR candidate screening agent (TypeScript + OpenAI Agents SDK + Docker)*
*Researched: 2026-05-01*
