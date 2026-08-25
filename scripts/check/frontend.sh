#!/usr/bin/env bash

set -euo pipefail

bun check:services
bun check:zustand
bun check:ui-contracts
bun scripts/check/tailwind-architecture.ts
vp check
