# Extension Manifest Format

This document describes the complete extension manifest format for Athas extensions.

## Overview

An extension manifest is a JSON file (`extension.json`) that defines all aspects of an extension, including:

- Language support (file extensions, aliases)
- LSP server configuration
- Formatter configuration
- Linter configuration
- Code snippets
- Commands and keybindings
- Installation metadata

## Complete Example

See [`src/extensions/bundled/typescript/extension.complete-example.json`](../../src/extensions/bundled/typescript/extension.complete-example.json) for a fully-featured example.

## Manifest Structure

### Core Metadata

```json
{
  "id": "athas.typescript",
  "name": "TypeScript",
  "displayName": "TypeScript Language Support",
  "description": "Complete TypeScript language support",
  "version": "1.0.0",
  "publisher": "Athas",
  "categories": ["Language", "Formatter", "Linter"],
  "icon": "icon.svg",
  "license": "MIT"
}
```

**Fields:**
- `id` (required): Unique identifier in format `publisher.name`
- `name` (required): Short name
- `displayName` (required): Human-readable display name
- `description` (required): Brief description
- `version` (required): Semantic version (e.g., "1.0.0")
- `publisher` (required): Publisher name
- `categories` (required): Array of categories
- `icon` (optional): Path to icon file
- `license` (optional): License identifier (e.g., "MIT")

**Categories:**
- `Language` - Language support
- `Formatter` - Code formatter
- `Linter` - Code linter
- `Theme` - Color theme
- `Keymaps` - Keybinding sets
- `Snippets` - Code snippets
- `Other` - Other extensions

### Language Support

```json
{
  "languages": [
    {
      "id": "typescript",
      "extensions": [".ts", ".tsx"],
      "aliases": ["TypeScript", "ts"],
      "firstLine": "^#!.*\\bts-node\\b"
    }
  ]
}
```

**Fields:**
- `id` (required): Unique language identifier
- `extensions` (required): File extensions (with dot)
- `aliases` (optional): Alternative names
- `firstLine` (optional): Regex to match first line of file

### LSP Configuration

```json
{
  "lsp": {
    "server": {
      "darwin": "./lsp/typescript-language-server",
      "linux": "./lsp/typescript-language-server",
      "win32": "./lsp/typescript-language-server.exe"
    },
    "args": ["--stdio"],
    "env": {
      "NODE_ENV": "production"
    },
    "fileExtensions": [".ts", ".tsx"],
    "languageIds": ["typescript"],
    "initializationOptions": {
      "preferences": {
        "includeInlayParameterNameHints": "all"
      }
    }
  }
}
```

**Fields:**
- `server` (required): Platform-specific executable paths
- `args` (optional): Command-line arguments
- `env` (optional): Environment variables
- `fileExtensions` (required): Supported file extensions
- `languageIds` (required): Language identifiers
- `initializationOptions` (optional): LSP initialization options

### Formatter Configuration

```json
{
  "formatter": {
    "command": {
      "darwin": "./formatters/prettier",
      "linux": "./formatters/prettier",
      "win32": "./formatters/prettier.exe"
    },
    "args": ["--stdin-filepath", "${file}"],
    "languages": ["typescript", "javascript"],
    "formatOnSave": true,
    "inputMethod": "stdin",
    "outputMethod": "stdout"
  }
}
```

**Fields:**
- `command` (required): Platform-specific formatter executable
- `args` (optional): Command-line arguments (supports `${file}` placeholder)
- `languages` (required): Supported language IDs
- `formatOnSave` (optional): Enable format on save (default: false)
- `inputMethod` (optional): "stdin" or "file" (default: "stdin")
- `outputMethod` (optional): "stdout" or "file" (default: "stdout")

**Placeholders:**
- `${file}` - Current file path
- `${workspaceFolder}` - Workspace root path
- `${fileBasename}` - File name with extension
- `${fileBasenameNoExtension}` - File name without extension

### Linter Configuration

```json
{
  "linter": {
    "command": {
      "darwin": "./linters/eslint",
      "linux": "./linters/eslint",
      "win32": "./linters/eslint.exe"
    },
    "args": ["--format", "json", "--stdin", "--stdin-filename", "${file}"],
    "languages": ["typescript", "javascript"],
    "lintOnSave": true,
    "lintOnType": false,
    "inputMethod": "stdin",
    "diagnosticFormat": "lsp"
  }
}
```

**Fields:**
- `command` (required): Platform-specific linter executable
- `args` (optional): Command-line arguments
- `languages` (required): Supported language IDs
- `lintOnSave` (optional): Enable lint on save (default: true)
- `lintOnType` (optional): Enable lint on type (default: false)
- `inputMethod` (optional): "stdin" or "file" (default: "stdin")
- `diagnosticFormat` (optional): "lsp" or "regex" (default: "lsp")
- `diagnosticPattern` (optional): Regex pattern for parsing diagnostics (if using "regex")

### Snippets

```json
{
  "snippets": [
    {
      "language": "typescript",
      "snippets": [
        {
          "prefix": "log",
          "body": "console.log('${1:message}:', ${2:variable});",
          "description": "Log to console"
        },
        {
          "prefix": "func",
          "body": [
            "function ${1:name}(${2:params}): ${3:void} {",
            "\t${4:// body}",
            "}"
          ],
          "description": "Function declaration"
        }
      ]
    }
  ]
}
```

**Snippet Syntax:**
- `${1:placeholder}` - Tab stop with placeholder text
- `${1}` - Tab stop without placeholder
- `$0` - Final cursor position
- `${1|choice1,choice2|}` - Choice placeholder

**Fields:**
- `language` (required): Language ID
- `snippets` (required): Array of snippet definitions
  - `prefix` (required): Trigger text
  - `body` (required): Snippet content (string or array of lines)
  - `description` (optional): Description shown in completion
  - `scope` (optional): Scope restriction

### Commands

```json
{
  "commands": [
    {
      "command": "typescript.restart",
      "title": "Restart TypeScript Server",
      "category": "TypeScript",
      "icon": "restart-icon.svg"
    }
  ]
}
```

**Fields:**
- `command` (required): Unique command identifier
- `title` (required): Display title
- `category` (optional): Command category for grouping
- `icon` (optional): Icon path

### Installation Metadata

```json
{
  "installation": {
    "downloadUrl": "https://extensions.athas.dev/typescript/v1.0.0/typescript-extension.tar.gz",
    "size": 52428800,
    "checksum": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "minEditorVersion": "0.1.0",
    "platforms": {
      "darwin": {
        "downloadUrl": "https://extensions.athas.dev/typescript/v1.0.0/typescript-darwin.tar.gz",
        "size": 52428800,
        "checksum": "a1b2c3d4..."
      }
    }
  }
}
```

**Fields:**
- `downloadUrl` (required): Download URL for the extension package
- `size` (required): Package size in bytes
- `checksum` (required): SHA256 checksum for verification
- `minEditorVersion` (optional): Minimum editor version
- `maxEditorVersion` (optional): Maximum editor version
- `platforms` (optional): Platform-specific packages

## Extension Package Structure

An extension package is a `.tar.gz` archive with this structure:

```
typescript-extension.tar.gz
├── extension.json              # Manifest
├── icon.svg                    # Icon (optional)
├── README.md                   # Documentation (optional)
├── lsp/                        # LSP server binaries
│   ├── typescript-language-server
│   └── package.json           # LSP dependencies
├── formatters/                 # Formatter binaries
│   ├── prettier
│   └── package.json
├── linters/                    # Linter binaries
│   ├── eslint
│   └── package.json
└── grammars/                   # Syntax grammars (optional)
    └── typescript.wasm
```

## Platform Identifiers

Use these platform identifiers in `PlatformExecutable` objects:

- `darwin` - macOS (both Intel and Apple Silicon)
- `linux` - Linux
- `win32` - Windows

## Best Practices

### 1. Self-Contained Extensions

Each extension should include all necessary binaries and dependencies. Users should be able to install and use the extension without any additional setup.

### 2. Version Constraints

Use semantic versioning for dependencies:

```json
{
  "dependencies": {
    "typescript": "^5.3.0",
    "prettier": "~3.0.0"
  }
}
```

### 3. Platform Support

Provide binaries for all platforms when possible. If a platform is not supported, omit it from the manifest.

### 4. Checksums

Always include SHA256 checksums for all downloadable packages to ensure integrity and security.

### 5. Size Optimization

- Use stripped/optimized binaries
- Compress large files
- Consider platform-specific packages to avoid downloading unnecessary files

### 6. Testing

Test your extension on all supported platforms before publishing.

## Publishing Extensions

Extensions are published to the Athas Extension Registry. To publish:

1. Create a complete extension package
2. Generate checksums for all platform packages
3. Upload packages to a hosting service
4. Submit manifest to the registry

See [EXTENSION_PUBLISHING.md](./EXTENSION_PUBLISHING.md) for detailed publishing instructions.

## Schema Validation

The TypeScript types in `src/extensions/types/extension-manifest.ts` serve as the source of truth for the manifest format. Use a JSON schema validator to check your manifests before publishing.
