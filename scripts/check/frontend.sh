#!/usr/bin/env bash

set -euo pipefail

bun check:services
bun check:design
vp check
