#!/bin/bash
set -e

# Get staged Rust files
STAGED_RUST_FILES=$(git diff --cached --name-only --diff-filter=ACM | grep '\.rs$' || true)

if [ -z "$STAGED_RUST_FILES" ]; then
  exit 0
fi

# Format only the staged files (not the entire project)
# rustfmt will automatically use rustfmt.toml from the project root
for file in $STAGED_RUST_FILES; do
  if [ -f "$file" ]; then
    rustfmt "$file"
    git add "$file"
  fi
done
