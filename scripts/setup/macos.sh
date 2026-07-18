#!/usr/bin/env bash

set -euo pipefail

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

if ! command -v bun >/dev/null 2>&1; then
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
fi

bun install

echo "Athas development environment is ready. Run bun dev to start the app."
