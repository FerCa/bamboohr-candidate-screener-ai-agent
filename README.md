# BambooHR Candidate Screener AI Agent

Automated daily screening agent that monitors a BambooHR job opening for new candidates,
evaluates them against YAML-defined rules (hard rules deterministically, soft rules via
GPT-4o), and moves them to the configured pass/fail pipeline stages with a structured
recruiter comment. Runs as a short-lived Docker container triggered by `cron`.

**Stack:** TypeScript 5 / Node.js 22 LTS · `@openai/agents` · `pdf-parse` · `js-yaml` + `zod` · `node:22-alpine` Docker image.

**Default mode:** dry-run. The container makes zero BambooHR writes and zero OpenAI calls
unless `LIVE_MODE=true` is explicitly set.

---

## Quick Start

```bash
# 1. Build the image
docker build -t bamboohr-screener:latest .

# 2. Copy the env template and fill in real values
cp .env.example /etc/screener.env
# then edit /etc/screener.env with your real BAMBOOHR_API_KEY, BAMBOOHR_SUBDOMAIN, OPENAI_API_KEY

# 3. Dry-run against the live BambooHR API (still no writes — LIVE_MODE is unset by default)
docker run --rm \
  --env-file /etc/screener.env \
  -v "$(pwd)/config.yaml:/app/config.yaml:ro" \
  bamboohr-screener:latest

# 4. When ready to go live, set LIVE_MODE=true in /etc/screener.env (see Compliance below first)
```

The final stdout line of every run is a JSON summary:

```json
{"processed":3,"pass":1,"fail":1,"needsReview":1,"errors":0}
```

---

## Build

The image is a multi-stage `node:22-alpine` build (see `Dockerfile`). Stage 1 installs all
dependencies and runs `tsc`; stage 2 ships only `dist/` and runtime deps.

```bash
docker build -t bamboohr-screener:latest .
```

The image runs as a non-root user (`screener`) with `ENTRYPOINT ["node", "dist/index.js"]`
in exec form so the process is PID 1 and receives `SIGTERM` cleanly from `docker stop`.

## Run

### Required environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `BAMBOOHR_API_KEY` | yes | — | BambooHR Basic-auth username. Must have ATS settings access for the write endpoints (`postComment`, `moveStage`). Exits 1 if unset. |
| `BAMBOOHR_SUBDOMAIN` | yes | — | Your BambooHR company subdomain (e.g. `acme` for `acme.bamboohr.com`). Exits 1 if unset. |
| `OPENAI_API_KEY` | yes (live runs) | — | Used by `@openai/agents` for soft-rule evaluation. Not consulted in dry-run (CR-01 fix). |
| `LIVE_MODE` | no | unset | Set to the literal string `true` to enable BambooHR writes AND OpenAI calls. Any other value (including absent) keeps dry-run. |
| `CONFIG_PATH` | no | `./config.yaml` | Path inside the container. Set to `/app/config.yaml` when mounting via `-v`. |

Secrets are passed via `--env-file` at `docker run` time (see [Cron Setup](#cron-setup)) —
NEVER baked into the image with `ENV` directives, NEVER passed inline as `-e KEY=value` in
cron entries (which would expose them in shell history and cron logs).

### Required volume mount

The YAML rules file is mounted into the container at runtime:

```bash
-v /absolute/path/to/config.yaml:/app/config.yaml:ro
```

The `:ro` flag makes the mount read-only — the container never writes to the config.

### Dry-run vs LIVE_MODE

**Dry-run** (default — `LIVE_MODE` unset or any value other than `"true"`):
- Fetches candidates from BambooHR
- Evaluates hard rules deterministically
- Downloads CV PDFs and extracts text (Phase 2)
- SKIPS the OpenAI soft-rule evaluation (CR-01 — synthesizes a placeholder result)
- SKIPS all BambooHR write calls (`postComment`, `moveStage`)
- Logs every candidate decision as JSON to stdout
- Emits the INFRA-03 summary line as the final stdout line

**LIVE_MODE=true:**
- All of the above, PLUS:
- Calls `@openai/agents` to evaluate soft rules with GPT-4o for candidates that passed hard rules
- Posts a recruiter comment on every processed application (D-04 — pass, fail, needsReview)
- Moves the candidate to the configured pass/fail pipeline stage
- Hard-rule fails are also moved (to the fail/reviewed stage) with a `FAIL — Hard rules` comment (D-05)
- Comment is posted BEFORE the stage move; if the comment POST fails, the stage move is NOT attempted (D-03 atomicity)

## Configuration

Edit `config.yaml` in the project root (or your own copy mounted at `/app/config.yaml`).
See `config.yaml` for the full schema; key sections:

- `job.openingId` — BambooHR job opening ID this run targets
- `job.stages.intake` — pipeline stage name fetched from
- `job.stages.pass` — destination stage for soft-eval pass
- `job.stages.fail` — destination stage for fail, hard-rule fail, AND needsReview (per D-01)
- `hardRules` — deterministic pre-filter (salary ceiling, required fields, boolean / keyword)
- `softRules.required` and `softRules.optional` — GPT-4o evaluation criteria
- `fieldMap` — maps logical field names to BambooHR API JSON paths

Stage names in `config.yaml` are validated against the live BambooHR API at startup
(CONF-02). If any name does not match a live stage, the container exits 1 before any
candidate is processed.

## Cron Setup

The container is designed to be triggered by an external cron (no internal scheduler).
Each run processes all currently-`intake`-stage candidates and exits.

### macOS

1. Save your secrets to `/etc/screener.env` (or any path the cron user can read):

   ```bash
   sudo cp .env.example /etc/screener.env
   sudo chmod 600 /etc/screener.env
   sudo $EDITOR /etc/screener.env
   ```

   Required contents (all four MUST be set; uncomment `LIVE_MODE=true` only after the
   compliance gate is cleared — see [Compliance](#compliance)):

   ```
   BAMBOOHR_API_KEY=<your-api-key>
   BAMBOOHR_SUBDOMAIN=<your-subdomain>
   OPENAI_API_KEY=<your-openai-key>
   CONFIG_PATH=/app/config.yaml
   # LIVE_MODE=true
   ```

2. Place your rules file somewhere stable (e.g. `/etc/screener-config.yaml`) so cron can
   mount the same path daily:

   ```bash
   sudo cp config.yaml /etc/screener-config.yaml
   ```

3. Install the daily cron entry with `crontab -e` and add this line — copy-paste exactly:

   ```cron
   # Run BambooHR candidate screener daily at 08:00 local time
   0 8 * * * /usr/local/bin/docker run --rm --env-file /etc/screener.env -v /etc/screener-config.yaml:/app/config.yaml:ro bamboohr-screener:latest >> /var/log/screener.log 2>&1
   ```

   Notes:
   - `/usr/local/bin/docker` is the absolute path to Docker on macOS (cron's PATH is minimal — relative `docker` may not resolve). Verify with `which docker` and adjust if your install differs.
   - `>> /var/log/screener.log 2>&1` captures BOTH stdout (JSON log records and the INFRA-03 summary) and stderr (mode banner, diagnostic messages) into one file.
   - `--rm` ensures the container is removed after exit so cron does not accumulate stopped containers.

4. Verify the next day:

   ```bash
   tail -1 /var/log/screener.log
   # Expected: {"processed":N,"pass":N,"fail":N,"needsReview":N,"errors":N}
   ```

   If the last line of any run is NOT a parseable JSON object with those five keys, the
   run failed before completing the loop. Check the lines above for the error.

### Linux server

The same `docker run` command works on any Linux host with Docker installed. The only
differences from the macOS instructions:

- The Docker binary is typically `/usr/bin/docker` (not `/usr/local/bin/docker`). Verify with `which docker`.
- cron syntax is the same. Use `crontab -e` for a per-user entry, or drop a file in
  `/etc/cron.d/` for a system-wide one (the `/etc/cron.d/screener` file would have a
  `user` field added between the schedule and the command):

  ```cron
  0 8 * * * root /usr/bin/docker run --rm --env-file /etc/screener.env -v /etc/screener-config.yaml:/app/config.yaml:ro bamboohr-screener:latest >> /var/log/screener.log 2>&1
  ```

- File permissions: `/etc/screener.env` should be `chmod 600` and owned by the user that
  runs the cron job (root for `/etc/cron.d/`).
- Time zone: cron honors the system time zone. Confirm with `date` before scheduling.

## Operating Notes

- **Idempotency is not yet implemented** (SAFE-03 deferred to v2). Re-running the
  container against a stage that has already been processed will re-comment and re-move
  candidates that are still in the intake stage. In practice the daily cron leaves no
  candidates in `intake` after a successful run, so re-runs are safe — but a manual
  re-trigger between cron runs may double-comment any candidate that was somehow left
  behind.
- **Health detection:** parse the final line of stdout for the JSON summary
  (`{"processed":...,"errors":N}`). If `errors > 0`, the run had per-candidate failures
  that did not abort the loop (SAFE-01 isolation). If the JSON line is missing entirely,
  the run aborted before completion.
- **First-run discovery:** if `config.yaml` `fieldMap` contains `REPLACE_WITH...`
  placeholders, the container logs the application detail JSON structure on the first
  candidate so you can fill in real BambooHR field paths.
- **Logs do not contain raw CV text or candidate PII beyond what the recruiter comment
  already includes.** CV text flows only through memory during processing (GDPR).

## Compliance

> **Before setting `LIVE_MODE=true` against real candidates, the following are required:**
>
> 1. A signed Data Processing Agreement (DPA) with OpenAI — required under GDPR because
>    candidate CVs are sent to OpenAI for soft-rule evaluation.
> 2. The job application form must disclose to candidates that submitted data may be
>    processed by AI tools.
>
> These are legal requirements, not implementation tasks. They cannot be resolved in code.

Additionally, the BambooHR API key used must have ATS settings access — without that
permission level, the `postComment` and `moveStage` write endpoints return HTTP 403 and
every candidate in a LIVE_MODE run will be counted as an `error`. Verify the key
permission in BambooHR Settings → API Keys before flipping `LIVE_MODE=true`.

## Project Structure

```
.
├── src/
│   ├── index.ts                # Entry point — startup, candidate loop, write guards (Phase 4)
│   ├── bamboohr/client.ts      # BambooHR REST client — get, post, postComment, moveStage
│   ├── config/                 # YAML schema (Zod) + fail-fast loader
│   ├── rules/                  # Hard-rule evaluator + types
│   ├── pipeline/               # PDF download + text extraction
│   ├── agent/                  # @openai/agents soft-rule evaluator
│   └── logger/                 # JSON-line decision/evaluation loggers
├── Dockerfile                  # Multi-stage node:22-alpine build (Phase 4)
├── .dockerignore               # Build context exclusions (Phase 4)
├── config.yaml                 # Rules + stage configuration (operator-edited)
├── .env.example                # Template for /etc/screener.env
└── .planning/                  # GSD planning artifacts (excluded from Docker image)
```

See `CLAUDE.md` for engineering constraints (`applicationId` not `applicantId`, ESM
NodeNext `.js` imports, dry-run default, etc.) and `.planning/PROJECT.md` for full
project context.
