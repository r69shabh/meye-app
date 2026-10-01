#!/bin/bash
# Run manually on the owner's Mac after inspecting the source. Never backdates.
set -euo pipefail
cd "$(dirname "$0")/.."
command -v gh >/dev/null || { echo 'Install GitHub CLI (gh), then run gh auth login.'; exit 1; }
handle=$(gh api user --jq .login)
[[ "$handle" == r69shabh ]] || { echo "Signed in as $handle, not r69shabh. Stop and switch accounts."; exit 1; }
if gh repo view r69shabh/meye-ios >/dev/null 2>&1; then
  echo 'r69shabh/meye-ios already exists. Stop to avoid overwriting it.'; exit 1
fi
if [[ ! -d .git ]]; then
  git init -b main
  git add .
  git commit -m 'Start native SwiftUI Meye iOS port'
fi
gh repo create r69shabh/meye-ios --private --source=. --remote=origin --push
