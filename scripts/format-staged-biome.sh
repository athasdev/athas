#!/bin/bash
set -e

# Get staged TypeScript, JavaScript, and JSON files
STAGED_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx|json)$' || true)

if [ -z "$STAGED_FILES" ]; then
  exit 0
fi

# Format only the staged files using biome
for file in $STAGED_FILES; do
  if [ -f "$file" ]; then
    # let it just exit with true even if it fails since we are handling
    # lint after all of this runs in `lint-staged`
    bunx biome check --write --unsafe "$file" || true
    git add "$file"
  fi
done
