# Extension Development

This guide explains how the extension system works and how to add new extensions.

## Overview

Athas supports multiple extension categories:

| Category | Examples | Current State |
|----------|----------|---------------|
| **Languages** | TypeScript, PHP, Python | Bundled + downloadable |
| **Themes** | Ayu, Nord, Dracula | Bundled (JSON files) |
| **Icon Themes** | Material, Seti, Minimal | Bundled (TSX components) |

### Language Extensions (Three-Tier System)

| Tier | Example | What It Provides | Storage |
|------|---------|------------------|---------|
| **Bundled** | TypeScript | Full LSP + syntax | Ships with app |
| **Packaged** | Python, Go, Rust | Syntax highlighting only | IndexedDB |
| **Full** | PHP | Full LSP + syntax + snippets | Filesystem |

**Current state:**
- TypeScript is bundled with LSP
- 30+ languages have syntax highlighting via tree-sitter
- PHP is the first downloadable full extension with LSP

## Architecture

```
src/extensions/
├── bundled/                    # Bundled language extensions
│   └── typescript/
├── languages/
│   ├── manifests/              # Syntax-only definitions (30+ langs)
│   ├── full-extensions.ts      # Downloadable extensions with LSP
│   └── language-packager.ts    # Manifest converter
├── themes/
│   ├── builtin/                # Color themes (JSON)
│   ├── theme-registry.ts       # Theme management
│   └── types.ts                # Theme types
├── icon-themes/
│   ├── builtin/                # Icon themes (TSX)
│   ├── icon-theme-registry.ts  # Icon theme management
│   └── types.ts                # Icon theme types
├── registry/
│   ├── extension-registry.ts   # Bundled extension loader
│   └── extension-store.ts      # Zustand store
├── installer/
│   └── extension-installer.ts  # Download logic
└── types/
    └── extension-manifest.ts   # TypeScript types
```

---

## Adding a Language Extension

### Option 1: Syntax Only (Simple)

Add a manifest to `src/extensions/languages/manifests/`:

```json
{
  "id": "language.python",
  "name": "Python",
  "version": "1.0.0",
  "description": "Python syntax highlighting",
  "category": "language",
  "author": "Athas Team",
  "capabilities": {
    "languageProvider": {
      "id": "python",
      "extensions": ["py", "pyw"],
      "aliases": ["python"],
      "wasmPath": "/tree-sitter/parsers/tree-sitter-python.wasm",
      "highlightQuery": "/tree-sitter/queries/python/highlights.scm"
    }
  }
}
```

WASM and queries are downloaded from CDN on first use.

### Option 2: Full Extension with LSP

**1. Add to `full-extensions.ts`:**

```typescript
{
  id: "athas.php",
  name: "PHP",
  displayName: "PHP Language Support",
  lsp: {
    server: {
      darwin: "lsp/intelephense-darwin-arm64",
      linux: "lsp/intelephense-linux-x64",
      win32: "lsp/intelephense-win32-x64.exe",
    },
    args: ["--stdio"],
    fileExtensions: [".php"],
    languageIds: ["php"],
  },
  installation: {
    platformArch: {
      "darwin-arm64": {
        downloadUrl: "https://athas.dev/extensions/packages/php/php-darwin-arm64.tar.gz",
        size: 54525952,
        checksum: "...",
      },
      // ... other platforms
    },
  },
}
```

**2. Create package** in `www/public/extensions/packages/php/`:

```
php/
├── extension.json
├── snippets.json
├── queries/highlights.scm
├── parsers/tree-sitter-php.wasm
├── lsp/
│   ├── intelephense-darwin-arm64
│   ├── intelephense-darwin-x64
│   ├── intelephense-linux-x64
│   └── intelephense-win32-x64.exe
└── build.sh
```

**3. Build platform packages** and upload to CDN.

---

## Adding a Theme

Add a JSON file to `src/extensions/themes/builtin/`:

```json
{
  "name": "my-theme",
  "displayName": "My Theme",
  "description": "A custom theme",
  "author": "Your Name",
  "version": "1.0.0",
  "category": "dark",
  "colors": {
    "primary-bg": "#1e1e1e",
    "secondary-bg": "#252526",
    "text": "#d4d4d4",
    "accent": "#007acc",
    "syntax-keyword": "#569cd6",
    "syntax-string": "#ce9178"
  }
}
```

Register in `src/extensions/themes/theme-initializer.ts`.

---

## Adding an Icon Theme

Icon themes are TSX components in `src/extensions/icon-themes/builtin/`:

```typescript
export const myIconTheme: IconThemeDefinition = {
  id: "my-icons",
  name: "My Icons",
  description: "Custom icon theme",
  getFileIcon: (fileName, isDir, isExpanded, isSymlink) => {
    // Return icon based on file type
    if (isDir) return { icon: <FolderIcon /> };
    if (fileName.endsWith(".ts")) return { icon: <TypeScriptIcon /> };
    return { icon: <FileIcon /> };
  },
};
```

Register in `src/extensions/icon-themes/icon-theme-initializer.ts`.

---

## How Installation Works

When a user opens a file needing an uninstalled extension:

1. Store checks if extension is installed
2. Dispatches `extension-install-needed` event
3. Toast shows: "Install PHP?"
4. On install:
   - **Syntax-only**: WASM → IndexedDB
   - **Full**: tar.gz → Filesystem (via Tauri)
5. Syntax highlighting triggers

## Platform Support

Full extensions support:
- `darwin-arm64` / `darwin-x64`
- `linux-x64` / `linux-arm64`
- `win32-x64`

---

## What's Next

- **Auto-updates**: CDN registry with version checking
- **Multi-LSP choice**: Pick between LSP servers per language
- **Community marketplace**: GitHub-based extension registry
- **Downloadable themes**: Themes as installable extensions
