/**
 * Full Language Extensions
 * These extensions include LSP servers, formatters, linters, and other native components
 * that need to be downloaded as platform-specific packages.
 */

import { PLATFORM_ARCH } from "@/utils/platform";

import type { ExtensionManifest } from "../types/extension-manifest";

// CDN base URL for extensions
const CDN_BASE_URL = import.meta.env.VITE_PARSER_CDN_URL || "https://athas.dev/extensions";

/**
 * Full extension manifests for languages with LSP support
 */
export const fullExtensions: ExtensionManifest[] = [
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
      downloadUrl: `${CDN_BASE_URL}/packages/php/php-darwin-arm64.tar.gz`,
      size: 52681335,
      checksum: "5c21da47f7c17cfa798fa2cfd0df905992824f520e8d9930640fcfa5e44ece4d",
      minEditorVersion: "0.2.0",
      platformArch: {
        "darwin-arm64": {
          downloadUrl: `${CDN_BASE_URL}/packages/php/php-darwin-arm64.tar.gz`,
          size: 52681335,
          checksum: "5c21da47f7c17cfa798fa2cfd0df905992824f520e8d9930640fcfa5e44ece4d",
        },
        "darwin-x64": {
          downloadUrl: `${CDN_BASE_URL}/packages/php/php-darwin-x64.tar.gz`,
          size: 56850520,
          checksum: "6fa06325af8518b346235f7c86d887a88d04c970398657ac8c8c21482fcb180c",
        },
        "linux-x64": {
          downloadUrl: `${CDN_BASE_URL}/packages/php/php-linux-x64.tar.gz`,
          size: 55510926,
          checksum: "a29aa4bbb04f623bc22826a38d86ccb9590d1f9bf3ad7ddbc05f79522d8f835a",
        },
        "win32-x64": {
          downloadUrl: `${CDN_BASE_URL}/packages/php/php-win32-x64.tar.gz`,
          size: 52036166,
          checksum: "40f2d64fb15330bb950fbc59b44c74dcc74368abafcd8ff502e18b956a478cc5",
        },
      },
    },
  },
];

/**
 * Get all full extension manifests
 */
export function getFullExtensions(): ExtensionManifest[] {
  return fullExtensions;
}

/**
 * Get download info for current platform
 */
export function getDownloadInfoForPlatform(manifest: ExtensionManifest): {
  downloadUrl: string;
  size: number;
  checksum: string;
} | null {
  if (!manifest.installation) {
    return null;
  }

  const platformArch = PLATFORM_ARCH;

  // Check for platform+arch specific package
  if (manifest.installation.platformArch?.[platformArch]) {
    return manifest.installation.platformArch[platformArch];
  }

  // Fallback to default download URL
  return {
    downloadUrl: manifest.installation.downloadUrl,
    size: manifest.installation.size,
    checksum: manifest.installation.checksum,
  };
}
