#!/usr/bin/env bash

# Pass --coverage to run the tests under cargo llvm-cov instead of plain
# cargo test, as CI does, so the workspace is only compiled for tests once.

set -euo pipefail

cargo fmt --check --all
cargo check --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings

if [[ "${1:-}" == "--coverage" ]]; then
  bash scripts/check/rust-coverage.sh
else
  cargo test --workspace --no-fail-fast
fi
bun scripts/generate-bindings.ts --check
