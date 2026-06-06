import type { EditorExtension } from "@/features/editor/extensions/types";

/**
 * Internal theme definition used by the registry
 * CSS variables are stored with their full names (e.g., --primary-bg, --syntax-keyword)
 */
export interface ThemeDefinition {
  id: string;
  name: string;
  description: string;
  category: "System" | "Light" | "Dark";
  icon?: React.ReactNode;
  cssVariables: Record<string, string>;
  syntaxTokens?: Record<string, string>;
  isDark?: boolean;
}

export interface ThemeExtension extends EditorExtension {
  readonly extensionType: "theme";
  themes: ThemeDefinition[];
  getTheme(id: string): ThemeDefinition | undefined;
  applyTheme(id: string): void;
  removeTheme(id: string): void;
}

export interface ThemeRegistryAPI {
  registerTheme(theme: ThemeDefinition, source?: ThemeSource): void;
  unregisterTheme(id: string): void;
  unregisterThemesByExtension(extensionId: string): void;
  getTheme(id: string): ThemeDefinition | undefined;
  getThemeSource(id: string): ThemeSource | undefined;
  getAllThemes(): ThemeDefinition[];
  getVersion(): number;
  getThemesByCategory(category: ThemeDefinition["category"]): ThemeDefinition[];
  applyTheme(id: string): void;
  getCurrentTheme(): string | null;
  onThemeChange(callback: (themeId: string) => void): () => void;
  onRegistryChange(callback: () => void): () => void;
}

export interface ThemeSource {
  extensionId: string;
  isBundled?: boolean;
}
