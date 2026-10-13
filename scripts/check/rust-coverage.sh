#!/usr/bin/env bash

# Runs the workspace tests under cargo llvm-cov and writes the reports to
# target/llvm-cov: lcov.info, summary.json, and an html/ report.
# Needs cargo-llvm-cov and the llvm-tools-preview rustup component.

set -euo pipefail

# A couple of points under the measured workspace, so a drop fails the run.
fail_under_lines=66

out=target/llvm-cov

# No --branch: branch coverage is unstable on nightly, and with it llvm-cov export crashed
# (segfault) on the CI toolchain while writing the lcov report.
cargo llvm-cov clean --workspace
cargo llvm-cov --workspace --no-fail-fast --no-report

mkdir -p "$out"
cargo llvm-cov report --lcov --output-path "$out/lcov.info"
cargo llvm-cov report --json --summary-only --output-path "$out/summary.json"
cargo llvm-cov report --html --output-dir "$out"
cargo llvm-cov report --summary-only --fail-under-lines "$fail_under_lines"
