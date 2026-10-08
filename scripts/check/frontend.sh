#!/usr/bin/env bash

set -euo pipefail

bun check:services
bun check:design
vp check
# Feature boundary ratchet and the other check-script tests (fast, no app tests).
vp test run scripts/check/tests
