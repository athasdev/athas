import { describe, expect, it } from "vite-plus/test";
import type { ThemeDefinition } from "@/extensions/themes/theme.types";
import {
  createMonacoTokenThemeRules,
  MONACO_TOKEN_THEME_INHERITS_BASE,
} from "../engines/monaco/token-theme-rules";

const theme: ThemeDefinition = {
  id: "test-theme",
  name: "Test Theme",
  description: "Theme fixture",
  category: "Dark",
  cssVariables: {
    "--destructive": "#dd1122",
  },
  syntaxTokens: {
    "--syntax-attribute": "#dd8800",
    "--syntax-boolean": "#cc0088",
    "--syntax-comment": "#778899",
    "--syntax-keyword": "#aabbcc",
    "--syntax-null": "#8855aa",
    "--syntax-number": "#aa6600",
    "--syntax-property": "#0066aa",
    "--syntax-string": "#228844",
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
    expect(rules.find((rule) => rule.token === "comment.deprecated")).toEqual({
      token: "comment.deprecated",
      fontStyle: "italic strikethrough",
    });
  });

  it("keeps comment tokens upright when the preference is disabled", () => {
    const rules = createMonacoTokenThemeRules(theme, false);

    expect(rules.find((rule) => rule.token === "comment")).toEqual({
      token: "comment",
      foreground: "778899",
    });
  });

  it("maps every JSON value category without falling back to Monaco blue", () => {
    const rules = createMonacoTokenThemeRules(theme, false);

    expect(rules).toEqual(
      expect.arrayContaining([
        { token: "string.key.json", foreground: "0066aa" },
        { token: "string.value.json", foreground: "228844" },
        { token: "number.json", foreground: "aa6600" },
        { token: "keyword.json", foreground: "cc0088" },
      ]),
    );
  });

  it("owns language-specific child tokens and presentation styles", () => {
    const rules = createMonacoTokenThemeRules(theme, false);

    expect(rules).toEqual(
      expect.arrayContaining([
        { token: "attribute.value", foreground: "228844" },
        { token: "attribute.value.number", foreground: "aa6600" },
        { token: "invalid", foreground: "dd1122" },
        { token: "string.invalid", foreground: "dd1122" },
        { token: "emphasis", fontStyle: "italic" },
        { token: "strong", fontStyle: "bold" },
        { token: "variable.deprecated", fontStyle: "strikethrough" },
      ]),
    );
  });

  it("does not inherit Visual Studio token rules", () => {
    expect(MONACO_TOKEN_THEME_INHERITS_BASE).toBe(false);
  });
});
