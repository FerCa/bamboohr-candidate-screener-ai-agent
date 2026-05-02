---
phase: 04-live-mode-deployment
plan: 02
status: complete
subsystem: infrastructure
tags: [docker, multi-stage-build, infra, security, non-root]
dependency_graph:
  requires: []
  provides: [Dockerfile, .dockerignore, INFRA-01]
  affects: [04-03-README]
tech_stack:
  added: [node:22-alpine multi-stage Docker build]
  patterns: [multi-stage-dockerfile, non-root-container-user, exec-form-entrypoint, npm-ci-reproducible-install]
key_files:
  created: [Dockerfile, .dockerignore]
  modified: []
decisions:
  - "Multi-stage build: build stage uses devDependencies for tsc; production stage uses --omit=dev to exclude tsx/typescript/@types"
  - "Non-root user via Alpine BusyBox addgroup/adduser (not GNU shadow-utils — Alpine difference)"
  - "Exec-form ENTRYPOINT with no CMD: single fixed execution path, node runs as PID 1 for clean SIGTERM handling"
  - ".env.example retained in build context via !.env.example negation after .env.* exclusion"
  - ".claude/ added to .dockerignore beyond plan spec — prevents agent worktree metadata from leaking into image"
metrics:
  duration: "~5 minutes"
  completed_at: "2026-05-02T08:38:28Z"
  tasks_total: 3
  tasks_completed: 3
  tasks_pending: 0
requirements_satisfied: [INFRA-01]
---

# Phase 4 Plan 2: Docker Image Packaging Summary

**One-liner:** Multi-stage node:22-alpine Dockerfile with non-root screener user, exec-form ENTRYPOINT, and .dockerignore keeping secrets/host artifacts out of the image.

**Status:** COMPLETE — All 3 tasks verified.

## What Was Built

### Task 1: Multi-stage Dockerfile (commit b1e3381)

`Dockerfile` at project root implementing INFRA-01:

- **Build stage** (`AS build`): `node:22-alpine`, installs all deps via `npm ci`, copies `tsconfig.json` + `src/`, runs `npm run build` (= `tsc`) to produce `dist/`.
- **Production stage** (`AS production`): Fresh `node:22-alpine` base. Creates system group/user `screener`. Copies only `dist/`, `package.json`, `package-lock.json` from build stage. Runs `npm ci --omit=dev` for production-only dependencies. Sets `USER screener`. Uses exec-form `ENTRYPOINT ["node", "dist/index.js"]`.
- No `EXPOSE`, `CMD`, or `ENV` with credentials.

### Task 2: .dockerignore (commit f0540a9)

`.dockerignore` at project root preventing host artifacts and secrets from entering the build context:

| Excluded | Reason |
|----------|--------|
| `node_modules/` | macOS ABI-incompatible with Alpine; rebuilt by `npm ci` in container |
| `dist/` | Stale host build output; rebuilt in build stage |
| `.env`, `.env.*` | Secrets — injected at runtime via `--env-file` (D-06) |
| `!.env.example` | Re-included after `.env.*` — safe reference file, no secrets |
| `.git/`, `.planning/`, `.claude/` | Repo metadata, planning docs — no runtime value; `.claude/` added beyond plan spec to exclude agent worktree metadata |
| `*.md` | Documentation — no runtime value |
| `Dockerfile`, `.dockerignore` | Container build files — no runtime value |

Files intentionally NOT excluded (build stage requires them):
- `tsconfig.json`, `package.json`, `package-lock.json`, `src/`

## Threat Mitigations Applied

| Threat ID | Status | Evidence |
|-----------|--------|---------|
| T-04-08: Secrets baked into image layers | Mitigated | `.env`, `.env.*` excluded from build context. `!.env.example` negation correct. No `ENV BAMBOOHR_API_KEY` in Dockerfile. |
| T-04-09: Stale host node_modules in image | Mitigated | `node_modules/` excluded. Both stages run `npm ci` independently. |
| T-04-10: Planning docs leaking into image | Mitigated | `.planning/`, `.claude/`, `*.md`, `.git/` excluded. |
| T-04-11: Container running as root | Mitigated | `addgroup -S screener && adduser -S screener -G screener` + `USER screener` in production stage. |
| T-04-12: SIGTERM not received (shell-wrapped ENTRYPOINT) | Mitigated | Exec-form `ENTRYPOINT ["node", "dist/index.js"]` — node is PID 1, no shell wrapper. |

## Deviations from Plan

### Auto-added: `.claude/` in .dockerignore

- **Rule:** Rule 2 — missing critical functionality
- **Found during:** Task 2
- **Issue:** The plan's `.dockerignore` spec included `.planning/` but not `.claude/`, which contains the GSD worktree metadata including agent execution history. This is internal architecture data with no runtime value that should not leak into a published image.
- **Fix:** Added `.claude/` line to `.dockerignore` alongside `.planning/`.
- **Files modified:** `.dockerignore`
- **Commit:** f0540a9

No other deviations — plan executed as written.

## Task 3: Human Verification — Passed

`docker build` executed and verified by operator on 2026-05-02:

| Check | Result |
|-------|--------|
| `docker build -t bamboohr-screener:latest .` | ✓ Both stages completed, named to `docker.io/library/bamboohr-screener:latest` |
| Entrypoint | `[node dist/index.js]` ✓ |
| User | `screener` ✓ |
| Image size | 93,313,382 bytes (~89MB) ✓ |
| `docker run --rm` with no config | Exits 1 with `[config] Failed to read or parse config file: ./config.yaml` ✓ |
| Secrets in image layers | `no secrets in image — OK` ✓ |

## Self-Check

- [x] `Dockerfile` exists at project root
- [x] `grep -c 'FROM node:22-alpine' Dockerfile` = 2
- [x] `AS build` and `AS production` stages present
- [x] `RUN addgroup -S screener && adduser -S screener -G screener` present
- [x] `USER screener` present
- [x] `ENTRYPOINT ["node", "dist/index.js"]` (exec-form) present
- [x] `npm ci --omit=dev` present
- [x] `COPY --from=build /app/dist ./dist` present
- [x] Zero `EXPOSE` lines, zero `CMD` lines
- [x] No `ENV` lines with credentials
- [x] `.dockerignore` exists at project root
- [x] `node_modules/`, `.env`, `.env.*`, `dist/`, `.git/`, `.planning/`, `*.md`, `Dockerfile`, `.dockerignore` all excluded
- [x] `!.env.example` present and appears after `.env.*`
- [x] `tsconfig.json`, `package.json`, `src/` NOT excluded
- [x] Commits b1e3381 and f0540a9 exist

## Self-Check: PASSED
