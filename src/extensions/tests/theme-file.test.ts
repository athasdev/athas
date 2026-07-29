import { describe, expect, it } from "vite-plus/test";
import athasThemes from "@/extensions/themes/builtin/athas.json";
import {
  createThemeFileFromBase,
  formatThemeFile,
  parseThemeFile,
  parseThemeFileJson,
  ThemeFileValidationError,
  toThemeDefinition,
} from "@/extensions/themes/theme-file";
import type { ThemeFile } from "@/extensions/themes/theme-schema";

describe("theme files", () => {
  it("accepts multiple light and dark variants", () => {
    const parsed = parseThemeFile(athasThemes);

    expect(parsed.name).toBe("Athas");
    expect(parsed.themes.map((theme) => theme.id)).toEqual(["athas-light", "athas-dark"]);
  });

  it("reports actionable paths for invalid files", () => {
    try {
      parseThemeFile({
        name: "Broken",
        themes: [{ id: "Broken Theme", name: "", appearance: "blue", colors: {} }],
      });
      throw new Error("Expected validation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(ThemeFileValidationError);
      const issues = (error as ThemeFileValidationError).issues;
      expect(issues).toContain(
        "themes[0].id must start with a lowercase letter or number and contain only lowercase letters, numbers, dots, underscores, or hyphens",
      );
      expect(issues).toContain("themes[0].name must be a non-empty string");
      expect(issues).toContain('themes[0].appearance must be either "dark" or "light"');
      expect(issues).toContain("themes[0].colors.background is required");
    }
  });

  it("reports JSON parsing failures separately from schema failures", () => {
    expect(() => parseThemeFileJson('{"name":')).toThrow(/Invalid JSON:/);
  });

  it("generates a valid editable file from an installed theme", () => {
    const source = (athasThemes as ThemeFile).themes[1];
    const baseTheme = toThemeDefinition(source);
    const generated = createThemeFileFromBase({
      id: "forest-night",
      name: "Forest Night",
      baseTheme,
    });
    const reparsed = parseThemeFileJson(formatThemeFile(generated));

    expect(reparsed.themes[0]).toMatchObject({
      id: "forest-night",
      name: "Forest Night",
      appearance: "dark",
    });
    expect(reparsed.themes[0].colors.background).toBe(source.colors.background);
    expect(reparsed.themes[0].syntax?.keyword).toBe(source.syntax?.keyword);
  });

  it("normalizes legacy roles without emitting duplicate Tailwind variables", () => {
    const legacyTheme = {
      ...(athasThemes as ThemeFile).themes[0],
      colors: {
        "primary-bg": "#101010",
        "secondary-bg": "#181818",
        text: "#f5f5f5",
        "text-light": "#c0c0c0",
        "text-lighter": "#909090",
        border: "#303030",
        hover: "#242424",
        selected: "#2a2a2a",
        accent: "#6699ff",
      },
    };

    const definition = toThemeDefinition(legacyTheme);

    expect(definition.cssVariables).toMatchObject({
      "--background": "#101010",
      "--surface": "#181818",
      "--foreground": "#f5f5f5",
      "--accent": "#242424",
      "--primary": "#6699ff",
    });
    expect(Object.keys(definition.cssVariables).some((key) => key.startsWith("--color-"))).toBe(
      false,
    );
  });
});
