#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PACKAGE_DIR="$SCRIPT_DIR"

echo "Building PHP extension package..."

# Install build dependencies
echo "Installing build dependencies..."
cd "$PACKAGE_DIR/build"
npm install

# Build standalone binaries for all platforms
echo "Building standalone Intelephense binaries..."
npm run build:all

# Download tree-sitter-php.wasm if not exists
if [ ! -f "$PACKAGE_DIR/parsers/tree-sitter-php.wasm" ]; then
  echo "Downloading tree-sitter-php.wasm..."
  curl -L "https://github.com/nickvdyck/nickvdyck.github.io/raw/master/tree-sitter/tree-sitter-php.wasm" \
    -o "$PACKAGE_DIR/parsers/tree-sitter-php.wasm"
fi

# Create platform-specific tar.gz packages
echo "Creating platform-specific packages..."

for platform in darwin-arm64 darwin-x64 linux-x64 win32-x64; do
  echo "Creating php-$platform.tar.gz..."

  TEMP_DIR=$(mktemp -d)

  # Copy common files
  cp "$PACKAGE_DIR/extension.json" "$TEMP_DIR/"
  cp "$PACKAGE_DIR/snippets.json" "$TEMP_DIR/"
  cp -r "$PACKAGE_DIR/queries" "$TEMP_DIR/"
  cp -r "$PACKAGE_DIR/parsers" "$TEMP_DIR/"

  # Copy platform-specific LSP binary
  mkdir -p "$TEMP_DIR/lsp"
  if [ "$platform" = "win32-x64" ]; then
    cp "$PACKAGE_DIR/lsp/intelephense-$platform.exe" "$TEMP_DIR/lsp/"
  else
    cp "$PACKAGE_DIR/lsp/intelephense-$platform" "$TEMP_DIR/lsp/"
    # Make LSP binary executable
    chmod +x "$TEMP_DIR/lsp/intelephense-$platform"
  fi

  # Create tar.gz
  cd "$TEMP_DIR"
  tar -czvf "$PACKAGE_DIR/php-$platform.tar.gz" .

  # Cleanup
  rm -rf "$TEMP_DIR"
done

echo ""
echo "Build complete! Package files created:"
ls -lh "$PACKAGE_DIR"/*.tar.gz

echo ""
echo "Upload these to athas.dev/extensions/packages/php/"
