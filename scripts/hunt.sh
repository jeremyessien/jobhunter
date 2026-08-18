#!/usr/bin/env bash
# Scheduled hunt. launchd runs this; it must not assume an interactive shell.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f .env.local ]; then
  set -a
  # shellcheck disable=SC1091
  source .env.local
  set +a
fi
exec pnpm jobhunter hunt
