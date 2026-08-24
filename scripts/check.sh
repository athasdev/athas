#!/usr/bin/env bash

set -euo pipefail

bash scripts/check/frontend.sh
vp test run
bash scripts/check/rust.sh
