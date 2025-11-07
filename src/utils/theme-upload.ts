import { themeRegistry } from "../extensions/themes/theme-registry";
import type { ThemeDefinition } from "../extensions/themes/types";

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
    let themeFile: ThemeFile;

    try {
      themeFile = JSON.parse(content);
    } catch (_parseError) {
      return {
        success: false,
        error: "Invalid JSON format. Please check your theme file syntax.",
      };
    }

    // Validate structure
    if (!themeFile.themes || !Array.isArray(themeFile.themes)) {
      return {
        success: false,
        error: 'Theme file must have a "themes" array property',
      };
    }

    if (themeFile.themes.length === 0) {
      return { success: false, error: "No themes found in file" };
    }

    if (themeFile.themes.length > 1) {
      return { success: false, error: "Multiple themes in one file not supported yet" };
    }

    const jsonTheme = themeFile.themes[0];

    // Validate required fields
    if (!jsonTheme.id || !jsonTheme.name || !jsonTheme.category) {
      return {
        success: false,
        error: "Theme must have id, name, and category properties",
      };
    }

    if (!jsonTheme.cssVariables || typeof jsonTheme.cssVariables !== "object") {
      return {
        success: false,
        error: "Theme must have cssVariables object",
      };
    }

    // Convert to ThemeDefinition
    const themeDefinition: ThemeDefinition = {
      id: jsonTheme.id,
      name: jsonTheme.name,
      description: jsonTheme.description,
      category: jsonTheme.category,
      cssVariables: jsonTheme.cssVariables,
      syntaxTokens: jsonTheme.syntaxTokens,
      isDark: jsonTheme.isDark,
      icon: undefined,
    };

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
