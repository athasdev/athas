/**
 * Language Provider
 *
 * Handles language extension activation including:
 * - Loading tree-sitter WASM parsers
 * - Starting LSP servers
 * - Providing syntax highlighting queries
 */

import { logger } from "@/features/editor/utils/logger";
import { extensionRegistry } from "../registry";
import type {
  ExtensionManifest,
  LanguageCapabilities,
  PlatformArchExecutable,
  PlatformExecutable,
} from "../types";

// Track activated language extensions
const activatedLanguages = new Map<
  string,
  {
    manifest: ExtensionManifest;
    wasmLoaded: boolean;
    lspStarted: boolean;
  }
>();

/**
 * Activate a language extension
 *
 * Loads the WASM parser and optionally starts the LSP server.
 */
export async function activateLanguageExtension(
  extensionId: string,
  options: { startLsp?: boolean } = {},
): Promise<boolean> {
  const manifest = extensionRegistry.getExtension(extensionId);

  if (!manifest || manifest.category !== "language") {
    logger.warn("LanguageProvider", `Language extension ${extensionId} not found`);
    return false;
  }

  const caps = manifest.capabilities as LanguageCapabilities;

  // Check if already activated
  if (activatedLanguages.has(extensionId)) {
    logger.debug("LanguageProvider", `Language ${extensionId} already activated`);
    return true;
  }

  logger.info("LanguageProvider", `Activating language extension: ${manifest.displayName}`);

  const state = {
    manifest,
    wasmLoaded: false,
    lspStarted: false,
  };

  try {
    // Load WASM parser
    await loadWasmParser(caps);
    state.wasmLoaded = true;

    // Note: LSP server lifecycle is managed by the editor's LSP system
    // The provider just tracks that LSP is available for this language
    if (options.startLsp && caps.lsp) {
      logger.info("LanguageProvider", `LSP available for ${manifest.displayName}`);
      state.lspStarted = true;
    }

    activatedLanguages.set(extensionId, state);
    logger.info("LanguageProvider", `Activated language extension: ${manifest.displayName}`);
    return true;
  } catch (error) {
    logger.error("LanguageProvider", `Failed to activate ${extensionId}:`, error);
    return false;
  }
}

/**
 * Deactivate a language extension
 */
export async function deactivateLanguageExtension(extensionId: string): Promise<void> {
  const state = activatedLanguages.get(extensionId);
  if (!state) return;

  // Note: LSP server lifecycle is managed by the editor's LSP system
  // This provider just tracks extension activation state

  activatedLanguages.delete(extensionId);
  logger.info("LanguageProvider", `Deactivated language extension: ${state.manifest.displayName}`);
}

/**
 * Load WASM parser for a language
 */
async function loadWasmParser(caps: LanguageCapabilities): Promise<void> {
  const { wasmParserLoader } = await import("@/features/editor/lib/wasm-parser/loader");

  // Determine WASM URL
  let wasmUrl = caps.grammar.wasmPath;

  // If it's a relative path (starts with /), use it directly from public
  // Otherwise, fetch from CDN
  if (!wasmUrl.startsWith("/") && !wasmUrl.startsWith("http")) {
    const cdnBase = import.meta.env.VITE_PARSER_CDN_URL || "https://athas.dev/extensions";
    wasmUrl = `${cdnBase}/shared/parsers/${wasmUrl}`;
  }

  logger.debug("LanguageProvider", `Loading WASM parser from: ${wasmUrl}`);

  // Check if parser is already loaded
  if (wasmParserLoader.isLoaded(caps.languageId)) {
    logger.debug("LanguageProvider", `Parser for ${caps.languageId} already loaded`);
    return;
  }

  // Determine highlight query URL
  let highlightQueryUrl = caps.grammar.highlightQuery;
  if (!highlightQueryUrl.startsWith("/") && !highlightQueryUrl.startsWith("http")) {
    const cdnBase = import.meta.env.VITE_PARSER_CDN_URL || "https://athas.dev/extensions";
    highlightQueryUrl = `${cdnBase}/shared/queries/${caps.languageId}/highlights.scm`;
  }

  // Load using the parser loader (handles caching internally)
  await wasmParserLoader.loadParser({
    languageId: caps.languageId,
    wasmPath: wasmUrl,
    highlightQuery: undefined, // Will be fetched by loader
  });
}

/**
 * Get LSP server path for a language
 *
 * Returns the resolved path to the LSP server executable for the current platform.
 * The actual LSP server lifecycle is managed by the TypeScript LSP extension.
 */
export async function getLspServerPath(
  manifest: ExtensionManifest,
  caps: LanguageCapabilities,
): Promise<string | null> {
  if (!caps.lsp) return null;

  const platformArch = extensionRegistry.getPlatformArch();
  const platform = extensionRegistry.getPlatform();

  // Resolve server path
  let serverPath: string | undefined;

  if (isPlatformArchExecutable(caps.lsp.server)) {
    // Platform+arch specific path
    serverPath = caps.lsp.server[platformArch];
  } else {
    // Platform specific path
    const exec = caps.lsp.server as PlatformExecutable;
    serverPath = exec[platform] || exec.default;
  }

  if (!serverPath) {
    logger.warn("LanguageProvider", `No LSP server for platform ${platformArch}`);
    return null;
  }

  // Resolve relative paths for bundled extensions
  if (manifest.bundled && serverPath.startsWith("./")) {
    const { invoke } = await import("@tauri-apps/api/core");
    try {
      const basePath = await invoke<string>("get_bundled_extensions_path");
      serverPath = `${basePath}/${manifest.name.toLowerCase()}/${serverPath.slice(2)}`;
    } catch (error) {
      logger.error("LanguageProvider", "Failed to resolve bundled extension path:", error);
      return null;
    }
  }

  return serverPath;
}

/**
 * Type guard for PlatformArchExecutable
 */
function isPlatformArchExecutable(
  server: PlatformExecutable | PlatformArchExecutable,
): server is PlatformArchExecutable {
  return (
    "darwin-arm64" in server ||
    "darwin-x64" in server ||
    "linux-x64" in server ||
    "linux-arm64" in server ||
    "win32-x64" in server
  );
}

/**
 * Get activated languages
 */
export function getActivatedLanguages(): string[] {
  return Array.from(activatedLanguages.keys());
}

/**
 * Check if a language is activated
 */
export function isLanguageActivated(extensionId: string): boolean {
  return activatedLanguages.has(extensionId);
}

/**
 * Get the language extension for a file path
 */
export function getLanguageExtensionForFile(filePath: string): ExtensionManifest | undefined {
  return extensionRegistry.getLanguageExtensionForFile(filePath);
}

/**
 * Activate language extension for a file if not already activated
 */
export async function ensureLanguageForFile(
  filePath: string,
  options: { startLsp?: boolean } = {},
): Promise<ExtensionManifest | undefined> {
  const manifest = extensionRegistry.getLanguageExtensionForFile(filePath);

  if (!manifest) {
    return undefined;
  }

  if (!activatedLanguages.has(manifest.id)) {
    await activateLanguageExtension(manifest.id, options);
  }

  return manifest;
}
