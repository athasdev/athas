/**
 * Theme Provider
 *
 * Applies theme CSS variables to the document.
 */

import { logger } from "@/features/editor/utils/logger";
import { extensionRegistry } from "../registry";
import type { ThemeVariant } from "../types";

/**
 * Theme Provider class
 *
 * Handles applying theme variants to the document.
 */
class ThemeProvider {
  private currentVariantId: string | null = null;
  private changeListeners = new Set<(variantId: string) => void>();

  /**
   * Apply a theme variant by ID
   */
  applyTheme(variantId: string): boolean {
    const result = extensionRegistry.getThemeVariant(variantId);

    if (!result) {
      logger.warn("ThemeProvider", `Theme variant ${variantId} not found`);
      return false;
    }

    const { variant } = result;

    const root = document.documentElement;

    // Apply UI colors
    for (const [key, value] of Object.entries(variant.colors)) {
      root.style.setProperty(`--${key}`, value);
    }

    // Apply syntax colors with syntax- prefix
    for (const [key, value] of Object.entries(variant.syntax)) {
      root.style.setProperty(`--syntax-${key}`, value);
    }

    // Set data attributes for CSS selectors
    root.setAttribute("data-theme", variantId);
    root.setAttribute("data-theme-type", variant.appearance);

    this.currentVariantId = variantId;

    // Notify listeners
    this.notifyChange(variantId);

    return true;
  }

  /**
   * Get the current theme variant ID
   */
  getCurrentTheme(): string | null {
    return this.currentVariantId;
  }

  /**
   * Get the current theme variant
   */
  getCurrentThemeVariant(): ThemeVariant | undefined {
    if (!this.currentVariantId) return undefined;
    const result = extensionRegistry.getThemeVariant(this.currentVariantId);
    return result?.variant;
  }

  /**
   * Subscribe to theme changes
   */
  onThemeChange(callback: (variantId: string) => void): () => void {
    this.changeListeners.add(callback);
    return () => {
      this.changeListeners.delete(callback);
    };
  }

  private notifyChange(variantId: string): void {
    for (const listener of this.changeListeners) {
      try {
        listener(variantId);
      } catch (error) {
        logger.error("ThemeProvider", "Error in theme change listener:", error);
      }
    }
  }
}

// Export singleton instance
export const themeProvider = new ThemeProvider();

/**
 * Apply default theme on app startup
 */
export function initializeThemeProvider(defaultThemeId = "vitesse-dark"): void {
  // Wait for registry to be initialized
  extensionRegistry.ensureInitialized().then(() => {
    // Load persisted theme preference
    const storedPrefs = localStorage.getItem("extension-preferences");
    let themeId = defaultThemeId;

    if (storedPrefs) {
      try {
        const prefs = JSON.parse(storedPrefs);
        if (prefs.activeThemeVariantId) {
          themeId = prefs.activeThemeVariantId;
        }
      } catch {
        // Use default
      }
    }

    // Apply the theme
    const success = themeProvider.applyTheme(themeId);

    // If failed, try the default
    if (!success && themeId !== defaultThemeId) {
      themeProvider.applyTheme(defaultThemeId);
    }
  });
}
