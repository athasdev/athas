# Extension Development

This guide explains how to add language extensions to Athas.

## Overview

Extensions provide language support including:
- LSP server configuration
- Formatter configuration
- Linter configuration
- Code snippets
- File extension mappings

## Adding a New Language Extension

### 1. Create Extension Directory

```bash
mkdir -p src/extensions/bundled/<language>/lsp
touch src/extensions/bundled/<language>/lsp/.gitkeep
```

### 2. Create Extension Manifest

`src/extensions/bundled/<language>/extension.json`:

```json
{
  "id": "athas.<language>",
  "name": "<Language>",
  "displayName": "<Language> Language Support",
  "description": "<Language> language support",
  "version": "1.0.0",
  "publisher": "Athas",
  "categories": ["Language"],
  "languages": [
    {
      "id": "<language>",
      "extensions": [".ext"],
      "aliases": ["<Language>"]
    }
  ],
  "lsp": {
    "server": {
      "darwin": "./lsp/<server-name>",
      "linux": "./lsp/<server-name>",
      "win32": "./lsp/<server-name>.exe"
    },
    "args": ["--stdio"],
    "fileExtensions": [".ext"],
    "languageIds": ["<language>"]
  }
}
```

### 3. Register Extension

Edit `src/extensions/registry/extension-registry.ts`:

```typescript
import languageManifest from "../bundled/<language>/extension.json";

const bundledManifests: ExtensionManifest[] = [
  // ... existing extensions
  languageManifest as ExtensionManifest,
];
```

### 4. Update Setup Script

Add LSP installation to `scripts/setup-lsp-servers.sh`:

```bash
echo "Setting up <Language> LSP..."
LSP_DIR="$EXTENSIONS_DIR/<language>/lsp"
# Add installation logic
```

### 5. Test

```bash
./scripts/setup-lsp-servers.sh
bun tauri dev
```

## Manifest Structure

### Core Metadata (Required)
- `id` - Unique identifier (`publisher.name`)
- `name` - Short name
- `displayName` - Human-readable name
- `description` - Brief description
- `version` - Semantic version
- `publisher` - Publisher name
- `categories` - Array: `Language`, `Formatter`, `Linter`, `Theme`, `Snippets`, `Other`

### Language Support
```json
"languages": [{
  "id": "typescript",
  "extensions": [".ts", ".tsx"],
  "aliases": ["TypeScript", "ts"]
}]
```

### LSP Configuration
```json
"lsp": {
  "server": {
    "darwin": "./lsp/server",
    "linux": "./lsp/server",
    "win32": "./lsp/server.exe"
  },
  "args": ["--stdio"],
  "fileExtensions": [".ts"],
  "languageIds": ["typescript"],
  "initializationOptions": {}
}
```

### Formatter Configuration
```json
"formatter": {
  "command": {
    "darwin": "./formatters/prettier",
    "linux": "./formatters/prettier",
    "win32": "./formatters/prettier.exe"
  },
  "args": ["--stdin-filepath", "${file}"],
  "languages": ["typescript"],
  "formatOnSave": true,
  "inputMethod": "stdin",
  "outputMethod": "stdout"
}
```

### Linter Configuration
```json
"linter": {
  "command": {
    "darwin": "./linters/eslint",
    "linux": "./linters/eslint",
    "win32": "./linters/eslint.exe"
  },
  "args": ["--format", "json", "--stdin"],
  "languages": ["typescript"],
  "lintOnSave": true,
  "inputMethod": "stdin",
  "diagnosticFormat": "lsp"
}
```

### Snippets
```json
"snippets": [{
  "language": "typescript",
  "snippets": [{
    "prefix": "log",
    "body": "console.log('${1:message}:', ${2:variable});",
    "description": "Log to console"
  }]
}]
```

## Platform Identifiers

- `darwin` - macOS
- `linux` - Linux
- `win32` - Windows

## File Structure

Complete extension example in `src/extensions/bundled/typescript/extension.complete-example.json`.

TypeScript types in `src/extensions/types/extension-manifest.ts`.
