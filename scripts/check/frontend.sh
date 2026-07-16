#!/usr/bin/env bash

set -euo pipefail

bun services:check
bun typecheck
bunx vp check
