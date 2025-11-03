import type { ThemeDefinition, ThemeRegistryAPI } from "./types";

class ThemeRegistry implements ThemeRegistryAPI {
  private themes = new Map<string, ThemeDefinition>();
  private currentTheme: string | null = null;
  private changeCallbacks = new Set<(themeId: string) => void>();
  private registryCallbacks = new Set<() => void>();
  private isReady = false;
  private readyCallbacks = new Set<() => void>();

  registerTheme(theme: ThemeDefinition): void {
    console.log("Theme registry: Registering theme", theme.id, theme.name);
    this.themes.set(theme.id, theme);
    console.log("Theme registry: Total themes after registration:", this.themes.size);
    console.log("Theme registry: All themes:", Array.from(this.themes.keys()));
    this.notifyRegistryChange();
  }

  unregisterTheme(id: string): void {
    this.themes.delete(id);
    if (this.currentTheme === id) {
      this.currentTheme = null;
    }
    this.notifyRegistryChange();
  }

  getTheme(id: string): ThemeDefinition | undefined {
    return this.themes.get(id);
  }

  getAllThemes(): ThemeDefinition[] {
    return Array.from(this.themes.values());
  }

  getThemesByCategory(category: ThemeDefinition["category"]): ThemeDefinition[] {
    return this.getAllThemes().filter((theme) => theme.category === category);
  }

  applyTheme(id: string): void {
    const theme = this.themes.get(id);
    if (!theme) {
      console.warn(`Theme ${id} not found. Available themes:`, Array.from(this.themes.keys()));
      return;
    }

    console.log(`Theme registry: Applying theme ${id}`);

    // Apply CSS variables to document root
    const root = document.documentElement;

    // Apply CSS variables
    Object.entries(theme.cssVariables).forEach(([key, value]) => {
      root.style.setProperty(key, value);
    });

    // Apply syntax token variables if defined
    if (theme.syntaxTokens) {
      Object.entries(theme.syntaxTokens).forEach(([key, value]) => {
        root.style.setProperty(key, value);
      });
    }

    // Set data attribute for the current theme
    root.setAttribute("data-theme", id);
    root.setAttribute("data-theme-type", theme.isDark ? "dark" : "light");

    this.currentTheme = id;
    console.log(`Theme registry: Successfully applied theme ${id}`);
    this.notifyThemeChange(id);
  }

  getCurrentTheme(): string | null {
    return this.currentTheme;
  }

  onThemeChange(callback: (themeId: string) => void): () => void {
    this.changeCallbacks.add(callback);
    return () => {
      this.changeCallbacks.delete(callback);
    };
  }

  onRegistryChange(callback: () => void): () => void {
    this.registryCallbacks.add(callback);
    return () => {
      this.registryCallbacks.delete(callback);
    };
  }

  private notifyThemeChange(themeId: string): void {
    this.changeCallbacks.forEach((callback) => {
      try {
        callback(themeId);
      } catch (error) {
        console.error("Error in theme change callback:", error);
      }
    });
  }

  private notifyRegistryChange(): void {
    this.registryCallbacks.forEach((callback) => {
      try {
        callback();
      } catch (error) {
        console.error("Error in registry change callback:", error);
      }
    });
  }

  markAsReady(): void {
    if (!this.isReady) {
      this.isReady = true;
      console.log("Theme registry: Marked as ready");
      this.notifyReady();
    }
  }

  isRegistryReady(): boolean {
    return this.isReady;
  }

  onReady(callback: () => void): () => void {
    if (this.isReady) {
      // If already ready, call immediately
      callback();
      return () => {};
    }

    this.readyCallbacks.add(callback);
    return () => {
      this.readyCallbacks.delete(callback);
    };
  }

  private notifyReady(): void {
    this.readyCallbacks.forEach((callback) => {
      try {
        callback();
      } catch (error) {
        console.error("Error in ready callback:", error);
      }
    });
    this.readyCallbacks.clear();
  }
}

export const themeRegistry = new ThemeRegistry();
