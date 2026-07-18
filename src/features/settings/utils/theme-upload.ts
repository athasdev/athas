import {
  installCustomThemes,
  loadCustomThemes,
  removeCustomTheme,
} from "@/extensions/themes/custom-theme-store";
import {
  parseThemeFileJson,
  ThemeFileValidationError,
  toThemeDefinition,
} from "@/extensions/themes/theme-file";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import type { ThemeDefinition } from "@/extensions/themes/theme.types";

const MAX_THEME_FILE_BYTES = 2 * 1024 * 1024;

export interface ThemeUploadResult {
  success: boolean;
  error?: string;
  details?: string[];
  theme?: ThemeDefinition;
  themes?: ThemeDefinition[];
}

function customThemeSource(themeId: string) {
  return { extensionId: `custom-theme.${themeId}`, kind: "custom" as const };
}

function errorResult(error: unknown): ThemeUploadResult {
  if (error instanceof ThemeFileValidationError) {
    return {
      success: false,
      error: "The theme file does not match the Athas theme format.",
      details: error.issues,
    };
  }

  return {
    success: false,
    error: error instanceof Error ? error.message : "Failed to import the theme file.",
  };
}

function unsupportedColorIssues(themes: ReturnType<typeof parseThemeFileJson>["themes"]): string[] {
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return [];

  return themes.flatMap((theme, index) =>
    [
      ...Object.entries(theme.colors).map(([key, value]) => ["colors", key, value] as const),
      ...Object.entries(theme.syntax ?? {}).map(([key, value]) => ["syntax", key, value] as const),
    ].flatMap(([group, key, value]) =>
      CSS.supports("color", value)
        ? []
        : [`themes[${index}].${group}.${key} is not a supported CSS color: ${value}`],
    ),
  );
}

export async function installThemeJson(content: string): Promise<ThemeUploadResult> {
  try {
    const themeFile = parseThemeFileJson(content);
    const colorIssues = unsupportedColorIssues(themeFile.themes);
    if (colorIssues.length > 0) {
      throw new ThemeFileValidationError(colorIssues);
    }
    const storedThemeIds = new Set((await loadCustomThemes()).map((theme) => theme.id));
    const conflicts = themeFile.themes.flatMap((theme, index) => {
      const registeredTheme = themeRegistry.getTheme(theme.id);
      if (!registeredTheme || storedThemeIds.has(theme.id)) return [];

      const source = themeRegistry.getThemeSource(theme.id);
      if (source?.kind === "custom") return [];

      return [`themes[${index}].id conflicts with the existing theme "${registeredTheme.name}"`];
    });

    if (conflicts.length > 0) {
      throw new ThemeFileValidationError(conflicts);
    }

    await installCustomThemes(themeFile.themes);
    const definitions = themeFile.themes.map(toThemeDefinition);
    const activeThemeId = themeRegistry.getCurrentTheme();

    for (const definition of definitions) {
      themeRegistry.registerTheme(definition, customThemeSource(definition.id));
      if (definition.id === activeThemeId) {
        themeRegistry.applyTheme(definition.id);
      }
    }

    return {
      success: true,
      theme: definitions[0],
      themes: definitions,
    };
  } catch (error) {
    return errorResult(error);
  }
}

export async function uploadTheme(file: File): Promise<ThemeUploadResult> {
  if (!file.name.toLowerCase().endsWith(".json")) {
    return {
      success: false,
      error: "Choose an Athas theme JSON file.",
      details: [`${file.name} does not use the .json extension`],
    };
  }

  if (file.size > MAX_THEME_FILE_BYTES) {
    return {
      success: false,
      error: "The theme file is too large.",
      details: ["Athas theme files must be 2 MB or smaller"],
    };
  }

  try {
    return await installThemeJson(await file.text());
  } catch (error) {
    return errorResult(error);
  }
}

export async function deleteCustomTheme(themeId: string): Promise<void> {
  const source = themeRegistry.getThemeSource(themeId);
  if (source?.kind !== "custom") {
    throw new Error("Only imported custom themes can be removed.");
  }

  await removeCustomTheme(themeId);
  themeRegistry.unregisterTheme(themeId);
}

export function chooseThemeFile(onSelect: (file: File) => void): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/json,.json";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) onSelect(file);
  };
  input.click();
}
