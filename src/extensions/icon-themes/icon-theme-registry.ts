import type { IconThemeDefinition } from "./types";

class IconThemeRegistry {
  private themes: Map<string, IconThemeDefinition> = new Map();
  private listeners: Set<() => void> = new Set();

  registerTheme(theme: IconThemeDefinition) {
    this.themes.set(theme.id, theme);
    this.notifyListeners();
  }

  getTheme(id: string): IconThemeDefinition | undefined {
    return this.themes.get(id);
  }

  getAllThemes(): IconThemeDefinition[] {
    return Array.from(this.themes.values());
  }

  onRegistryChange(callback: () => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private notifyListeners() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const iconThemeRegistry = new IconThemeRegistry();
