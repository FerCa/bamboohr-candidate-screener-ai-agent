# syntax=docker/dockerfile:1
# BambooHR Candidate Screener — production image (INFRA-01)
# Multi-stage build: stage 1 compiles TypeScript with devDependencies;
# stage 2 ships only dist/ and runtime deps on node:22-alpine.

# ──────────────────────────────────────────────────────────────────────────────
# Stage 1: build (has devDependencies for tsc)
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS build
WORKDIR /app

# Copy package files first so npm ci layer caches when source changes but deps don't.
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and tsconfig for the TypeScript build.
COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# ──────────────────────────────────────────────────────────────────────────────
# Stage 2: production (no devDependencies, no source .ts)
# ──────────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS production
WORKDIR /app

# Non-root user for runtime (Alpine uses BusyBox addgroup/adduser, not GNU).
RUN addgroup -S screener && adduser -S screener -G screener

# Copy compiled output and package manifests from the build stage.
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
COPY --from=build /app/package-lock.json ./

# Production-only dependencies; leaves devDependencies (tsx, typescript, @types) out.
RUN npm ci --omit=dev

# The container reads CONFIG_PATH from env (defaults to ./config.yaml in src/index.ts).
# Operators mount the config at /app/config.yaml via:
#   docker run --rm --env-file /etc/screener.env \
#     -v /path/to/config.yaml:/app/config.yaml:ro \
#     bamboohr-screener:latest
# Secrets (BAMBOOHR_API_KEY, BAMBOOHR_SUBDOMAIN, OPENAI_API_KEY, LIVE_MODE) come from
# --env-file at runtime — never baked into the image (D-06).

USER screener

# Exec form ENTRYPOINT — process is PID 1, receives SIGTERM cleanly from `docker stop`.
# No CMD: the container has a single execution path with no argument overrides.
ENTRYPOINT ["node", "dist/index.js"]
