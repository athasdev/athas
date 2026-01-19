/**
 * Extension Registry
 * Manages bundled and user-installed extensions
 * Note: Language extensions are NOT bundled - they are fetched from the extensions server
 */

import { logger } from "@/features/editor/utils/logger";

import type {
  BundledExtension,
  ExtensionManifest,
  ExtensionState,
  Platform,
} from "../types/extension-manifest";

class ExtensionRegistry {
  private extensions = new Map<string, BundledExtension>();
  private activatedExtensions = new Set<string>();
  private platform: Platform;
  private initPromise: Promise<void>;

  constructor() {
    this.platform = this.detectPlatform();
    this.initPromise = this.loadBundledExtensions().catch((error) => {
      logger.error("ExtensionRegistry", "Failed to load bundled extensions:", error);
    });
  }

  /**
   * Wait for registry to be fully initialized
   */
  async ensureInitialized(): Promise<void> {
    await this.initPromise;
  }

  /**
   * Detect current platform
   */
  private detectPlatform(): Platform {
    const platform = window.navigator.platform.toLowerCase();

    if (platform.includes("mac")) {
      return "darwin";
    }
    if (platform.includes("linux")) {
      return "linux";
    }
    if (platform.includes("win")) {
      return "win32";
    }

    // Default to linux for unknown platforms
    logger.warn("ExtensionRegistry", `Unknown platform: ${platform}, defaulting to linux`);
    return "linux";
  }

  /**
   * Load all bundled extensions
   * Note: Language extensions are fetched from the server, not bundled
   */
  private async loadBundledExtensions() {
    const bundledManifests: ExtensionManifest[] = [];

    // Get absolute path to bundled extensions
    let basePath = "";

    try {
      const { invoke } = await import("@tauri-apps/api/core");
      basePath = await invoke<string>("get_bundled_extensions_path");
      logger.info("ExtensionRegistry", `Bundled extensions path: ${basePath}`);
    } catch (error) {
      logger.error("ExtensionRegistry", "Failed to get bundled extensions path:", error);
      basePath = "./extensions/bundled";
    }

    for (const manifest of bundledManifests) {
      const extension: BundledExtension = {
        manifest,
        path: `${basePath}/${manifest.name.toLowerCase()}`,
        isBundled: true,
        isEnabled: true,
        state: "installed",
      };

      this.extensions.set(manifest.id, extension);
      logger.info("ExtensionRegistry", `Loaded bundled extension: ${manifest.displayName}`);
    }
  }

  /**
   * Get all registered extensions
   */
  getAllExtensions(): BundledExtension[] {
    return Array.from(this.extensions.values());
  }

  /**
   * Get extension by ID
   */
  getExtension(extensionId: string): BundledExtension | undefined {
    return this.extensions.get(extensionId);
  }

  /**
   * Get extension by language ID
   */
  getExtensionByLanguageId(languageId: string): BundledExtension | undefined {
    for (const extension of this.extensions.values()) {
      if (extension.manifest.languages) {
        for (const lang of extension.manifest.languages) {
          if (lang.id === languageId) {
            return extension;
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Get extension by file extension
   */
  getExtensionByFileExtension(fileExtension: string): BundledExtension | undefined {
    // Ensure file extension starts with a dot
    const ext = fileExtension.startsWith(".") ? fileExtension : `.${fileExtension}`;

    for (const extension of this.extensions.values()) {
      if (extension.manifest.languages) {
        for (const lang of extension.manifest.languages) {
          if (lang.extensions.includes(ext)) {
            return extension;
          }
        }
      }
    }
    return undefined;
  }

  /**
   * Get LSP server path for a file
   */
  getLspServerPath(filePath: string): string | null {
    // Extract file extension
    const ext = filePath.substring(filePath.lastIndexOf("."));
    const extension = this.getExtensionByFileExtension(ext);

    if (!extension?.manifest.lsp) {
      return null;
    }

    const lspConfig = extension.manifest.lsp;
    const serverConfig = lspConfig.server;

    // Get platform-specific server path
    let serverPath =
      serverConfig[this.platform] || serverConfig.default || lspConfig.server.default;

    if (!serverPath) {
      logger.error("ExtensionRegistry", `No LSP server path found for platform: ${this.platform}`);
      return null;
    }

    // If path is relative, resolve it relative to extension path
    if (serverPath.startsWith("./")) {
      serverPath = `${extension.path}/${serverPath.substring(2)}`;
    }

    logger.debug("ExtensionRegistry", `Resolved LSP server path for ${filePath}: ${serverPath}`);

    return serverPath;
  }

  /**
   * Get LSP server arguments for a file
   */
  getLspServerArgs(filePath: string): string[] {
    const ext = filePath.substring(filePath.lastIndexOf("."));
    const extension = this.getExtensionByFileExtension(ext);

    if (!extension?.manifest.lsp) {
      return [];
    }

    return extension.manifest.lsp.args || [];
  }

  /**
   * Get LSP initialization options for a file
   */
  getLspInitializationOptions(filePath: string): Record<string, any> | undefined {
    const ext = filePath.substring(filePath.lastIndexOf("."));
    const extension = this.getExtensionByFileExtension(ext);

    if (!extension?.manifest.lsp) {
      return undefined;
    }

    return extension.manifest.lsp.initializationOptions;
  }

  /**
   * Check if LSP is supported for a file
   */
  isLspSupported(filePath: string): boolean {
    return this.getLspServerPath(filePath) !== null;
  }

  /**
   * Get language ID for a file
   */
  getLanguageId(filePath: string): string | null {
    const ext = filePath.substring(filePath.lastIndexOf("."));
    const extension = this.getExtensionByFileExtension(ext);

    if (!extension?.manifest.languages) {
      return null;
    }

    // Find the language that matches this extension
    for (const lang of extension.manifest.languages) {
      if (lang.extensions.includes(ext)) {
        return lang.id;
      }
    }

    return null;
  }

  /**
   * Mark extension as activated
   */
  setExtensionState(extensionId: string, state: ExtensionState) {
    const extension = this.extensions.get(extensionId);
    if (extension) {
      extension.state = state;

      if (state === "activated") {
        this.activatedExtensions.add(extensionId);
      } else if (state === "deactivated") {
        this.activatedExtensions.delete(extensionId);
      }
    }
  }

  /**
   * Check if extension is activated
   */
  isExtensionActivated(extensionId: string): boolean {
    return this.activatedExtensions.has(extensionId);
  }

  /**
   * Get activated extensions
   */
  getActivatedExtensions(): BundledExtension[] {
    return Array.from(this.activatedExtensions)
      .map((id) => this.extensions.get(id))
      .filter((ext): ext is BundledExtension => ext !== undefined);
  }

  /**
   * Get current platform
   */
  getPlatform(): Platform {
    return this.platform;
  }

  /**
   * Get all supported file extensions
   */
  getSupportedFileExtensions(): string[] {
    const extensions = new Set<string>();

    for (const extension of this.extensions.values()) {
      if (extension.manifest.languages) {
        for (const lang of extension.manifest.languages) {
          lang.extensions.forEach((ext) => extensions.add(ext));
        }
      }
    }

    return Array.from(extensions);
  }

  /**
   * Get all supported language IDs
   */
  getSupportedLanguageIds(): string[] {
    const languageIds = new Set<string>();

    for (const extension of this.extensions.values()) {
      if (extension.manifest.languages) {
        for (const lang of extension.manifest.languages) {
          languageIds.add(lang.id);
        }
      }
    }

    return Array.from(languageIds);
  }

  /**
   * Get formatter configuration for a file
   */
  getFormatterForFile(filePath: string): {
    command: string;
    args: string[];
    env?: Record<string, string>;
    inputMethod?: "stdin" | "file";
    outputMethod?: "stdout" | "file";
  } | null {
    const ext = filePath.substring(filePath.lastIndexOf("."));
    const extension = this.getExtensionByFileExtension(ext);

    if (!extension?.manifest.formatter) {
      return null;
    }

    const formatterConfig = extension.manifest.formatter;

    // Get platform-specific command
    const command =
      formatterConfig.command[this.platform] || formatterConfig.command.default || null;

    if (!command) {
      return null;
    }

    // Resolve command path if relative
    let resolvedCommand = command;
    if (command.startsWith("./")) {
      resolvedCommand = `${extension.path}/${command.substring(2)}`;
    }

    return {
      command: resolvedCommand,
      args: formatterConfig.args || [],
      env: formatterConfig.env,
      inputMethod: formatterConfig.inputMethod,
      outputMethod: formatterConfig.outputMethod,
    };
  }

  /**
   * Get formatter for a language ID
   */
  getFormatterForLanguage(languageId: string): {
    command: string;
    args: string[];
    env?: Record<string, string>;
    inputMethod?: "stdin" | "file";
    outputMethod?: "stdout" | "file";
  } | null {
    const extension = this.getExtensionByLanguageId(languageId);

    if (!extension?.manifest.formatter) {
      return null;
    }

    const formatterConfig = extension.manifest.formatter;

    const command =
      formatterConfig.command[this.platform] || formatterConfig.command.default || null;

    if (!command) {
      return null;
    }

    let resolvedCommand = command;
    if (command.startsWith("./")) {
      resolvedCommand = `${extension.path}/${command.substring(2)}`;
    }

    return {
      command: resolvedCommand,
      args: formatterConfig.args || [],
      env: formatterConfig.env,
      inputMethod: formatterConfig.inputMethod,
      outputMethod: formatterConfig.outputMethod,
    };
  }

  /**
   * Get linter configuration for a file
   */
  getLinterForFile(filePath: string): {
    command: string;
    args: string[];
    env?: Record<string, string>;
    inputMethod?: "stdin" | "file";
    diagnosticFormat?: "lsp" | "regex";
    diagnosticPattern?: string;
  } | null {
    const ext = filePath.substring(filePath.lastIndexOf("."));
    const extension = this.getExtensionByFileExtension(ext);

    if (!extension?.manifest.linter) {
      return null;
    }

    const linterConfig = extension.manifest.linter;

    const command = linterConfig.command[this.platform] || linterConfig.command.default || null;

    if (!command) {
      return null;
    }

    let resolvedCommand = command;
    if (command.startsWith("./")) {
      resolvedCommand = `${extension.path}/${command.substring(2)}`;
    }

    return {
      command: resolvedCommand,
      args: linterConfig.args || [],
      env: linterConfig.env,
      inputMethod: linterConfig.inputMethod,
      diagnosticFormat: linterConfig.diagnosticFormat,
      diagnosticPattern: linterConfig.diagnosticPattern,
    };
  }

  /**
   * Get linter for a language ID
   */
  getLinterForLanguage(languageId: string): {
    command: string;
    args: string[];
    env?: Record<string, string>;
    inputMethod?: "stdin" | "file";
    diagnosticFormat?: "lsp" | "regex";
    diagnosticPattern?: string;
  } | null {
    const extension = this.getExtensionByLanguageId(languageId);

    if (!extension?.manifest.linter) {
      return null;
    }

    const linterConfig = extension.manifest.linter;

    const command = linterConfig.command[this.platform] || linterConfig.command.default || null;

    if (!command) {
      return null;
    }

    let resolvedCommand = command;
    if (command.startsWith("./")) {
      resolvedCommand = `${extension.path}/${command.substring(2)}`;
    }

    return {
      command: resolvedCommand,
      args: linterConfig.args || [],
      env: linterConfig.env,
      inputMethod: linterConfig.inputMethod,
      diagnosticFormat: linterConfig.diagnosticFormat,
      diagnosticPattern: linterConfig.diagnosticPattern,
    };
  }

  /**
   * Get snippets for a language ID
   */
  getSnippetsForLanguage(languageId: string): Array<{
    prefix: string;
    body: string | string[];
    description?: string;
    scope?: string;
  }> {
    const snippets: Array<{
      prefix: string;
      body: string | string[];
      description?: string;
      scope?: string;
    }> = [];

    for (const extension of this.extensions.values()) {
      if (extension.manifest.snippets) {
        for (const snippetContribution of extension.manifest.snippets) {
          if (snippetContribution.language === languageId) {
            snippets.push(...snippetContribution.snippets);
          }
        }
      }
    }

    return snippets;
  }

  /**
   * Get all snippets from all extensions
   */
  getAllSnippets(): Array<{
    language: string;
    prefix: string;
    body: string | string[];
    description?: string;
    scope?: string;
  }> {
    const snippets: Array<{
      language: string;
      prefix: string;
      body: string | string[];
      description?: string;
      scope?: string;
    }> = [];

    for (const extension of this.extensions.values()) {
      if (extension.manifest.snippets) {
        for (const snippetContribution of extension.manifest.snippets) {
          for (const snippet of snippetContribution.snippets) {
            snippets.push({
              language: snippetContribution.language,
              ...snippet,
            });
          }
        }
      }
    }

    return snippets;
  }
}

// Global extension registry instance
export const extensionRegistry = new ExtensionRegistry();
