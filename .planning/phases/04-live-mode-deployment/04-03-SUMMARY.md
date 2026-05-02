---
phase: 04-live-mode-deployment
plan: "03"
subsystem: documentation
tags: [readme, deployment, cron, docker, compliance, infra]
dependency_graph:
  requires: [04-01, 04-02]
  provides: [INFRA-04]
  affects: []
tech_stack:
  added: []
  patterns: [docker-run-env-file, cron-external-trigger, volume-mount-ro]
key_files:
  created:
    - README.md
  modified: []
decisions:
  - "--env-file pattern for secrets in cron (no inline -e flags) — T-04-15 mitigation"
  - "Absolute docker path /usr/local/bin/docker on macOS, /usr/bin/docker on Linux — cron PATH limitation"
  - ".env.example documented as canonical source-of-truth template for /etc/screener.env"
metrics:
  duration: "2m 51s"
  completed_date: "2026-05-02"
  tasks_completed: 1
  tasks_total: 1
  files_created: 1
  files_modified: 0
---

# Phase 04 Plan 03: Operator README Summary

Wrote operator-facing `README.md` at the project root covering the full deployment story — Docker
build, runtime contract (env-file + config volume mount), dry-run vs LIVE_MODE behaviour,
copy-paste macOS crontab entry, Linux server deployment note, cron log health detection via the
INFRA-03 JSON summary line, and the GDPR/ATS compliance gates. Satisfies INFRA-04.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write README.md with build, run, configuration, and cron sections (INFRA-04) | 493de01 | README.md (244 lines, created) |

## Requirement Satisfied

**INFRA-04:** Copy-paste-ready macOS crontab entry + Linux server deployment note both present.

Exact crontab line shipped (macOS):
```
0 8 * * * /usr/local/bin/docker run --rm --env-file /etc/screener.env -v /etc/screener-config.yaml:/app/config.yaml:ro bamboohr-screener:latest >> /var/log/screener.log 2>&1
```

Linux variant (for `/etc/cron.d/screener`):
```
0 8 * * * root /usr/bin/docker run --rm --env-file /etc/screener.env -v /etc/screener-config.yaml:/app/config.yaml:ro bamboohr-screener:latest >> /var/log/screener.log 2>&1
```

## Verification Results

All 18 grep-based acceptance criteria passed:

- README.md exists at project root (244 lines, well above 80-line minimum)
- First line: `# BambooHR Candidate Screener`
- Section headers present: `## Quick Start`, `## Build`, `## Run`, `## Configuration`, `## Cron Setup`, `## Operating Notes`, `## Compliance`
- Subsections present: `### macOS`, `### Linux server`
- `crontab -e` present
- `--env-file /etc/screener.env` present (exclusive secret injection method)
- `-v /etc/screener-config.yaml:/app/config.yaml:ro` present
- `bamboohr-screener:latest` present (matches Plan 02 image name exactly)
- `0 8 * * *` present (copy-paste cron schedule)
- All five env var names documented: `BAMBOOHR_API_KEY`, `BAMBOOHR_SUBDOMAIN`, `OPENAI_API_KEY`, `LIVE_MODE`, `CONFIG_PATH`
- `ATS settings access` present (BambooHR permission requirement)
- `Data Processing Agreement` present (GDPR compliance note)
- `{"processed"` present (INFRA-03 JSON summary example)
- No TODO/TBD/FIXME/XXX markers
- No actual inline `-e SECRET=value` in cron snippets (one warning line documents this as anti-pattern to avoid — per acceptance criteria, this is allowed)

## Deviations from Plan

None — plan executed exactly as written. README content matches the plan's `<action>` verbatim.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. This plan creates only
documentation. Threat mitigations from the plan's threat model are addressed:

| Threat | Status |
|--------|--------|
| T-04-15: Operator uses inline `-e SECRET=value` | Mitigated — `--env-file` is the only documented secret injection method; the warning line explicitly calls out inline flags as an anti-pattern |
| T-04-16: Out-of-date instructions | Mitigated — README generated alongside Dockerfile in same phase; image name `bamboohr-screener:latest` matches Plan 02 exactly |
| T-04-17: LIVE_MODE without GDPR gate | Mitigated — Compliance section (blockquote) + Quick Start cross-reference both present |
| T-04-18: Failed cron run leaves no audit trail | Mitigated — cron entry includes `>> /var/log/screener.log 2>&1`; Operating Notes explains JSON summary health check |
| T-04-19: /etc/screener.env permissions too open | Mitigated — `chmod 600 /etc/screener.env` and ownership requirements documented in macOS and Linux sections |

## Known Stubs

None. README contains no placeholder text or TODO markers.

## Self-Check: PASSED

- README.md exists: CONFIRMED at `/README.md`
- Commit 493de01 exists: CONFIRMED
- Line count 244 >= 80: CONFIRMED
- All 18 grep checks pass: CONFIRMED
