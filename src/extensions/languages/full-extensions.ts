/**
 * Full Language Extensions
 * These extensions include LSP servers, formatters, linters, and other native components
 * that need to be downloaded as platform-specific packages.
 */

import type {
  ExtensionManifest,
  LanguageContribution,
  LspConfiguration,
  ToolRuntime,
} from "../types/extension-manifest";
import { getServiceUrls } from "@/config/services";

// CDN base URL for extensions
const CDN_BASE_URL = getServiceUrls().extensionsCdnBaseUrl;

function parserInstallation(languageId: string): ExtensionManifest["installation"] {
  return {
    downloadUrl: `/tree-sitter/parsers/${languageId}/parser.wasm`,
    size: 0,
    checksum: "",
    minEditorVersion: "0.2.0",
  };
}

function createLanguageToolExtension(config: {
  id: string;
  name: string;
  displayName: string;
  description: string;
  languages: LanguageContribution[];
  lsp: {
    name: string;
    runtime?: ToolRuntime;
    package?: string;
    packages?: string[];
    downloadUrl?: string;
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    initializationOptions?: Record<string, unknown>;
  };
  formatter?: ExtensionManifest["formatter"];
  linter?: ExtensionManifest["linter"];
  primaryParserLanguageId?: string;
}): ExtensionManifest {
  const fileExtensions = config.languages.flatMap((language) => language.extensions);
  const languageIds = config.languages.map((language) => language.id);
  const lsp: LspConfiguration = {
    name: config.lsp.name,
    runtime: config.lsp.runtime,
    package: config.lsp.package,
    packages: config.lsp.packages,
    downloadUrl: config.lsp.downloadUrl,
    server: { default: config.lsp.command ?? config.lsp.name },
    args: config.lsp.args ?? [],
    env: config.lsp.env,
    initializationOptions: config.lsp.initializationOptions,
    fileExtensions,
    languageIds,
  };

  return {
    id: config.id,
    name: config.name,
    displayName: config.displayName,
    description: config.description,
    version: "1.0.0",
    publisher: "Athas",
    categories: ["Language"],
    languages: config.languages,
    activationEvents: languageIds.map((languageId) => `onLanguage:${languageId}`),
    lsp,
    formatter: config.formatter,
    linter: config.linter,
    installation: parserInstallation(config.primaryParserLanguageId ?? languageIds[0] ?? "text"),
  };
}

/**
 * Full extension manifests for languages with LSP support
 */
export const fullExtensions: ExtensionManifest[] = [
  {
    id: "athas.r",
    name: "R",
    displayName: "R",
    description:
      "R language support with diagnostics, completions, hover, and symbols via languageserver",
    version: "1.0.0",
    publisher: "Athas",
    categories: ["Language"],
    languages: [
      {
        id: "r",
        extensions: [".R", ".r"],
        aliases: ["R", "r"],
      },
    ],
    activationEvents: ["onLanguage:r"],
    lsp: {
      name: "r-languageserver",
      runtime: "r",
      package: "languageserver",
      server: { default: "r-languageserver" },
      args: [],
      fileExtensions: [".R", ".r"],
      languageIds: ["r"],
    },
    installation: {
      downloadUrl: "/tree-sitter/parsers/r/parser.wasm",
      size: 1,
      checksum: "",
      minEditorVersion: "0.2.0",
    },
  },
  {
    id: "athas.php",
    name: "PHP",
    displayName: "PHP",
    description:
      "Full PHP language support with IntelliSense, diagnostics, formatting, and snippets via Intelephense",
    version: "1.0.0",
    publisher: "Athas",
    categories: ["Language", "Formatter", "Linter", "Snippets"],
    languages: [
      {
        id: "php",
        extensions: [
          ".php",
          ".phtml",
          ".php3",
          ".php4",
          ".php5",
          ".php7",
          ".php8",
          ".phar",
          ".phps",
        ],
        aliases: ["PHP", "php"],
      },
    ],
    activationEvents: ["onLanguage:php"],
    lsp: {
      server: {
        darwin: "lsp/intelephense-darwin-arm64",
        linux: "lsp/intelephense-linux-x64",
        win32: "lsp/intelephense-win32-x64.exe",
      },
      args: ["--stdio"],
      fileExtensions: [
        ".php",
        ".phtml",
        ".php3",
        ".php4",
        ".php5",
        ".php7",
        ".php8",
        ".phar",
        ".phps",
      ],
      languageIds: ["php"],
    },
    commands: [
      {
        command: "php.restartServer",
        title: "Restart PHP Language Server",
        category: "PHP",
      },
      {
        command: "php.formatDocument",
        title: "Format PHP Document",
        category: "PHP",
      },
    ],
    installation: {
      downloadUrl: `${CDN_BASE_URL}/php/php-darwin-arm64.tar.gz`,
      size: 52681335,
      checksum: "5c21da47f7c17cfa798fa2cfd0df905992824f520e8d9930640fcfa5e44ece4d",
      minEditorVersion: "0.2.0",
      platformArch: {
        "darwin-arm64": {
          downloadUrl: `${CDN_BASE_URL}/php/php-darwin-arm64.tar.gz`,
          size: 52681335,
          checksum: "5c21da47f7c17cfa798fa2cfd0df905992824f520e8d9930640fcfa5e44ece4d",
        },
        "darwin-x64": {
          downloadUrl: `${CDN_BASE_URL}/php/php-darwin-x64.tar.gz`,
          size: 56850520,
          checksum: "6fa06325af8518b346235f7c86d887a88d04c970398657ac8c8c21482fcb180c",
        },
        "linux-x64": {
          downloadUrl: `${CDN_BASE_URL}/php/php-linux-x64.tar.gz`,
          size: 55510926,
          checksum: "a29aa4bbb04f623bc22826a38d86ccb9590d1f9bf3ad7ddbc05f79522d8f835a",
        },
        "win32-x64": {
          downloadUrl: `${CDN_BASE_URL}/php/php-win32-x64.tar.gz`,
          size: 52036166,
          checksum: "40f2d64fb15330bb950fbc59b44c74dcc74368abafcd8ff502e18b956a478cc5",
        },
      },
    },
  },
  createLanguageToolExtension({
    id: "athas.typescript",
    name: "TypeScript",
    displayName: "TypeScript and JavaScript",
    description:
      "TypeScript and JavaScript language support with completions, diagnostics, rename, references, and code actions via typescript-language-server.",
    languages: [
      {
        id: "typescript",
        extensions: [".ts", ".mts", ".cts"],
        aliases: ["TypeScript", "ts"],
      },
      {
        id: "typescriptreact",
        extensions: [".tsx"],
        aliases: ["TSX", "TypeScript React"],
      },
      {
        id: "javascript",
        extensions: [".js", ".mjs", ".cjs"],
        aliases: ["JavaScript", "js"],
      },
      {
        id: "javascriptreact",
        extensions: [".jsx"],
        aliases: ["JSX", "JavaScript React"],
      },
    ],
    lsp: {
      name: "typescript-language-server",
      runtime: "bun",
      package: "typescript-language-server",
      packages: ["typescript"],
      args: ["--stdio"],
    },
    primaryParserLanguageId: "typescript",
  }),
  createLanguageToolExtension({
    id: "athas.python",
    name: "Python",
    displayName: "Python",
    description:
      "Python language support with completions, diagnostics, rename, references, and code actions via Pyright.",
    languages: [
      {
        id: "python",
        extensions: [".py", ".ipy", ".pyi"],
        aliases: ["Python", "py"],
      },
    ],
    lsp: {
      name: "pyright",
      runtime: "bun",
      package: "pyright",
      args: ["--stdio"],
    },
  }),
  createLanguageToolExtension({
    id: "athas.rust",
    name: "Rust",
    displayName: "Rust",
    description:
      "Rust language support with completions, diagnostics, rename, references, semantic tokens, and code actions via rust-analyzer.",
    languages: [
      {
        id: "rust",
        extensions: [".rs"],
        aliases: ["Rust", "rs"],
      },
    ],
    lsp: {
      name: "rust-analyzer",
      runtime: "system",
    },
  }),
  createLanguageToolExtension({
    id: "athas.go",
    name: "Go",
    displayName: "Go",
    description:
      "Go language support with completions, diagnostics, rename, references, and code actions via gopls.",
    languages: [
      {
        id: "go",
        extensions: [".go"],
        aliases: ["Go", "golang"],
        filenames: ["go.mod", "go.sum", "go.work"],
      },
    ],
    lsp: {
      name: "gopls",
      runtime: "go",
      package: "golang.org/x/tools/gopls",
    },
  }),
  createLanguageToolExtension({
    id: "athas.markdown",
    name: "Markdown",
    displayName: "Markdown",
    description:
      "Markdown language support with symbols, references, and diagnostics via Marksman.",
    languages: [
      {
        id: "markdown",
        extensions: [".md", ".mdx", ".markdown"],
        aliases: ["Markdown", "md"],
      },
    ],
    lsp: {
      name: "marksman",
      runtime: "binary",
      args: ["server"],
    },
  }),
  createLanguageToolExtension({
    id: "athas.lua",
    name: "Lua",
    displayName: "Lua",
    description:
      "Lua language support with completions, diagnostics, rename, references, and semantic tokens via LuaLS.",
    languages: [
      {
        id: "lua",
        extensions: [".lua"],
        aliases: ["Lua"],
      },
    ],
    lsp: {
      name: "lua-language-server",
      runtime: "binary",
    },
  }),
  createLanguageToolExtension({
    id: "athas.zig",
    name: "Zig",
    displayName: "Zig",
    description:
      "Zig language support with completions, diagnostics, rename, references, and code actions via ZLS.",
    languages: [
      {
        id: "zig",
        extensions: [".zig"],
        aliases: ["Zig"],
      },
    ],
    lsp: {
      name: "zls",
      runtime: "binary",
    },
  }),
  createLanguageToolExtension({
    id: "athas.cpp",
    name: "C/C++",
    displayName: "C/C++",
    description:
      "C and C++ language support with completions, diagnostics, rename, references, and code actions via clangd.",
    languages: [
      {
        id: "c",
        extensions: [".c", ".h"],
        aliases: ["C"],
      },
      {
        id: "cpp",
        extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh", ".hxx"],
        aliases: ["C++", "cpp"],
      },
    ],
    lsp: {
      name: "clangd",
      runtime: "binary",
    },
    primaryParserLanguageId: "cpp",
  }),
  createLanguageToolExtension({
    id: "athas.json",
    name: "JSON",
    displayName: "JSON",
    description:
      "JSON language support with schema-aware completions and diagnostics via vscode-json-language-server.",
    languages: [
      {
        id: "json",
        extensions: [".json", ".jsonc"],
        aliases: ["JSON", "jsonc"],
        filenames: ["tsconfig.json", "jsconfig.json"],
      },
    ],
    lsp: {
      name: "vscode-json-language-server",
      runtime: "bun",
      package: "vscode-langservers-extracted",
      args: ["--stdio"],
    },
  }),
  createLanguageToolExtension({
    id: "athas.web",
    name: "HTML",
    displayName: "HTML",
    description:
      "HTML language support with completions, diagnostics, hover, and document symbols via vscode-html-language-server.",
    languages: [
      {
        id: "html",
        extensions: [".html", ".htm"],
        aliases: ["HTML"],
      },
    ],
    lsp: {
      name: "vscode-html-language-server",
      runtime: "bun",
      package: "vscode-langservers-extracted",
      args: ["--stdio"],
    },
    primaryParserLanguageId: "html",
  }),
  createLanguageToolExtension({
    id: "athas.css",
    name: "CSS",
    displayName: "CSS",
    description:
      "CSS, SCSS, Less, and Sass language support with completions and diagnostics via vscode-css-language-server.",
    languages: [
      {
        id: "css",
        extensions: [".css"],
        aliases: ["CSS"],
      },
      {
        id: "scss",
        extensions: [".scss"],
        aliases: ["SCSS"],
      },
      {
        id: "less",
        extensions: [".less"],
        aliases: ["Less"],
      },
      {
        id: "sass",
        extensions: [".sass"],
        aliases: ["Sass"],
      },
    ],
    lsp: {
      name: "vscode-css-language-server",
      runtime: "bun",
      package: "vscode-langservers-extracted",
      args: ["--stdio"],
    },
    primaryParserLanguageId: "css",
  }),
  createLanguageToolExtension({
    id: "athas.yaml",
    name: "YAML",
    displayName: "YAML",
    description:
      "YAML language support with completions, diagnostics, hover, and schema integration via yaml-language-server.",
    languages: [
      {
        id: "yaml",
        extensions: [".yaml", ".yml"],
        aliases: ["YAML", "YML"],
      },
    ],
    lsp: {
      name: "yaml-language-server",
      runtime: "bun",
      package: "yaml-language-server",
      args: ["--stdio"],
    },
  }),
];

/**
 * Get all full extension manifests
 */
export function getFullExtensions(): ExtensionManifest[] {
  return fullExtensions;
}
