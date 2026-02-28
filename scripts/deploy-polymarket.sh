#!/usr/bin/env bash
set -euo pipefail
REMOTE_HOST="polymarket-box"
REMOTE_DIR="/root/Polymarket-Copy-Trading-Bot"
BRANCH="${1:-main}"

echo "==> Local: status check"
git status --short

echo "==> Local: pushing branch '$BRANCH'"
git push origin "$BRANCH"

echo "==> Remote: pulling latest on $REMOTE_HOST:$REMOTE_DIR"
ssh "$REMOTE_HOST" "set -e; cd '$REMOTE_DIR'; git fetch origin; git checkout '$BRANCH'; git pull --ff-only origin '$BRANCH'; git rev-parse --short HEAD"

echo "✅ Deploy complete"
