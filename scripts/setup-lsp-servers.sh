#!/bin/bash

# Script to download and setup LSP servers for bundled extensions
# This should be run before building the app

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
EXTENSIONS_DIR="$PROJECT_DIR/src/extensions/bundled"

echo "Setting up LSP servers for bundled extensions..."
echo ""

# Function to detect platform
detect_platform() {
  case "$(uname -s)" in
    Darwin*)  echo "darwin" ;;
    Linux*)   echo "linux" ;;
    MINGW*|MSYS*|CYGWIN*) echo "win32" ;;
    *)        echo "unknown" ;;
  esac
}

PLATFORM=$(detect_platform)
echo "Detected platform: $PLATFORM"
echo ""

# TypeScript Language Server
echo "📦 Setting up TypeScript Language Server..."
TS_LSP_DIR="$EXTENSIONS_DIR/typescript/lsp"

if command -v typescript-language-server &> /dev/null; then
  echo "✓ typescript-language-server found in PATH"
  TS_LSP_PATH=$(which typescript-language-server)

  # Copy to extension directory based on platform
  case "$PLATFORM" in
    darwin)
      cp "$TS_LSP_PATH" "$TS_LSP_DIR/typescript-language-server-darwin"
      chmod +x "$TS_LSP_DIR/typescript-language-server-darwin"
      echo "✓ Copied to darwin binary"
      ;;
    linux)
      cp "$TS_LSP_PATH" "$TS_LSP_DIR/typescript-language-server-linux"
      chmod +x "$TS_LSP_DIR/typescript-language-server-linux"
      echo "✓ Copied to linux binary"
      ;;
    win32)
      cp "$TS_LSP_PATH" "$TS_LSP_DIR/typescript-language-server.exe"
      echo "✓ Copied to windows binary"
      ;;
  esac
else
  echo "⚠️  typescript-language-server not found!"
  echo "   Install it with: npm install -g typescript-language-server typescript"
  echo "   Or: bun add -g typescript-language-server typescript"
fi

echo ""

# Rust Analyzer
echo "📦 Setting up Rust Analyzer..."
RUST_LSP_DIR="$EXTENSIONS_DIR/rust/lsp"

if command -v rust-analyzer &> /dev/null; then
  echo "✓ rust-analyzer found in PATH"
  RUST_LSP_PATH=$(which rust-analyzer)

  # Copy to extension directory based on platform
  case "$PLATFORM" in
    darwin)
      cp "$RUST_LSP_PATH" "$RUST_LSP_DIR/rust-analyzer-darwin"
      chmod +x "$RUST_LSP_DIR/rust-analyzer-darwin"
      echo "✓ Copied to darwin binary"
      ;;
    linux)
      cp "$RUST_LSP_PATH" "$RUST_LSP_DIR/rust-analyzer-linux"
      chmod +x "$RUST_LSP_DIR/rust-analyzer-linux"
      echo "✓ Copied to linux binary"
      ;;
    win32)
      cp "$RUST_LSP_PATH" "$RUST_LSP_DIR/rust-analyzer.exe"
      echo "✓ Copied to windows binary"
      ;;
  esac
else
  echo "⚠️  rust-analyzer not found!"
  echo "   Install it with: rustup component add rust-analyzer"
  echo "   Or download from: https://github.com/rust-lang/rust-analyzer/releases"
fi

echo ""
echo "✅ LSP server setup complete!"
echo ""
echo "Note: This script only sets up LSP servers for your current platform ($PLATFORM)."
echo "For cross-platform builds, you'll need to manually download binaries for other platforms."
