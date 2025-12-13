import { themeRegistry } from "../extensions/themes/theme-registry";
import type { ThemeDefinition } from "../extensions/themes/types";

/**
 * New theme format (recommended)
 */
interface NewJsonTheme {
  id: string;
  name: string;
  description?: string;
  appearance: "dark" | "light";
  colors: Record<string, string>;
  syntax: Record<string, string>;
}

interface NewThemeFile {
  name: string;
  author?: string;
  description?: string;
  themes: NewJsonTheme[];
}

/**
 * Check if theme file is in the new format
 */
function isNewFormat(themeFile: unknown): themeFile is NewThemeFile {
  if (!themeFile || typeof themeFile !== "object") return false;
  const file = themeFile as Record<string, unknown>;
  if (!file.themes || !Array.isArray(file.themes)) return false;
  if (file.themes.length === 0) return false;
  const firstTheme = file.themes[0] as Record<string, unknown>;
  return "appearance" in firstTheme && "colors" in firstTheme && "syntax" in firstTheme;
}

/**
 * Convert new format theme to internal ThemeDefinition
 */
function convertNewFormatTheme(jsonTheme: NewJsonTheme): ThemeDefinition {
  // Convert colors to CSS variables with -- prefix
  const cssVariables: Record<string, string> = {};
  for (const [key, value] of Object.entries(jsonTheme.colors)) {
    cssVariables[`--${key}`] = value;
  }

  // Convert syntax to syntaxTokens with --syntax- prefix
  const syntaxTokens: Record<string, string> = {};
  for (const [key, value] of Object.entries(jsonTheme.syntax)) {
    syntaxTokens[`--syntax-${key}`] = value;
  }

  const isDark = jsonTheme.appearance === "dark";

  return {
    id: jsonTheme.id,
    name: jsonTheme.name,
    description: jsonTheme.description || "",
    category: isDark ? "Dark" : "Light",
    cssVariables,
    syntaxTokens,
    isDark,
    icon: undefined,
  };
}

export const uploadTheme = async (
  file: File,
): Promise<{ success: boolean; error?: string; theme?: ThemeDefinition }> => {
  try {
    // Validate file extension
    if (!file.name.endsWith(".json")) {
      return { success: false, error: "Please upload a JSON file (.json)" };
    }

    // Read and parse JSON file
    const content = await file.text();
    let themeFile: unknown;

    try {
      themeFile = JSON.parse(content);
    } catch (_parseError) {
      return {
        success: false,
        error: "Invalid JSON format. Please check your theme file syntax.",
      };
    }

    // Check if it has a themes array
    if (
      !themeFile ||
      typeof themeFile !== "object" ||
      !("themes" in themeFile) ||
      !Array.isArray((themeFile as Record<string, unknown>).themes)
    ) {
      return {
        success: false,
        error: 'Theme file must have a "themes" array property',
      };
    }

    const themesArray = (themeFile as Record<string, unknown[]>).themes;
    if (themesArray.length === 0) {
      return { success: false, error: "No themes found in file" };
    }

    if (themesArray.length > 1) {
      return { success: false, error: "Multiple themes in one file not supported yet" };
    }

    let themeDefinition: ThemeDefinition;

    if (isNewFormat(themeFile)) {
      // New format: colors, syntax, appearance
      const jsonTheme = themeFile.themes[0];

      // Validate required fields
      if (!jsonTheme.id || !jsonTheme.name || !jsonTheme.appearance) {
        return {
          success: false,
          error: "Theme must have id, name, and appearance properties",
        };
      }

      if (!jsonTheme.colors || typeof jsonTheme.colors !== "object") {
        return {
          success: false,
          error: "Theme must have colors object",
        };
      }

      if (!jsonTheme.syntax || typeof jsonTheme.syntax !== "object") {
        return {
          success: false,
          error: "Theme must have syntax object",
        };
      }

      themeDefinition = convertNewFormatTheme(jsonTheme);
    } else {
      return {
        success: false,
        error:
          "Invalid theme format. Theme must have: id, name, appearance (dark/light), colors, and syntax objects",
      };
    }

    // Register the theme
    themeRegistry.registerTheme(themeDefinition);

    return { success: true, theme: themeDefinition };
  } catch (error) {
    console.error("Theme upload error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to upload theme",
    };
  }
};
