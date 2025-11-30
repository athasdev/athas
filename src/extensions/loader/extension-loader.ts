/**
 * Extension Loader
 * Connects Extension Registry (manifests) with Extension Manager (lifecycle)
 */

import { extensionManager } from "@/features/editor/extensions/manager";
import type { ExtensionContext } from "@/features/editor/extensions/types";
import { logger } from "@/features/editor/utils/logger";
import { extensionRegistry } from "../registry/extension-registry";
import type { BundledExtension } from "../types/extension-manifest";

/**
 * Generic LSP Extension
 * Handles any language with LSP support based on manifest
 */
class GenericLspExtension {
  private extension: BundledExtension;
  private isActivated = false;

  constructor(extension: BundledExtension) {
    this.extension = extension;
  }

  async activate(context: ExtensionContext): Promise<void> {
    if (this.isActivated) return;

    const manifest = this.extension.manifest;
    logger.info("ExtensionLoader", `Activating ${manifest.displayName} extension`);

    // Register languages
    if (manifest.languages) {
      for (const lang of manifest.languages) {
        context.registerLanguage({
          id: lang.id,
          extensions: lang.extensions,
          aliases: lang.aliases,
        });
      }
    }

    // Load tree-sitter grammar if present
    if (manifest.grammar) {
      await this.loadGrammar(manifest.grammar);
    }

    // Register commands from manifest
    if (manifest.commands) {
      for (const cmd of manifest.commands) {
        context.registerCommand(cmd.command, async () => {
          // Handle restart command
          if (cmd.command.includes("restart")) {
            await this.restartLSP();
          }
          // Handle toggle command
          else if (cmd.command.includes("toggle")) {
            await this.toggleLSP();
          }
        });
      }
    }

    this.isActivated = true;
    logger.info("ExtensionLoader", `${manifest.displayName} extension activated`);
  }

  private async loadGrammar(grammar: any): Promise<void> {
    try {
      const basePath = this.extension.path;
      const wasmPath = grammar.wasmPath.startsWith("./")
        ? `${basePath}/${grammar.wasmPath.substring(2)}`
        : grammar.wasmPath;

      logger.info("ExtensionLoader", `Loading grammar from ${wasmPath}`);

      // Fetch highlight query if path is provided
      let highlightQuery: string | undefined;
      if (grammar.highlightQueryPath) {
        try {
          const queryPath = grammar.highlightQueryPath.startsWith("./")
            ? `${basePath}/${grammar.highlightQueryPath.substring(2)}`
            : grammar.highlightQueryPath;

          logger.info("ExtensionLoader", `Fetching highlight query from ${queryPath}`);

          const response = await fetch(queryPath);
          if (response.ok) {
            highlightQuery = await response.text();
            logger.info("ExtensionLoader", `Highlight query loaded for ${grammar.languageId}`);
          } else {
            logger.warn(
              "ExtensionLoader",
              `Failed to fetch highlight query from ${queryPath}: ${response.status}`,
            );
          }
        } catch (error) {
          logger.warn("ExtensionLoader", `Failed to load highlight query:`, error);
        }
      }

      // Load the tree-sitter parser
      const { wasmParserLoader } = await import("@/features/editor/lib/wasm-parser");
      await wasmParserLoader.loadParser({
        languageId: grammar.languageId,
        wasmPath,
        highlightQuery,
      });

      logger.info("ExtensionLoader", `Grammar loaded for ${grammar.languageId}`);
    } catch (error) {
      logger.error("ExtensionLoader", `Failed to load grammar:`, error);
    }
  }

  async deactivate(): Promise<void> {
    this.isActivated = false;
    logger.info("ExtensionLoader", `${this.extension.manifest.displayName} extension deactivated`);
  }

  private async restartLSP(): Promise<void> {
    logger.info("ExtensionLoader", `Restarting LSP for ${this.extension.manifest.name}`);
    // LSP restart logic will be handled by the LSP manager
    // This is a placeholder for future implementation
  }

  private async toggleLSP(): Promise<void> {
    logger.info("ExtensionLoader", `Toggling LSP for ${this.extension.manifest.name}`);
    // LSP toggle logic will be handled by the LSP manager
    // This is a placeholder for future implementation
  }
}

/**
 * Extension Loader Service
 * Bridges Extension Registry and Extension Manager
 */
class ExtensionLoader {
  private loadedExtensions = new Set<string>();

  /**
   * Initialize all bundled extensions
   */
  async initialize(): Promise<void> {
    logger.info("ExtensionLoader", "Initializing extension system");

    // Ensure extension manager is initialized
    if (!extensionManager.isInitialized()) {
      extensionManager.initialize();
    }

    // Load all extensions from registry
    const extensions = extensionRegistry.getAllExtensions();

    for (const extension of extensions) {
      try {
        await this.loadExtension(extension);
      } catch (error) {
        logger.error(
          "ExtensionLoader",
          `Failed to load extension ${extension.manifest.displayName}:`,
          error,
        );
      }
    }

    logger.info("ExtensionLoader", `Loaded ${this.loadedExtensions.size} extensions`);
  }

  /**
   * Load a single extension
   */
  private async loadExtension(extension: BundledExtension): Promise<void> {
    if (this.loadedExtensions.has(extension.manifest.id)) {
      logger.warn("ExtensionLoader", `Extension ${extension.manifest.id} already loaded`);
      return;
    }

    logger.info("ExtensionLoader", `Loading extension: ${extension.manifest.displayName}`);

    // Create extension instance
    const extensionInstance = new GenericLspExtension(extension);

    // Convert to new extension format for Extension Manager
    const newExtension = {
      id: extension.manifest.id,
      displayName: extension.manifest.displayName,
      version: extension.manifest.version,
      description: extension.manifest.description,
      contributes: {
        commands: extension.manifest.commands?.map((cmd) => ({
          id: cmd.command,
          title: cmd.title,
          category: cmd.category,
        })),
      },
      activate: async (context: ExtensionContext) => {
        await extensionInstance.activate(context);
      },
      deactivate: async () => {
        await extensionInstance.deactivate();
      },
    };

    // Load into Extension Manager
    await extensionManager.loadNewExtension(newExtension);

    // Mark extension as activated in registry
    extensionRegistry.setExtensionState(extension.manifest.id, "activated");

    this.loadedExtensions.add(extension.manifest.id);
    logger.info(
      "ExtensionLoader",
      `Extension ${extension.manifest.displayName} loaded successfully`,
    );
  }

  /**
   * Get loaded extension count
   */
  getLoadedCount(): number {
    return this.loadedExtensions.size;
  }

  /**
   * Check if extension is loaded
   */
  isExtensionLoaded(extensionId: string): boolean {
    return this.loadedExtensions.has(extensionId);
  }
}

// Global extension loader instance
export const extensionLoader = new ExtensionLoader();
