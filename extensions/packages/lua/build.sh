#!/usr/bin/env bash
set -euo pipefail

PKG_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$(dirname "$0")/../../../.." && pwd)"
echo "Building lua tools tarballs..."

for platform in darwin-arm64 darwin-x64 linux-x64 win32-x64; do
  name="lua-$platform.tar.gz"
  tmpdir="$(mktemp -d)"
  mkdir -p "$tmpdir/lsp"
  for bin in lua-language-server stylua luacheck; do
    src="$PKG_DIR/lsp/${bin}-$platform"
    [ "$platform" = "win32-x64" ] && src+=".exe" || true
    if [ -f "$src" ]; then
      cp "$src" "$tmpdir/lsp/" || true
      chmod +x "$tmpdir/lsp/"* || true
    else
      echo "[WARN] Missing $src"
    fi
  done
  (cd "$tmpdir" && tar -czf "$PKG_DIR/$name" .)
  rm -rf "$tmpdir"
  echo "Created $name"
done

echo "Updating checksums in extension.json..."
bun run "$ROOT_DIR/www/scripts/update-checksums.ts"
echo "Done."

