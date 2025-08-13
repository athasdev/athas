import { invoke } from "@tauri-apps/api/core";
import type { EditorAPI } from "../extension-types";
import { BaseThemeExtension } from "./base-theme-extension";
import type { ThemeDefinition } from "./types";

interface TomlTheme {
  id: string;
  name: string;
  description: string;
  category: "System" | "Light" | "Dark";
  is_dark?: boolean;
  css_variables: Record<string, string>;
  syntax_tokens?: Record<string, string>;
}

export class ThemeLoader extends BaseThemeExtension {
  readonly name = "Theme Loader";
  readonly version = "1.0.0";
  readonly description = "Loads themes from TOML configuration files";
  themes: ThemeDefinition[] = [];

  private themesDirectory = "";

  constructor(themesDirectory?: string) {
    super();
    this.themesDirectory = themesDirectory || "src/extensions/themes/builtin";
  }

  async onInitialize(_editor: EditorAPI): Promise<void> {
    try {
      console.log(`ThemeLoader: Loading themes from ${this.themesDirectory}`);

      // Try different possible paths for the themes directory
      const possiblePaths = [
        this.themesDirectory,
        "./src/extensions/themes/builtin",
        "../src/extensions/themes/builtin",
        "resources/themes/builtin",
        "./resources/themes/builtin",
      ];

      let tomlThemes: TomlTheme[] = [];

      for (const path of possiblePaths) {
        try {
          console.log("ThemeLoader: Trying path:", path);
          // If Tauri core is unavailable (plain browser dev), skip invoking backend
          const hasTauri =
            typeof (window as any)?.__TAURI_INTERNALS__ !== "undefined" ||
            typeof (window as any)?.__TAURI__ !== "undefined";
          if (!hasTauri) {
            console.log("ThemeLoader: Tauri not detected, skipping backend invoke in browser dev");
            break;
          }
          tomlThemes = await invoke("load_toml_themes", { themesDir: path });
          if (tomlThemes.length > 0) {
            console.log(
              `ThemeLoader: Successfully loaded ${tomlThemes.length} themes from path: ${path}`,
            );
            break;
          }
        } catch (error) {
          console.log(`ThemeLoader: Failed to load from path ${path}:`, error);
        }
      }

      if (tomlThemes.length === 0) {
        console.log(
          "ThemeLoader: No TOML themes found in configured directories; skipping absolute path fallback",
        );
      }

      console.log(
        `ThemeLoader: Loaded ${tomlThemes.length} themes from TOML files:`,
        tomlThemes.map((t) => t.name),
      );

      // Convert TOML themes to ThemeDefinition format
      this.themes = tomlThemes.map((tomlTheme) => this.convertTomlToThemeDefinition(tomlTheme));

      // Register themes with the theme registry
      const { themeRegistry } = await import("./theme-registry");
      this.themes.forEach((theme) => {
        themeRegistry.registerTheme(theme);
      });

      // Cache the themes in Rust backend for faster access
      try {
        const hasTauri =
          typeof (window as any)?.__TAURI_INTERNALS__ !== "undefined" ||
          typeof (window as any)?.__TAURI__ !== "undefined";
        if (hasTauri) {
          await invoke("cache_themes", { themes: tomlThemes });
        }
      } catch (e) {
        console.log("ThemeLoader: Skipping cache_themes in browser dev:", e);
      }

      console.log(`ThemeLoader: Converted, registered, and cached ${this.themes.length} themes`);
    } catch (error) {
      console.error("ThemeLoader: Failed to load TOML themes:", error);
      // Fall back to empty themes array
      this.themes = [];
    }
  }

  private convertTomlToThemeDefinition(tomlTheme: TomlTheme): ThemeDefinition {
    return {
      id: tomlTheme.id,
      name: tomlTheme.name,
      description: tomlTheme.description,
      category: tomlTheme.category,
      cssVariables: tomlTheme.css_variables,
      syntaxTokens: tomlTheme.syntax_tokens,
      isDark: tomlTheme.is_dark,
      // No icon for TOML themes - could be added as a base64 string in TOML later
      icon: undefined,
    };
  }

  async loadFromFile(filePath: string): Promise<ThemeDefinition[]> {
    try {
      const tomlThemes: TomlTheme[] = await invoke("load_single_toml_theme", {
        themePath: filePath,
      });

      return tomlThemes.map((tomlTheme) => this.convertTomlToThemeDefinition(tomlTheme));
    } catch (error) {
      console.error(`ThemeLoader: Failed to load theme from ${filePath}:`, error);
      return [];
    }
  }

  async getCachedThemes(): Promise<ThemeDefinition[]> {
    try {
      const tomlThemes: TomlTheme[] = await invoke("get_cached_themes");
      return tomlThemes.map((tomlTheme) => this.convertTomlToThemeDefinition(tomlTheme));
    } catch (error) {
      console.error("ThemeLoader: Failed to get cached themes:", error);
      return [];
    }
  }
}

export const themeLoader = new ThemeLoader();
