#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="bamboohr-screener"
ENV_FILE="${REPO_DIR}/.env"
CONFIG_FILE="${REPO_DIR}/config.yaml"

echo "==> BambooHR Candidate Screener — Setup"
echo ""

# 1. Check Docker is installed
if ! command -v docker &>/dev/null; then
  echo "Error: Docker is not installed."
  echo "Install Docker Desktop from https://www.docker.com/products/docker-desktop/ and try again."
  exit 1
fi
echo "[ok] Docker found: $(docker --version)"

# 2. Check .env exists
if [ ! -f "${ENV_FILE}" ]; then
  echo ""
  echo "Error: .env file not found at ${ENV_FILE}"
  echo "Copy .env.example to .env and fill in your credentials, then re-run this script."
  exit 1
fi
echo "[ok] .env file found"

# 3. Check required env vars are present and non-empty in .env
REQUIRED_VARS=(BAMBOOHR_API_KEY BAMBOOHR_SUBDOMAIN OPENAI_API_KEY)
MISSING=()
for var in "${REQUIRED_VARS[@]}"; do
  if ! grep -qE "^${var}=.+" "${ENV_FILE}"; then
    MISSING+=("$var")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo ""
  echo "Error: The following required variables are missing or empty in .env:"
  for var in "${MISSING[@]}"; do
    echo "  - $var"
  done
  exit 1
fi
echo "[ok] All required env vars present"

# 4. Build Docker image
echo ""
echo "==> Building Docker image (${IMAGE_NAME})..."
docker build -t "${IMAGE_NAME}" "${REPO_DIR}"
echo "[ok] Docker image built"

# 5. Register cron job (idempotent — removes previous entry first)
# Use full path to docker so cron's minimal PATH doesn't cause "command not found"
DOCKER_BIN="$(command -v docker)"
CRON_CMD="0 11 * * * ${DOCKER_BIN} run --rm --env-file ${ENV_FILE} -v ${CONFIG_FILE}:/app/config.yaml ${IMAGE_NAME}"
(crontab -l 2>/dev/null | grep -v "${IMAGE_NAME}" || true; echo "${CRON_CMD}") | crontab -
echo "[ok] Cron job registered: daily at 11:00 AM"

echo ""
echo "==> Setup complete."
echo ""
echo "    The screener will run every day at 11:00 AM."
echo "    To run manually:  docker run --rm --env-file ${ENV_FILE} -v ${CONFIG_FILE}:/app/config.yaml ${IMAGE_NAME}"
echo "    To remove cron:   crontab -e"
