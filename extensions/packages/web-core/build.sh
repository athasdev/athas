#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
PKG_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Building web-core package tarballs..."

# Expect lsp/node_modules to be present (install with Bun beforehand)
if [ ! -d "$PKG_DIR/lsp/node_modules" ]; then
  echo "[WARN] lsp/node_modules not found. Run 'bun init -y && bun add <servers>' under lsp/ first." >&2
fi

for platform in darwin-arm64 darwin-x64 linux-x64 win32-x64; do
  name="web-core-$platform.tar.gz"
  tmpdir="$(mktemp -d)"
  mkdir -p "$tmpdir/lsp"
  cp -R "$PKG_DIR/lsp/node_modules" "$tmpdir/lsp/" 2>/dev/null || true
  (cd "$tmpdir" && tar -czf "$PKG_DIR/$name" .)
  rm -rf "$tmpdir"
  echo "Created $name"
done

echo "Updating checksums in extension.json..."
bun run "$ROOT_DIR/www/scripts/update-checksums.ts"
echo "Done."

