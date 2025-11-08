import type { EditorAPI } from "@/features/editor/extensions/types";
import { BaseThemeExtension } from "./base-theme-extension";
// Import all theme JSON files
import athasThemes from "./builtin/athas.json";
import catppuccinThemes from "./builtin/catppuccin.json";
import contrastThemes from "./builtin/contrast-themes.json";
import draculaThemes from "./builtin/dracula.json";
import githubThemes from "./builtin/github.json";
import nordThemes from "./builtin/nord.json";
import oneDarkThemes from "./builtin/one-dark.json";
import solarizedThemes from "./builtin/solarized.json";
import tokyoNightThemes from "./builtin/tokyo-night.json";
import vitesseThemes from "./builtin/vitesse.json";
import vscodeThemes from "./builtin/vscode.json";
import type { ThemeDefinition } from "./types";

interface JsonTheme {
  id: string;
  name: string;
  description: string;
  category: "System" | "Light" | "Dark";
  isDark?: boolean;
  cssVariables: Record<string, string>;
  syntaxTokens?: Record<string, string>;
}

interface ThemeFile {
  themes: JsonTheme[];
}

export class ThemeLoader extends BaseThemeExtension {
  readonly name = "Theme Loader";
  readonly version = "1.0.0";
  readonly description = "Loads themes from JSON configuration files";
  themes: ThemeDefinition[] = [];

  async onInitialize(_editor: EditorAPI): Promise<void> {
    try {
      console.log("ThemeLoader: Loading themes from JSON files");

      // Combine all theme files
      const allThemeFiles: ThemeFile[] = [
        athasThemes as ThemeFile,
        catppuccinThemes as ThemeFile,
        contrastThemes as ThemeFile,
        draculaThemes as ThemeFile,
        githubThemes as ThemeFile,
        nordThemes as ThemeFile,
        oneDarkThemes as ThemeFile,
        solarizedThemes as ThemeFile,
        tokyoNightThemes as ThemeFile,
        vitesseThemes as ThemeFile,
        vscodeThemes as ThemeFile,
      ];

      // Flatten all themes from all files
      const allThemes: JsonTheme[] = allThemeFiles.flatMap((file) => file.themes);

      console.log(
        `ThemeLoader: Loaded ${allThemes.length} themes from JSON files:`,
        allThemes.map((t) => t.name),
      );

      // Convert to ThemeDefinition format
      this.themes = allThemes.map((jsonTheme) => this.convertJsonToThemeDefinition(jsonTheme));

      // Register themes with the theme registry
      const { themeRegistry } = await import("./theme-registry");
      this.themes.forEach((theme) => {
        themeRegistry.registerTheme(theme);
      });

      console.log(`ThemeLoader: Registered ${this.themes.length} themes`);
    } catch (error) {
      console.error("ThemeLoader: Failed to load JSON themes:", error);
      // Fall back to empty themes array
      this.themes = [];
    }
  }

  private convertJsonToThemeDefinition(jsonTheme: JsonTheme): ThemeDefinition {
    return {
      id: jsonTheme.id,
      name: jsonTheme.name,
      description: jsonTheme.description,
      category: jsonTheme.category,
      cssVariables: jsonTheme.cssVariables,
      syntaxTokens: jsonTheme.syntaxTokens,
      isDark: jsonTheme.isDark,
      icon: undefined,
    };
  }

  async loadFromFile(filePath: string): Promise<ThemeDefinition[]> {
    try {
      // Read JSON file
      const response = await fetch(filePath);
      if (!response.ok) {
        throw new Error(`Failed to fetch theme file: ${response.statusText}`);
      }

      const themeFile: ThemeFile = await response.json();
      return themeFile.themes.map((jsonTheme) => this.convertJsonToThemeDefinition(jsonTheme));
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
