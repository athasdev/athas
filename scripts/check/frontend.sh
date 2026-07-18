#!/usr/bin/env bash

set -euo pipefail

bun check:services
bun typecheck
bunx vp check
