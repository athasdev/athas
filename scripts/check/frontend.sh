#!/usr/bin/env bash

set -euo pipefail

bun check:services
bun check:zustand
bun typecheck
bunx vp check
