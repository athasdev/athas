/**
 * Extension Marketplace Types
 * Defines the structure for the extension registry and marketplace
 */

export interface MarketplaceRegistry {
  version: string;
  lastUpdated: string;
  extensions: MarketplaceExtension[];
}

export interface MarketplaceExtension {
  id: string;
  name: string;
  displayName: string;
  description: string;
  version: string;
  publisher: string;
  repository: string;

  // Categories
  categories: ExtensionCategory[];

  // Download info
  packageUrl: string;
  checksum: string;
  size: number; // in bytes

  // Languages supported (for language extensions)
  languages?: {
    id: string;
    extensions: string[];
    aliases?: string[];
  }[];

  // Features
  features: {
    lsp?: boolean;
    formatter?: boolean;
    linter?: boolean;
    snippets?: boolean;
    themes?: boolean;
  };

  // Download sources for LSP/tools
  downloadSources?: {
    lsp?: DownloadSource;
    formatter?: DownloadSource;
    linter?: DownloadSource;
  };
}

export type ExtensionCategory =
  | "Language"
  | "Theme"
  | "Formatter"
  | "Linter"
  | "Snippets"
  | "Tools"
  | "Other";

export interface DownloadSource {
  type: "github-release" | "npm" | "custom";

  // For GitHub releases
  repository?: string; // e.g., "microsoft/pyright"
  assetPattern?: string; // e.g., "pyright-{os}-{arch}.tar.gz"

  // For NPM packages
  package?: string; // e.g., "@typescript/language-server"

  // For custom URLs
  urls?: {
    darwin?: string;
    linux?: string;
    win32?: string;
  };

  // Common options
  version?: string;
  checkIntegrity?: boolean;
}

export interface InstalledExtension {
  id: string;
  version: string;
  installedAt: string;
  lastUsed?: string;
  enabled: boolean;
}

export interface ExtensionInstallStatus {
  id: string;
  status: "pending" | "downloading" | "installing" | "installed" | "failed";
  progress: number; // 0-100
  error?: string;
}
