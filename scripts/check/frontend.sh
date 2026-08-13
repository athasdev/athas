#!/usr/bin/env bash

set -euo pipefail

bun check:services
bun check:zustand
bun check:ui-contracts
bun typecheck
bunx vp check
