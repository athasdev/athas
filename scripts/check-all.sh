#!/usr/bin/env bash

set -euo pipefail

bash scripts/check-frontend.sh
bunx vp test run
bash scripts/check-rust.sh
