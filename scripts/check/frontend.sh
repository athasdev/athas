#!/usr/bin/env bash

set -euo pipefail

bun check:services
vp check
