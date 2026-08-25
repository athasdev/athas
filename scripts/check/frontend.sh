#!/usr/bin/env bash

set -euo pipefail

bun check:services
bun check:zustand
bun scripts/check/tailwind-architecture.ts
vp check
