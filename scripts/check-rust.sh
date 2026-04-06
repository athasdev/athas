#!/usr/bin/env bash

set -euo pipefail

cargo fmt --check --all
cargo check --workspace
