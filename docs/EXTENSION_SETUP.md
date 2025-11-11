# Extension System Setup Guide

This guide explains how to set up and develop the extension system in Athas.

## Quick Start

### 1. Install LSP Servers

Before building the app, you need to set up the bundled LSP servers:

```bash
# Install TypeScript Language Server
npm install -g typescript-language-server typescript
# OR
bun add -g typescript-language-server typescript

# Install Rust Analyzer
rustup component add rust-analyzer
```

### 2. Run Setup Script

```bash
# From the project root
./scripts/setup-lsp-servers.sh
```

This script will:
- Detect your platform (macOS, Linux, Windows)
- Copy LSP server binaries to the appropriate extension directories
- Make binaries executable

### 3. Build and Run

```bash
# Development
bun tauri dev

# Production build
bun tauri build
```

## How It Works

### Architecture

```
User Opens File (example.rs)
    ↓
Frontend: Extension Registry
    ├─ Detects file extension (.rs)
    ├─ Finds Rust extension
    └─ Gets LSP server path: ./extensions/bundled/rust/lsp/rust-analyzer-darwin
    ↓
Rust Backend: LSP Manager
    ├─ Receives server path from frontend
    ├─ Resolves bundled resource path
    ├─ Starts LSP server process
    └─ Initializes language server protocol
    ↓
LSP Server Running
    ├─ Provides completions
    ├─ Sends diagnostics
    └─ Handles hover info
```

### Directory Structure

```
src/extensions/
├── bundled/                      # Pre-bundled extensions
│   ├── typescript/
│   │   ├── extension.json       # Extension manifest
│   │   └── lsp/                 # LSP binaries (not in git)
│   │       ├── .gitkeep
│   │       ├── typescript-language-server-darwin  # macOS
│   │       ├── typescript-language-server-linux   # Linux
│   │       └── typescript-language-server.exe     # Windows
│   └── rust/
│       ├── extension.json
│       └── lsp/
│           ├── .gitkeep
│           ├── rust-analyzer-darwin
│           ├── rust-analyzer-linux
│           └── rust-analyzer.exe
├── registry/
│   └── extension-registry.ts   # Extension loader and manager
└── types/
    └── extension-manifest.ts   # TypeScript type definitions
```

## Adding a New Language Extension

### Example: Adding Python Support

1. **Create extension directory:**

```bash
mkdir -p src/extensions/bundled/python/lsp
touch src/extensions/bundled/python/lsp/.gitkeep
```

2. **Create extension manifest:**

`src/extensions/bundled/python/extension.json`:
```json
{
  "id": "athas.python",
  "name": "Python",
  "displayName": "Python Language Support",
  "description": "Python language support with Pyright",
  "version": "1.0.0",
  "publisher": "Athas",
  "categories": ["Language"],
  "languages": [
    {
      "id": "python",
      "extensions": [".py", ".pyw"],
      "aliases": ["Python", "py"]
    }
  ],
  "lsp": {
    "server": {
      "darwin": "./lsp/pyright-darwin",
      "linux": "./lsp/pyright-linux",
      "win32": "./lsp/pyright.exe"
    },
    "args": ["--stdio"],
    "fileExtensions": [".py", ".pyw"],
    "languageIds": ["python"]
  },
  "commands": [
    {
      "command": "python.restart",
      "title": "Restart Python Server",
      "category": "Python"
    }
  ],
  "activationEvents": ["onLanguage:python"]
}
```

3. **Import in registry:**

Edit `src/extensions/registry/extension-registry.ts`:

```typescript
import pythonManifest from "../bundled/python/extension.json";

// Add to bundledManifests array:
const bundledManifests: ExtensionManifest[] = [
  typescriptManifest as ExtensionManifest,
  rustManifest as ExtensionManifest,
  pythonManifest as ExtensionManifest, // Add this
];
```

4. **Update setup script:**

Edit `scripts/setup-lsp-servers.sh` to add Python LSP installation:

```bash
# Python Language Server (Pyright)
echo "📦 Setting up Pyright..."
PYTHON_LSP_DIR="$EXTENSIONS_DIR/python/lsp"

if command -v pyright-langserver &> /dev/null; then
  # Copy binary logic...
fi
```

5. **Test:**

```bash
./scripts/setup-lsp-servers.sh
bun tauri dev
```

## Cross-Platform Builds

The setup script only installs LSP servers for your current platform. For cross-platform builds:

### Option 1: Manual Download

Download binaries for each platform and place them in the correct locations:

```
src/extensions/bundled/typescript/lsp/
├── typescript-language-server-darwin   # macOS binary
├── typescript-language-server-linux    # Linux binary
└── typescript-language-server.exe      # Windows binary
```

### Option 2: CI/CD

Set up GitHub Actions or similar to:
1. Build on macOS, Linux, and Windows runners
2. Download platform-specific LSP binaries
3. Bundle everything into platform-specific releases

## Troubleshooting

### LSP Server Not Found

**Error:** `Failed to start LSP: No such file or directory`

**Solution:**
```bash
# Check if LSP binaries exist
ls -la src/extensions/bundled/*/lsp/

# Re-run setup script
./scripts/setup-lsp-servers.sh
```

### Permission Denied

**Error:** `Permission denied when executing LSP server`

**Solution:**
```bash
# Make binaries executable
chmod +x src/extensions/bundled/typescript/lsp/*
chmod +x src/extensions/bundled/rust/lsp/*
```

### Wrong Platform Binary

**Error:** LSP server crashes or won't start

**Solution:**
- Ensure you're using the correct binary for your platform
- Check that the binary is not corrupted
- Verify binary architecture matches your system (x86_64 vs arm64)

## Development Tips

### Testing Extensions

```typescript
// In browser console or component:
import { extensionRegistry } from "@/extensions/registry/extension-registry";

// Check loaded extensions
console.log(extensionRegistry.getAllExtensions());

// Check LSP support for a file
console.log(extensionRegistry.isLspSupported("/path/to/file.rs"));

// Get LSP server path
console.log(extensionRegistry.getLspServerPath("/path/to/file.rs"));
```

### Debug LSP Communication

Check Rust logs:
```bash
# Tauri will show LSP server output in dev console
# Look for lines starting with "LSP"
```

### Extension Hot Reload

Extensions are loaded at app startup. To reload:
1. Restart the app
2. Or implement hot reload in `extension-registry.ts`

## Best Practices

1. **Keep binaries small** - Use stripped/optimized binaries
2. **Version LSP servers** - Document which version is bundled
3. **Test on all platforms** - Ensure binaries work everywhere
4. **Document dependencies** - Note if LSP needs runtime deps
5. **Handle errors gracefully** - Don't crash if LSP fails

## Future Enhancements

- [ ] Extension marketplace
- [ ] Auto-update LSP servers
- [ ] WASM-based LSP servers
- [ ] Extension sandboxing
- [ ] Extension settings UI
- [ ] Extension discovery/search
