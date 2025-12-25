# Extension Development

This guide explains how the unified extension system works and how to add new extensions.

## Overview

Athas uses a unified extension system where all extensions share the same manifest format. Extensions are categorized by type:

| Category | Description | Examples |
|----------|-------------|----------|
| **Language** | Syntax highlighting, LSP, formatters, linters, snippets | TypeScript, PHP, Python |
| **Theme** | Editor color schemes with light/dark variants | One Dark, Dracula, Nord |
| **Icon Theme** | File and folder icons | Material Icons, Minimal |

### Bundled Extensions

These extensions ship with Athas:

**Languages (7):** TypeScript, JSON, YAML, TOML, Markdown, HTML, CSS

**Themes (8):** One (Light/Dark), Dracula, Nord, Catppuccin, GitHub (Light/Dark), Solarized (Light/Dark), Tokyo Night, Vitesse (Light/Dark)

**Icon Themes (3):** Material, Minimal, Seti

### Extension Storage

| Type | Bundled | Downloadable |
|------|---------|--------------|
| **Languages** | Ships with app | IndexedDB (syntax) / Filesystem (LSP) |
| **Themes** | Ships with app | IndexedDB |
| **Icon Themes** | Ships with app | IndexedDB |

## Architecture

```
src/extensions/
├── core/                     # Unified extension system
│   ├── index.ts              # Public exports
│   ├── types.ts              # Unified ExtensionManifest type
│   ├── registry.ts           # Single registry for all extensions
│   ├── store.ts              # Zustand store for extension state
│   └── providers/            # Extension activation
│       ├── index.ts
│       ├── language-provider.ts
│       ├── theme-provider.ts
│       └── icon-theme-provider.ts
│
├── bundled/                  # Built-in extensions
│   ├── languages/            # TypeScript, JSON, YAML, etc.
│   ├── themes/               # One, Dracula, Nord, etc.
│   └── icon-themes/          # Material, Minimal, Seti
│
├── installer/                # Download and installation
│   └── extension-installer.ts
│
└── hooks/                    # React integration
```

---

## Extension Manifest Format

All extensions use a single `extension.json` manifest format:

```json
{
  "id": "athas.extension-name",
  "name": "Extension Name",
  "displayName": "Full Display Name",
  "description": "Description of the extension",
  "version": "1.0.0",
  "publisher": "Athas",
  "license": "MIT",
  "category": "language | theme | icon-theme",
  "bundled": true,
  "capabilities": { ... },
  "installation": { ... }
}
```

### Required Fields

| Field | Description |
|-------|-------------|
| `id` | Unique identifier (e.g., `athas.typescript`) |
| `name` | Short name |
| `displayName` | Full display name |
| `description` | Brief description |
| `version` | Semver version |
| `publisher` | Publisher name |
| `category` | `language`, `theme`, or `icon-theme` |
| `capabilities` | Category-specific configuration |

### Optional Fields

| Field | Description |
|-------|-------------|
| `bundled` | `true` if ships with app |
| `license` | License identifier |
| `icon` | Path to icon |
| `installation` | Download info for non-bundled extensions |

---

## Language Extensions

Language extensions provide syntax highlighting and optionally LSP support, formatters, linters, and snippets.

### Syntax-Only Language

```json
{
  "id": "athas.yaml",
  "name": "YAML",
  "displayName": "YAML Language Support",
  "description": "YAML syntax highlighting",
  "version": "1.0.0",
  "publisher": "Athas",
  "license": "MIT",
  "category": "language",
  "bundled": true,
  "capabilities": {
    "type": "language",
    "languageId": "yaml",
    "fileExtensions": ["yaml", "yml"],
    "aliases": ["YAML", "yml"],
    "grammar": {
      "wasmPath": "/tree-sitter/parsers/tree-sitter-yaml.wasm",
      "highlightQuery": "/tree-sitter/queries/yaml/highlights.scm",
      "scopeName": "source.yaml"
    }
  }
}
```

### Full Language with LSP

```json
{
  "id": "athas.php",
  "name": "PHP",
  "displayName": "PHP Language Support",
  "description": "Full PHP support with IntelliSense",
  "version": "1.0.0",
  "publisher": "Athas",
  "license": "MIT",
  "category": "language",
  "capabilities": {
    "type": "language",
    "languageId": "php",
    "fileExtensions": ["php", "phtml"],
    "aliases": ["PHP"],
    "grammar": {
      "wasmPath": "parsers/tree-sitter-php.wasm",
      "highlightQuery": "queries/highlights.scm",
      "scopeName": "source.php"
    },
    "lsp": {
      "server": {
        "darwin-arm64": "lsp/intelephense-darwin-arm64",
        "darwin-x64": "lsp/intelephense-darwin-x64",
        "linux-x64": "lsp/intelephense-linux-x64",
        "win32-x64": "lsp/intelephense-win32-x64.exe"
      },
      "args": ["--stdio"],
      "fileExtensions": [".php"],
      "languageIds": ["php"]
    },
    "snippets": "snippets.json",
    "commands": [
      {
        "command": "php.restartServer",
        "title": "Restart PHP Language Server"
      }
    ]
  },
  "installation": {
    "minVersion": "0.2.0",
    "platforms": {
      "darwin-arm64": {
        "downloadUrl": "https://athas.dev/extensions/packages/php/php-darwin-arm64.tar.gz",
        "size": 52681335,
        "checksum": "sha256..."
      }
    }
  }
}
```

### Language Capabilities

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Must be `"language"` |
| `languageId` | Yes | Unique language identifier |
| `fileExtensions` | Yes | File extensions (without dot) |
| `aliases` | No | Alternative names |
| `grammar` | Yes | Syntax highlighting config |
| `lsp` | No | LSP server config |
| `formatter` | No | Formatter config |
| `linter` | No | Linter config |
| `snippets` | No | Path to snippets.json |
| `commands` | No | Contributed commands |

---

## Theme Extensions

Theme extensions define color schemes for the editor. Each theme extension can contain multiple variants (e.g., light and dark).

### Theme with Variants

```json
{
  "id": "athas.one",
  "name": "One",
  "displayName": "One Theme",
  "description": "Atom's iconic One theme",
  "version": "1.0.0",
  "publisher": "Athas",
  "license": "MIT",
  "category": "theme",
  "bundled": true,
  "capabilities": {
    "type": "theme",
    "author": "Atom",
    "variants": [
      {
        "id": "one-light",
        "name": "One Light",
        "description": "Clean light theme",
        "appearance": "light",
        "colors": {
          "primary-bg": "#fafafa",
          "secondary-bg": "#f0f0f0",
          "text": "#383a42",
          "text-light": "#696c77",
          "text-lighter": "#a0a1a7",
          "border": "#e5e5e6",
          "hover": "#e5e5e6",
          "selected": "#e5e5e6",
          "accent": "#4078f2"
        },
        "syntax": {
          "keyword": "#a626a4",
          "string": "#50a14f",
          "number": "#986801",
          "comment": "#a0a1a7",
          "variable": "#e45649",
          "function": "#4078f2",
          "constant": "#986801",
          "property": "#e45649",
          "type": "#c18401",
          "operator": "#0184bc",
          "punctuation": "#383a42",
          "boolean": "#986801",
          "null": "#986801",
          "regex": "#50a14f",
          "tag": "#e45649",
          "attribute": "#986801"
        }
      },
      {
        "id": "one-dark",
        "name": "One Dark",
        "appearance": "dark",
        "colors": { ... },
        "syntax": { ... }
      }
    ]
  }
}
```

### Theme Colors

**UI Colors (required):**
- `primary-bg`, `secondary-bg` - Background colors
- `text`, `text-light`, `text-lighter` - Text colors
- `border`, `hover`, `selected` - Interactive states
- `accent` - Accent color

**Syntax Colors (required):**
- `keyword`, `string`, `number`, `comment`
- `variable`, `function`, `constant`, `property`
- `type`, `operator`, `punctuation`
- `boolean`, `null`, `regex`, `tag`, `attribute`

---

## Icon Theme Extensions

Icon themes define file and folder icons using SVG files.

### Icon Theme Manifest

```json
{
  "id": "athas.material-icons",
  "name": "Material Icons",
  "displayName": "Material File Icons",
  "description": "Material Design file icons",
  "version": "1.0.0",
  "publisher": "Athas",
  "license": "MIT",
  "category": "icon-theme",
  "bundled": true,
  "capabilities": {
    "type": "icon-theme",
    "iconDefinitions": {
      "file": { "iconPath": "icons/file.svg" },
      "folder": { "iconPath": "icons/folder.svg" },
      "folder-open": { "iconPath": "icons/folder-open.svg" },
      "typescript": { "iconPath": "icons/typescript.svg" },
      "javascript": { "iconPath": "icons/javascript.svg" }
    },
    "file": "file",
    "folder": "folder",
    "folderExpanded": "folder-open",
    "fileExtensions": {
      "ts": "typescript",
      "tsx": "typescript",
      "js": "javascript"
    },
    "fileNames": {
      "package.json": "json",
      "tsconfig.json": "typescript"
    },
    "folderNames": {
      "src": "folder",
      "node_modules": "folder"
    }
  }
}
```

### Icon Theme Structure

```
icon-theme/
├── extension.json
└── icons/
    ├── file.svg
    ├── folder.svg
    ├── folder-open.svg
    ├── typescript.svg
    └── ...
```

### Icon Theme Capabilities

| Field | Required | Description |
|-------|----------|-------------|
| `type` | Yes | Must be `"icon-theme"` |
| `iconDefinitions` | Yes | Map of icon keys to icon paths |
| `file` | Yes | Default file icon key |
| `folder` | Yes | Default folder icon key |
| `folderExpanded` | Yes | Expanded folder icon key |
| `fileExtensions` | No | Map file extensions to icon keys |
| `fileNames` | No | Map specific file names to icon keys |
| `folderNames` | No | Map folder names to icon keys |
| `folderNamesExpanded` | No | Map expanded folder names to icon keys |

---

## Adding a Bundled Extension

1. Create a directory under `src/extensions/bundled/{languages,themes,icon-themes}/`
2. Add `extension.json` with the manifest
3. For icon themes, add SVG files to `icons/` subdirectory
4. The registry will auto-discover the extension on app startup

**Example: Adding a bundled language**

```
src/extensions/bundled/languages/ruby/
└── extension.json
```

**Example: Adding a bundled theme**

```
src/extensions/bundled/themes/monokai/
└── extension.json
```

**Example: Adding a bundled icon theme**

```
src/extensions/bundled/icon-themes/vscode/
├── extension.json
└── icons/
    ├── file.svg
    ├── folder.svg
    └── ...
```

---

## Adding a Downloadable Extension

1. Create extension package under `www/public/extensions/packages/{name}/`
2. Add to `www/public/extensions/registry.json`
3. Build platform-specific packages (tar.gz) for extensions with LSP

**Registry Entry:**

```json
{
  "version": "1.0.0",
  "lastUpdated": "2025-01-15T00:00:00Z",
  "extensions": [
    {
      "id": "athas.php",
      "name": "PHP",
      "displayName": "PHP Language Support",
      "description": "Full PHP support with IntelliSense",
      "version": "1.0.0",
      "publisher": "Athas",
      "category": "language",
      "icon": "https://athas.dev/extensions/packages/php/icon.svg",
      "manifestUrl": "https://athas.dev/extensions/packages/php/extension.json"
    }
  ]
}
```

**Package Structure (Full Language with LSP):**

```
packages/python/
├── extension.json
├── snippets.json
├── parsers/
│   └── tree-sitter-python.wasm
├── queries/
│   └── highlights.scm
└── lsp/
    ├── pyright-darwin-arm64
    ├── pyright-darwin-x64
    ├── pyright-linux-x64
    └── pyright-win32-x64.exe
```

---

## Platform Support

Full extensions with LSP support these platforms:
- `darwin-arm64` - macOS Apple Silicon
- `darwin-x64` - macOS Intel
- `linux-x64` - Linux x86-64
- `linux-arm64` - Linux ARM64
- `win32-x64` - Windows x86-64

---

## API Reference

### Registry

```typescript
import { extensionRegistry } from "@/extensions/core";

// Initialize (called automatically on app startup)
await extensionRegistry.initialize();

// Get extension by ID
const ext = extensionRegistry.getExtension("athas.typescript");

// Get language extension for a file
const lang = extensionRegistry.getLanguageExtensionForFile("app.ts");

// Get language ID for a file
const languageId = extensionRegistry.getLanguageId("app.ts"); // "typescript"

// Check if LSP is supported
const hasLsp = extensionRegistry.isLspSupported("app.ts");

// Get all theme extensions
const themes = extensionRegistry.getThemeExtensions();

// Get all theme variants
const variants = extensionRegistry.getAllThemeVariants();

// Get a specific theme variant
const result = extensionRegistry.getThemeVariant("one-dark");
// Returns { extension: ExtensionManifest, variant: ThemeVariant }

// Get all icon themes
const iconThemes = extensionRegistry.getIconThemeExtensions();

// Get platform info
const platform = extensionRegistry.getPlatform(); // "darwin" | "linux" | "win32"
const platformArch = extensionRegistry.getPlatformArch(); // "darwin-arm64" | ...
```

### Store

```typescript
import { useExtensionStore, initializeExtensionStore } from "@/extensions/core";

// Initialize (called on app startup)
await initializeExtensionStore();

// Check if extension is installed
const isInstalled = useExtensionStore.getState().actions.isExtensionInstalled("athas.php");

// Install extension
await useExtensionStore.getState().actions.installExtension("athas.php");

// Uninstall extension
await useExtensionStore.getState().actions.uninstallExtension("athas.php");

// Set active theme
useExtensionStore.getState().actions.setActiveTheme("one-dark");

// Set active icon theme
useExtensionStore.getState().actions.setActiveIconTheme("athas.material-icons");

// React hook usage
const activeThemeId = useExtensionStore.use.activeThemeVariantId();
const activeIconThemeId = useExtensionStore.use.activeIconThemeId();
```

### Theme Provider

```typescript
import { themeProvider, initializeThemeProvider } from "@/extensions/core";

// Initialize with default theme
initializeThemeProvider("one-dark");

// Apply a theme variant
themeProvider.applyTheme("dracula");

// Get current theme
const currentThemeId = themeProvider.getCurrentTheme();
const currentVariant = themeProvider.getCurrentThemeVariant();

// Subscribe to theme changes
const unsubscribe = themeProvider.onThemeChange((variantId) => {
  console.log("Theme changed to:", variantId);
});
```

### Icon Theme Provider

```typescript
import { iconThemeProvider, initializeIconThemeProvider } from "@/extensions/core";

// Initialize with default icon theme
initializeIconThemeProvider("athas.material-icons");

// Set icon theme
iconThemeProvider.setIconTheme("athas.minimal-icons");

// Get icon for a file
const icon = iconThemeProvider.getFileIcon("app.ts", false); // file
const folderIcon = iconThemeProvider.getFileIcon("src", true); // folder
const expandedIcon = iconThemeProvider.getFileIcon("src", true, true); // expanded folder

// Load SVG content
const svg = await iconThemeProvider.loadIconSvg("icons/typescript.svg");

// Subscribe to icon theme changes
const unsubscribe = iconThemeProvider.onIconThemeChange(() => {
  console.log("Icon theme changed");
});
```

### Language Provider

```typescript
import {
  activateLanguageExtension,
  deactivateLanguageExtension,
  ensureLanguageForFile,
  getActivatedLanguages,
  isLanguageActivated,
  getLspServerPath,
} from "@/extensions/core";

// Activate a language extension
await activateLanguageExtension("athas.typescript", { startLsp: true });

// Ensure language is activated for a file
const manifest = await ensureLanguageForFile("app.ts", { startLsp: true });

// Check activation status
const isActive = isLanguageActivated("athas.typescript");
const activeLanguages = getActivatedLanguages();

// Get LSP server path (for extensions with LSP)
const serverPath = await getLspServerPath(manifest, manifest.capabilities);

// Deactivate
await deactivateLanguageExtension("athas.typescript");
```
