#!/usr/bin/env bash

set -euo pipefail

bash scripts/check/frontend.sh
vp test run --coverage
bash scripts/check/rust.sh
