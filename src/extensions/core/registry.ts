/**
 * Unified Extension Registry
 *
 * Single registry for all extension categories (language, theme, icon-theme).
 * Manages bundled extensions and provides access to downloadable extensions from CDN.
 */

import { logger } from "@/features/editor/utils/logger";
import type {
  ExtensionCategory,
  ExtensionManifest,
  LanguageCapabilities,
  Platform,
  PlatformArch,
  RegistryEntry,
  ExtensionRegistry as RegistryResponse,
  ThemeCapabilities,
  ThemeVariant,
} from "./types";

// CDN URL for extension registry
const REGISTRY_URL =
  import.meta.env.VITE_EXTENSION_REGISTRY_URL || "https://athas.dev/extensions/registry.json";

// Platform detection
function detectPlatform(): Platform {
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

  logger.warn("ExtensionRegistry", `Unknown platform: ${platform}, defaulting to linux`);
  return "linux";
}

function detectPlatformArch(): PlatformArch {
  const platform = detectPlatform();

  // Try to detect architecture
  // Note: This is best-effort as browser APIs don't reliably expose architecture
  const userAgent = window.navigator.userAgent.toLowerCase();
  const isArm =
    userAgent.includes("arm") ||
    userAgent.includes("aarch64") ||
    // Mac Apple Silicon detection
    (platform === "darwin" && !userAgent.includes("intel"));

  if (platform === "darwin") {
    return isArm ? "darwin-arm64" : "darwin-x64";
  }
  if (platform === "linux") {
    return isArm ? "linux-arm64" : "linux-x64";
  }
  return "win32-x64";
}

/**
 * Unified Extension Registry
 */
class UnifiedExtensionRegistry {
  // All registered extensions (bundled + remote)
  private extensions = new Map<string, ExtensionManifest>();

  // Remote registry entries (for download info)
  private remoteRegistry = new Map<string, RegistryEntry>();

  // Platform info
  private platform: Platform;
  private platformArch: PlatformArch;

  // Initialization state
  private initPromise: Promise<void> | null = null;
  private isInitialized = false;

  // Change listeners
  private changeListeners = new Set<() => void>();

  constructor() {
    this.platform = detectPlatform();
    this.platformArch = detectPlatformArch();
  }

  /**
   * Initialize the registry by loading bundled extensions
   */
  async initialize(): Promise<void> {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = this.loadBundledExtensions();
    await this.initPromise;
    this.isInitialized = true;
  }

  /**
   * Wait for registry to be fully initialized
   */
  async ensureInitialized(): Promise<void> {
    if (this.isInitialized) return;
    await this.initialize();
  }

  /**
   * Load bundled extensions from the bundled/ directory
   * Note: Language extensions are NOT bundled - they are fetched from the extensions server
   */
  private async loadBundledExtensions(): Promise<void> {
    try {
      // Import all bundled extension manifests
      // Themes
      const themeManifests = import.meta.glob<{ default: ExtensionManifest }>(
        "../bundled/themes/*/extension.json",
        { eager: true },
      );

      // Icon themes
      const iconThemeManifests = import.meta.glob<{ default: ExtensionManifest }>(
        "../bundled/icon-themes/*/extension.json",
        { eager: true },
      );

      // Register theme extensions
      for (const module of Object.values(themeManifests)) {
        const manifest = module.default;
        manifest.bundled = true;
        this.extensions.set(manifest.id, manifest);
        logger.info("ExtensionRegistry", `Loaded bundled theme: ${manifest.displayName}`);
      }

      // Register icon theme extensions
      for (const module of Object.values(iconThemeManifests)) {
        const manifest = module.default;
        manifest.bundled = true;
        this.extensions.set(manifest.id, manifest);
        logger.info("ExtensionRegistry", `Loaded bundled icon theme: ${manifest.displayName}`);
      }

      logger.info("ExtensionRegistry", `Loaded ${this.extensions.size} bundled extensions`);

      this.notifyChange();
    } catch (error) {
      logger.error("ExtensionRegistry", "Failed to load bundled extensions:", error);
    }
  }

  /**
   * Fetch available extensions from remote registry
   */
  async fetchRemoteRegistry(): Promise<RegistryEntry[]> {
    try {
      const response = await fetch(REGISTRY_URL);
      if (!response.ok) {
        throw new Error(`Failed to fetch registry: ${response.status}`);
      }

      const registry: RegistryResponse = await response.json();

      // Store remote entries
      for (const entry of registry.extensions) {
        this.remoteRegistry.set(entry.id, entry);
      }

      logger.info(
        "ExtensionRegistry",
        `Fetched ${registry.extensions.length} extensions from remote registry`,
      );

      return registry.extensions;
    } catch (error) {
      logger.error("ExtensionRegistry", "Failed to fetch remote registry:", error);
      return [];
    }
  }

  /**
   * Register an extension manifest
   */
  registerExtension(manifest: ExtensionManifest): void {
    this.extensions.set(manifest.id, manifest);
    this.notifyChange();
  }

  /**
   * Unregister an extension
   */
  unregisterExtension(id: string): void {
    this.extensions.delete(id);
    this.notifyChange();
  }

  // ============================================
  // Query Methods
  // ============================================

  /**
   * Get extension by ID
   */
  getExtension(id: string): ExtensionManifest | undefined {
    return this.extensions.get(id);
  }

  /**
   * Get all extensions
   */
  getAllExtensions(): ExtensionManifest[] {
    return Array.from(this.extensions.values());
  }

  /**
   * Get extensions by category
   */
  getExtensionsByCategory(category: ExtensionCategory): ExtensionManifest[] {
    return this.getAllExtensions().filter((ext) => ext.category === category);
  }

  /**
   * Get bundled extensions only
   */
  getBundledExtensions(): ExtensionManifest[] {
    return this.getAllExtensions().filter((ext) => ext.bundled === true);
  }

  /**
   * Get downloadable extensions only
   */
  getDownloadableExtensions(): ExtensionManifest[] {
    return this.getAllExtensions().filter((ext) => !ext.bundled && ext.installation !== undefined);
  }

  // ============================================
  // Language Extension Queries
  // ============================================

  /**
   * Get language extension by language ID
   */
  getLanguageExtension(languageId: string): ExtensionManifest | undefined {
    for (const ext of this.extensions.values()) {
      if (ext.category === "language") {
        const caps = ext.capabilities as LanguageCapabilities;
        if (caps.languageId === languageId) {
          return ext;
        }
      }
    }
    return undefined;
  }

  /**
   * Get language extension by file extension
   */
  getLanguageExtensionByFileExtension(fileExtension: string): ExtensionManifest | undefined {
    // Normalize file extension (remove dot if present)
    const ext = fileExtension.startsWith(".") ? fileExtension.slice(1) : fileExtension;

    for (const manifest of this.extensions.values()) {
      if (manifest.category === "language") {
        const caps = manifest.capabilities as LanguageCapabilities;
        if (caps.fileExtensions.includes(ext)) {
          return manifest;
        }
      }
    }
    return undefined;
  }

  /**
   * Get language extension for a file path
   */
  getLanguageExtensionForFile(filePath: string): ExtensionManifest | undefined {
    const ext = filePath.split(".").pop()?.toLowerCase();
    if (!ext) return undefined;
    return this.getLanguageExtensionByFileExtension(ext);
  }

  /**
   * Get language ID for a file path
   */
  getLanguageId(filePath: string): string | null {
    const ext = this.getLanguageExtensionForFile(filePath);
    if (!ext || ext.category !== "language") return null;
    return (ext.capabilities as LanguageCapabilities).languageId;
  }

  /**
   * Check if LSP is supported for a file
   */
  isLspSupported(filePath: string): boolean {
    const ext = this.getLanguageExtensionForFile(filePath);
    if (!ext || ext.category !== "language") return false;
    const caps = ext.capabilities as LanguageCapabilities;
    return caps.lsp !== undefined;
  }

  /**
   * Get all supported file extensions
   */
  getSupportedFileExtensions(): string[] {
    const extensions = new Set<string>();

    for (const ext of this.extensions.values()) {
      if (ext.category === "language") {
        const caps = ext.capabilities as LanguageCapabilities;
        caps.fileExtensions.forEach((e) => extensions.add(e));
      }
    }

    return Array.from(extensions);
  }

  /**
   * Get all supported language IDs
   */
  getSupportedLanguageIds(): string[] {
    const languageIds = new Set<string>();

    for (const ext of this.extensions.values()) {
      if (ext.category === "language") {
        const caps = ext.capabilities as LanguageCapabilities;
        languageIds.add(caps.languageId);
      }
    }

    return Array.from(languageIds);
  }

  // ============================================
  // Theme Extension Queries
  // ============================================

  /**
   * Get all theme extensions
   */
  getThemeExtensions(): ExtensionManifest[] {
    return this.getExtensionsByCategory("theme");
  }

  /**
   * Get all theme variants from all theme extensions
   */
  getAllThemeVariants(): Array<{ extension: ExtensionManifest; variant: ThemeVariant }> {
    const variants: Array<{ extension: ExtensionManifest; variant: ThemeVariant }> = [];

    for (const ext of this.getThemeExtensions()) {
      const caps = ext.capabilities as ThemeCapabilities;
      for (const variant of caps.variants) {
        variants.push({ extension: ext, variant });
      }
    }

    return variants;
  }

  /**
   * Get theme variant by ID
   */
  getThemeVariant(
    variantId: string,
  ): { extension: ExtensionManifest; variant: ThemeVariant } | undefined {
    for (const ext of this.getThemeExtensions()) {
      const caps = ext.capabilities as ThemeCapabilities;
      const variant = caps.variants.find((v) => v.id === variantId);
      if (variant) {
        return { extension: ext, variant };
      }
    }
    return undefined;
  }

  /**
   * Get theme variants by appearance
   */
  getThemeVariantsByAppearance(
    appearance: "light" | "dark",
  ): Array<{ extension: ExtensionManifest; variant: ThemeVariant }> {
    return this.getAllThemeVariants().filter((t) => t.variant.appearance === appearance);
  }

  // ============================================
  // Icon Theme Extension Queries
  // ============================================

  /**
   * Get all icon theme extensions
   */
  getIconThemeExtensions(): ExtensionManifest[] {
    return this.getExtensionsByCategory("icon-theme");
  }

  /**
   * Get icon theme by ID
   */
  getIconTheme(id: string): ExtensionManifest | undefined {
    const ext = this.extensions.get(id);
    if (ext?.category === "icon-theme") {
      return ext;
    }
    return undefined;
  }

  // ============================================
  // Platform Utilities
  // ============================================

  /**
   * Get current platform
   */
  getPlatform(): Platform {
    return this.platform;
  }

  /**
   * Get current platform+arch
   */
  getPlatformArch(): PlatformArch {
    return this.platformArch;
  }

  // ============================================
  // Change Notification
  // ============================================

  /**
   * Subscribe to registry changes
   */
  onRegistryChange(callback: () => void): () => void {
    this.changeListeners.add(callback);
    return () => {
      this.changeListeners.delete(callback);
    };
  }

  private notifyChange(): void {
    for (const listener of this.changeListeners) {
      try {
        listener();
      } catch (error) {
        logger.error("ExtensionRegistry", "Error in change listener:", error);
      }
    }
  }
}

// Global registry instance
export const extensionRegistry = new UnifiedExtensionRegistry();
