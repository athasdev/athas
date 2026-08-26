import { describe, expect, it } from "vite-plus/test";
import type { ThemeDefinition } from "@/extensions/themes/theme.types";
import { getThemePreviewColors } from "../utils/theme-preview";

const theme: ThemeDefinition = {
  id: "test-theme",
  name: "Test theme",
  description: "Test theme colors",
  category: "Dark",
  cssVariables: {
    "--primary": "#111111",
    "--surface": "#444444",
    "--foreground": "#555555",
    "--background": "#666666",
  },
  syntaxTokens: {
    "--syntax-keyword": "#222222",
    "--syntax-string": "#333333",
  },
};

describe("theme preview colors", () => {
  it("prefers accent and syntax colors before neutral surfaces", () => {
    expect(getThemePreviewColors(theme)).toEqual(["#111111", "#222222", "#333333", "#444444"]);
  });

  it("falls back to foreground and background when syntax colors are missing", () => {
    expect(
      getThemePreviewColors({
        ...theme,
        syntaxTokens: undefined,
      }),
    ).toEqual(["#111111", "#444444", "#555555", "#666666"]);
  });
});
