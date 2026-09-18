#!/usr/bin/env bash
# Push this tree to https://github.com/SJL20/Diamond_Tourney
# Needs GitHub credentials on THIS machine (gh auth, or GH_TOKEN / GITHUB_TOKEN).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEST="${GITHUB_DEST:-https://github.com/SJL20/Diamond_Tourney.git}"
BRANCH="${GITHUB_BRANCH:-main}"
TOKEN="${GH_TOKEN:-${GITHUB_TOKEN:-}}"

cd "$ROOT"

if [[ -n "$TOKEN" ]]; then
  DEST="https://x-access-token:${TOKEN}@github.com/SJL20/Diamond_Tourney.git"
elif command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  :
else
  cat <<EOF >&2
No GitHub login in this environment.

On a machine that can push to SJL20 (your Mac):

  curl -L -o diamond-tourney.bundle "PREVIEW_URL/diamond-tourney.bundle"
  git clone https://github.com/SJL20/Diamond_Tourney.git
  cd Diamond_Tourney
  git fetch ../diamond-tourney.bundle main
  git reset --hard FETCH_HEAD
  git push --force origin main

Or set GH_TOKEN to a classic PAT with repo scope and re-run this script.
EOF
  exit 1
fi

git remote remove github 2>/dev/null || true
git remote add github "$DEST"
git push --force github "HEAD:${BRANCH}"
echo "Pushed $(git rev-parse --short HEAD) to $DEST ${BRANCH}"
