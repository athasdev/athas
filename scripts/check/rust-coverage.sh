#!/usr/bin/env bash

# Runs the workspace tests under cargo llvm-cov and writes the reports to
# target/llvm-cov: lcov.info, summary.json, and an html/ report.
# Needs cargo-llvm-cov and the llvm-tools-preview rustup component.

set -euo pipefail

# A couple of points under the measured workspace, so a drop fails the run.
fail_under_lines=41

out=target/llvm-cov

cargo llvm-cov clean --workspace
cargo llvm-cov --workspace --branch --no-fail-fast --no-report

mkdir -p "$out"
cargo llvm-cov report --branch --lcov --output-path "$out/lcov.info"
cargo llvm-cov report --branch --json --summary-only --output-path "$out/summary.json"
cargo llvm-cov report --branch --html --output-dir "$out"
cargo llvm-cov report --branch --summary-only --fail-under-lines "$fail_under_lines"
