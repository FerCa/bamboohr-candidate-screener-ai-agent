---
slug: install-script
created: 2026-05-02
status: in-progress
---

# install.sh — post-clone setup script

## Goal
Create `install.sh` in repo root that automates setup after a clean clone on macOS.

## Steps
1. Check Docker is installed — fail with clear message if not
2. Check `.env` exists — fail if missing
3. Check required env vars in `.env` (BAMBOOHR_API_KEY, BAMBOOHR_SUBDOMAIN, OPENAI_API_KEY) — list missing vars and fail
4. Build Docker image (`bamboohr-screener`) — always rebuilds
5. Register daily cron at 11am using absolute paths for `--env-file` and `-v config.yaml` — idempotent (removes previous entry before adding)

## Decisions
- macOS only (crontab)
- .env and config.yaml assumed at repo root
- Cron fires at 11:00 AM daily (`0 11 * * *`)
- Idempotency: strip lines containing `bamboohr-screener` from crontab before adding
- Script made executable (chmod +x) as part of the file
