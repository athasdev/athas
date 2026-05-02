#!/usr/bin/env bash

set -euo pipefail

bash scripts/check/frontend.sh
bunx vp test run
bun scripts/check-zig.ts
bash scripts/check/rust.sh
