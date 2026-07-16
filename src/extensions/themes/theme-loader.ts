import type { EditorAPI } from "@/features/editor/types/editor-extension.types";
import { BaseThemeExtension } from "./base-theme-extension";
// Import all theme JSON files
import ayuThemes from "./builtin/ayu.json";
import athasThemes from "./builtin/athas.json";
import catppuccinThemes from "./builtin/catppuccin.json";
import christmasThemes from "./builtin/christmas.json";
import contrastThemes from "./builtin/contrast-themes.json";
import draculaThemes from "./builtin/dracula.json";
import githubThemes from "./builtin/github.json";
import nordThemes from "./builtin/nord.json";
import oneThemes from "./builtin/one.json";
import solarizedThemes from "./builtin/solarized.json";
import { parseThemeFile, toThemeDefinition } from "./theme-file";
import type { ThemeFile } from "./theme-schema";
import tokyoNightThemes from "./builtin/tokyo-night.json";
import vitesseThemes from "./builtin/vitesse.json";
import type { ThemeDefinition } from "./types";

export class ThemeLoader extends BaseThemeExtension {
  readonly name = "Theme Loader";
  readonly version = "1.0.0";
  readonly description = "Loads themes from JSON configuration files";
  themes: ThemeDefinition[] = [];

  async onInitialize(_editor: EditorAPI): Promise<void> {
    try {
      // Combine all theme files
      const allThemeFiles: ThemeFile[] = [
        ayuThemes as ThemeFile,
        athasThemes as ThemeFile,
        catppuccinThemes as ThemeFile,
        christmasThemes as ThemeFile,
        contrastThemes as ThemeFile,
        draculaThemes as ThemeFile,
        githubThemes as ThemeFile,
        nordThemes as ThemeFile,
        oneThemes as ThemeFile,
        solarizedThemes as ThemeFile,
        tokyoNightThemes as ThemeFile,
        vitesseThemes as ThemeFile,
      ];

      const allThemes = allThemeFiles.flatMap((file) => file.themes);

      this.themes = allThemes.map(toThemeDefinition);

      // Register themes with the theme registry
      const { themeRegistry } = await import("./theme-registry");
      this.themes.forEach((theme) => {
        themeRegistry.registerTheme(theme);
      });
    } catch (error) {
      console.error("ThemeLoader: Failed to load JSON themes:", error);
      // Fall back to empty themes array
      this.themes = [];
    }
  }

  async loadFromFile(filePath: string): Promise<ThemeDefinition[]> {
    try {
      // Read JSON file
      const response = await fetch(filePath);
      if (!response.ok) {
        throw new Error(`Failed to fetch theme file: ${response.statusText}`);
      }

      const themeFile = parseThemeFile(await response.json());
      return themeFile.themes.map(toThemeDefinition);
    } catch (error) {
      console.error(`ThemeLoader: Failed to load theme from ${filePath}:`, error);
      return [];
    }
  }

  async getCachedThemes(): Promise<ThemeDefinition[]> {
    // Since themes are now loaded directly via imports, just return the loaded themes
    return this.themes;
  }
}

export const themeLoader = new ThemeLoader();
