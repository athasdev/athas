#!/usr/bin/env bash

set -euo pipefail

exec scripts/release/packaging/linux/tarball.sh "$@"
