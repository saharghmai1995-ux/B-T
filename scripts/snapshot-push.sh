#!/usr/bin/env bash
# Snapshot & push workflow for NeoBet Quant Pro -> github.com/saharghmai1995-ux/B-T
# Usage:
#   ./scripts/snapshot-push.sh "commit message"
#   GITHUB_TOKEN=ghp_xxx ./scripts/snapshot-push.sh "commit message"   (first time / CI)
set -euo pipefail
cd "$(dirname "$0")/.."

MSG="${1:-snapshot: update dashboard}"
REMOTE_URL="https://github.com/saharghmai1995-ux/B-T.git"

if [ -n "${GITHUB_TOKEN:-}" ]; then
  git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/saharghmai1995-ux/B-T.git"
else
  git remote set-url origin "$REMOTE_URL"
fi

git add -A
if git diff --cached --quiet; then
  echo "Nothing to commit."
else
  git commit -m "$MSG"
fi

git push origin main
echo "Snapshot pushed: $(git log --oneline -1)"
