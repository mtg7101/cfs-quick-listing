#!/usr/bin/env bash
# One-time bootstrap on the deployment host (10.0.0.179).
#
# Run this once as the cfserver user:
#   bash scripts/server-bootstrap.sh
#
# Afterwards, drop a real .env into ~/apps/cfs-quick-listing/.env containing
# at minimum AGENT_ENDPOINT_URL, AGENT_PROJECT, GOOGLE_AGENT_CREDENTIALS_JSON,
# then `pm2 start ecosystem.config.cjs && pm2 save`.

set -euo pipefail

mkdir -p "$HOME/apps" "$HOME/apps/cfs-quick-listing/logs"

if ! command -v node >/dev/null 2>&1; then
  echo "Node 20+ is required. Install via Homebrew or NodeSource and re-run." >&2
  exit 1
fi

if ! command -v pm2 >/dev/null 2>&1; then
  npm install -g pm2 >/dev/null
fi

cd "$HOME/apps"
if [ ! -d cfs-quick-listing ]; then
  git clone https://github.com/mtg7101/cfs-quick-listing cfs-quick-listing
fi
cd cfs-quick-listing
npm ci --omit=optional || npm install --omit=optional

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Edit $(pwd)/.env with the agent credentials, then re-run pm2 start."
  exit 0
fi

pm2 start ecosystem.config.cjs --update-env || pm2 reload ecosystem.config.cjs --update-env
pm2 save
pm2 startup launchd -u "$USER" --hp "$HOME" >/dev/null 2>&1 || true

echo "Bootstrap complete. Service is on port \${PORT:-4100}."
