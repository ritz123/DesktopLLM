#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ "$(git branch --show-current)" != "main" ]]; then
  echo "Release from the main branch."
  exit 1
fi

if [[ -n "$(git status --short)" ]]; then
  echo "Commit or stash changes before releasing."
  exit 1
fi

git fetch origin main
if [[ "$(git rev-list --count HEAD..origin/main)" -ne 0 ]]; then
  echo "Local main is behind origin/main. Pull changes before releasing."
  exit 1
fi

npm version minor -m "chore: release v%s"
git push origin main --follow-tags
