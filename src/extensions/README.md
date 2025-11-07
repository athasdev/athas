# Extension System

Athas uses a VSCode/Zed-style extension system where each language extension bundles its LSP server, eliminating the need for users to manually install language servers.

## Architecture

### Extension Package Structure

```
src/extensions/
├── bundled/              # Pre-bundled extensions shipped with app
│   ├── typescript/
│   │   ├── extension.json    # Extension manifest
│   │   ├── lsp/              # LSP server binaries
│   │   │   ├── typescript-language-server-darwin
│   │   │   ├── typescript-language-server-linux
│   │   │   └── typescript-language-server.exe
│   │   └── icon.svg
│   └── rust/
│       ├── extension.json
│       ├── lsp/
│       │   ├── rust-analyzer-darwin
│       │   ├── rust-analyzer-linux
│       │   └── rust-analyzer.exe
│       └── icon.svg
├── registry/             # Extension registry/loader
│   └── extension-registry.ts
└── types/               # Type definitions
    └── extension-manifest.ts
```

## Extension Manifest

Each extension has an `extension.json` manifest defining its capabilities:

```json
{
  "id": "athas.rust",
  "name": "Rust",
  "displayName": "Rust Language Support",
  "description": "Rust language support with rust-analyzer",
  "version": "1.0.0",
  "publisher": "Athas",
  "categories": ["Language"],
  "languages": [
    {
      "id": "rust",
      "extensions": [".rs"],
      "aliases": ["Rust", "rs"]
    }
  ],
  "lsp": {
    "server": {
      "darwin": "./lsp/rust-analyzer-darwin",
      "linux": "./lsp/rust-analyzer-linux",
      "win32": "./lsp/rust-analyzer.exe"
    },
    "args": [],
    "fileExtensions": [".rs"],
    "languageIds": ["rust"],
    "initializationOptions": {
      "cargo": {
        "buildScripts": { "enable": true }
      }
    }
  },
  "commands": [
    {
      "command": "rust.restart",
      "title": "Restart Rust Analyzer"
    }
  ]
}
```

## Extension Registry

The `ExtensionRegistry` class manages all extensions:

```typescript
import { extensionRegistry } from "@/extensions/registry/extension-registry";

// Get extension by file path
const extension = extensionRegistry.getExtensionByFileExtension(".rs");

// Get LSP server path for a file
const serverPath = extensionRegistry.getLspServerPath("/path/to/file.rs");

// Get LSP server arguments
const serverArgs = extensionRegistry.getLspServerArgs("/path/to/file.rs");

// Check if LSP is supported
const isSupported = extensionRegistry.isLspSupported("/path/to/file.rs");
```

## How It Works

1. **Extension Loading**: Bundled extensions are automatically loaded on app startup
2. **Platform Detection**: Registry detects the current platform (darwin/linux/win32)
3. **LSP Resolution**: When opening a file, the registry finds the matching extension and resolves the correct LSP server binary
4. **Dynamic LSP Start**: Frontend passes server path and args to Rust backend, which starts the LSP server
5. **No Manual Setup**: Users don't need to install anything - LSP servers are bundled with the app

## Adding New Extensions

To add a new language extension:

1. Create extension directory: `src/extensions/bundled/[language]/`
2. Add `extension.json` manifest
3. Add platform-specific LSP binaries in `lsp/` directory
4. Import manifest in `extension-registry.ts`
5. The extension will be automatically available

Example for Python:

```
src/extensions/bundled/python/
├── extension.json
├── lsp/
│   ├── pyright-darwin
│   ├── pyright-linux
│   └── pyright.exe
└── icon.svg
```

## Benefits

- ✅ **Zero Setup**: Users don't install language servers manually
- ✅ **Consistent**: Same LSP version for all users
- ✅ **Cross-Platform**: Automatic platform detection
- ✅ **Isolated**: Each extension has its own LSP server
- ✅ **Extensible**: Easy to add new languages
- ✅ **Reliable**: No dependency on global installations

## Future Enhancements

- Extension marketplace for community extensions
- Extension auto-updates
- WASM-based extensions for sandboxing
- Extension API for custom functionality
- Extension settings UI
