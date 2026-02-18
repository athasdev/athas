/**
 * Icon Theme Provider
 *
 * Provides file icons based on the active icon theme.
 */

import { logger } from "@/features/editor/utils/logger";
import { extensionRegistry } from "../registry";
import type { ExtensionManifest, IconThemeCapabilities } from "../types";

export interface IconResult {
  svg?: string;
  iconPath?: string;
}

/**
 * Icon Theme Provider class
 *
 * Handles resolving file icons based on the active icon theme.
 */
class IconThemeProvider {
  private currentThemeId: string | null = null;
  private currentTheme: ExtensionManifest | null = null;
  private iconCache = new Map<string, string>(); // Cache loaded SVG content
  private changeListeners = new Set<() => void>();

  private isSafeRelativeIconPath(iconPath: string): boolean {
    if (!iconPath) return false;
    if (iconPath.includes("..")) return false;
    if (iconPath.startsWith("/") || iconPath.startsWith("\\")) return false;
    if (iconPath.includes("://")) return false;
    return true;
  }

  /**
   * Set the active icon theme
   */
  setIconTheme(themeId: string): boolean {
    const theme = extensionRegistry.getIconTheme(themeId);

    if (!theme) {
      logger.warn("IconThemeProvider", `Icon theme ${themeId} not found`);
      return false;
    }

    this.currentThemeId = themeId;
    this.currentTheme = theme;
    this.iconCache.clear(); // Clear cache when theme changes

    logger.info("IconThemeProvider", `Set icon theme: ${theme.displayName}`);

    // Notify listeners
    this.notifyChange();

    return true;
  }

  /**
   * Get the current icon theme ID
   */
  getCurrentIconTheme(): string | null {
    return this.currentThemeId;
  }

  /**
   * Get icon for a file
   */
  getFileIcon(fileName: string, isDir: boolean, isExpanded = false): IconResult {
    if (!this.currentTheme) {
      return {};
    }

    const caps = this.currentTheme.capabilities as IconThemeCapabilities;

    // Determine which icon definition to use
    let iconKey: string | undefined;

    if (isDir) {
      // Check folder name first
      if (caps.folderNames && !isExpanded) {
        const folderName = fileName.toLowerCase();
        iconKey = caps.folderNames[folderName];
      }
      if (!iconKey && caps.folderNamesExpanded && isExpanded) {
        const folderName = fileName.toLowerCase();
        iconKey = caps.folderNamesExpanded[folderName];
      }

      // Fall back to default folder icons
      if (!iconKey) {
        iconKey = isExpanded ? caps.folderExpanded : caps.folder;
      }
    } else {
      // Check file name first (exact match)
      if (caps.fileNames) {
        const lowerFileName = fileName.toLowerCase();
        iconKey = caps.fileNames[lowerFileName];
      }

      // Check file extension
      if (!iconKey && caps.fileExtensions) {
        const ext = fileName.includes(".") ? fileName.split(".").pop()?.toLowerCase() : undefined;
        if (ext) {
          iconKey = caps.fileExtensions[ext];
        }
      }

      // Fall back to default file icon
      if (!iconKey) {
        iconKey = caps.file;
      }
    }

    // Get icon definition
    if (!iconKey) {
      return {};
    }

    const iconDef = caps.iconDefinitions[iconKey];
    if (!iconDef) {
      return {};
    }

    return {
      iconPath: iconDef.iconPath,
    };
  }

  /**
   * Load SVG content for an icon path
   */
  async loadIconSvg(iconPath: string): Promise<string | null> {
    // Check cache first
    const cached = this.iconCache.get(iconPath);
    if (cached) {
      return cached;
    }

    if (!this.currentTheme) {
      return null;
    }

    if (!this.isSafeRelativeIconPath(iconPath)) {
      logger.warn("IconThemeProvider", `Rejected unsafe icon path: ${iconPath}`);
      return null;
    }

    try {
      // Resolve path relative to the icon theme extension
      // For bundled themes, the path is relative to the extension directory
      const basePath = this.currentTheme.bundled
        ? `/extensions/bundled/icon-themes/${this.currentTheme.name.toLowerCase().replace(/ /g, "-")}`
        : `/extensions/${this.currentTheme.id}`;

      const fullPath = `${basePath}/${iconPath}`;

      const response = await fetch(fullPath);
      if (!response.ok) {
        logger.warn("IconThemeProvider", `Failed to load icon: ${fullPath}`);
        return null;
      }

      const svg = await response.text();
      this.iconCache.set(iconPath, svg);
      return svg;
    } catch (error) {
      logger.error("IconThemeProvider", `Error loading icon ${iconPath}:`, error);
      return null;
    }
  }

  /**
   * Subscribe to icon theme changes
   */
  onIconThemeChange(callback: () => void): () => void {
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
        logger.error("IconThemeProvider", "Error in icon theme change listener:", error);
      }
    }
  }
}

// Export singleton instance
export const iconThemeProvider = new IconThemeProvider();

/**
 * Initialize icon theme provider with default or persisted theme
 */
export function initializeIconThemeProvider(defaultThemeId = "athas.material-icons"): void {
  // Wait for registry to be initialized
  extensionRegistry.ensureInitialized().then(() => {
    // Load persisted preference
    const storedPrefs = localStorage.getItem("extension-preferences");
    let themeId = defaultThemeId;

    if (storedPrefs) {
      try {
        const prefs = JSON.parse(storedPrefs);
        if (prefs.activeIconThemeId) {
          themeId = prefs.activeIconThemeId;
        }
      } catch {
        // Use default
      }
    }

    // Set the theme
    const success = iconThemeProvider.setIconTheme(themeId);

    // If failed, try the default
    if (!success && themeId !== defaultThemeId) {
      iconThemeProvider.setIconTheme(defaultThemeId);
    }
  });
}
