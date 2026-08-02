#!/usr/bin/env bash

set -euo pipefail

REQUIRED_BUN_VERSION="1.3.14"

version_at_least() {
  local current="${1%%-*}"
  local minimum="${2%%-*}"
  local current_major current_minor current_patch
  local minimum_major minimum_minor minimum_patch

  IFS=. read -r current_major current_minor current_patch <<< "$current"
  IFS=. read -r minimum_major minimum_minor minimum_patch <<< "$minimum"

  (( current_major > minimum_major )) ||
    (( current_major == minimum_major && current_minor > minimum_minor )) ||
    (( current_major == minimum_major && current_minor == minimum_minor && current_patch >= minimum_patch ))
}

if ! xcode-select -p >/dev/null 2>&1; then
  xcode-select --install
  echo "Install the Xcode Command Line Tools, then run bun setup again."
  exit 1
fi

if ! command -v cargo >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
fi

if [[ -f "$HOME/.cargo/env" ]]; then
  source "$HOME/.cargo/env"
fi

if ! command -v bun >/dev/null 2>&1 || ! version_at_least "$(bun --version)" "$REQUIRED_BUN_VERSION"; then
  curl -fsSL https://bun.com/install | bash -s "bun-v$REQUIRED_BUN_VERSION"
  export PATH="$HOME/.bun/bin:$PATH"
fi

bun install

echo "Athas development environment is ready. Run bun dev to start the app."
