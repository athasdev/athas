import { describe, expect, it } from "vite-plus/test";
import type { ThemeDefinition } from "@/extensions/themes/theme.types";
import { createMonacoTokenThemeRules } from "../engines/monaco/token-theme-rules";

const theme: ThemeDefinition = {
  id: "test-theme",
  name: "Test Theme",
  description: "Theme fixture",
  category: "Dark",
  cssVariables: {},
  syntaxTokens: {
    "--syntax-comment": "#778899",
    "--syntax-keyword": "#aabbcc",
  },
  isDark: true,
};

describe("Monaco token theme rules", () => {
  it("italicizes comment tokens when the preference is enabled", () => {
    const rules = createMonacoTokenThemeRules(theme, true);

    expect(rules).toEqual(
      expect.arrayContaining([
        { token: "comment", foreground: "778899", fontStyle: "italic" },
        { token: "comment.documentation", foreground: "778899", fontStyle: "italic" },
      ]),
    );
    expect(rules.find((rule) => rule.token === "keyword")).not.toHaveProperty("fontStyle");
  });

  it("keeps comment tokens upright when the preference is disabled", () => {
    const rules = createMonacoTokenThemeRules(theme, false);

    expect(rules.find((rule) => rule.token === "comment")).toEqual({
      token: "comment",
      foreground: "778899",
    });
  });
});
