import { describe, expect, it } from "vite-plus/test";
import {
  getAthasDefaultColor,
  getAthasDefaultSyntaxColor,
} from "@/extensions/themes/default-theme";
import {
  ATHAS_BOOTSTRAP_DEFAULTS,
  DEFAULT_APPEARANCE_BOOTSTRAP_CACHE,
} from "../lib/appearance-bootstrap";

describe("appearance bootstrap defaults", () => {
  it("uses the bundled Athas dark theme for startup CSS variables", () => {
    expect(DEFAULT_APPEARANCE_BOOTSTRAP_CACHE.themeId).toBe("athas-dark");
    expect(DEFAULT_APPEARANCE_BOOTSTRAP_CACHE.themeType).toBe("dark");
    expect(DEFAULT_APPEARANCE_BOOTSTRAP_CACHE.cssVariables["--primary-bg"]).toBe(
      getAthasDefaultColor("dark", "primary-bg"),
    );
    expect(DEFAULT_APPEARANCE_BOOTSTRAP_CACHE.syntaxTokens["--syntax-keyword"]).toBe(
      getAthasDefaultSyntaxColor("dark", "keyword"),
    );
  });

  it("keeps bootstrap theme metadata aligned with Athas defaults", () => {
    expect(ATHAS_BOOTSTRAP_DEFAULTS.light.colors["primary-bg"]).toBe(
      getAthasDefaultColor("light", "primary-bg"),
    );
    expect(ATHAS_BOOTSTRAP_DEFAULTS.dark.syntax.keyword).toBe(
      getAthasDefaultSyntaxColor("dark", "keyword"),
    );
  });
});
