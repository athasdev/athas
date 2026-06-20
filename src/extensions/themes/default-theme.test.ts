import { describe, expect, it } from "vite-plus/test";
import athasThemes from "./builtin/athas.json";
import {
  getAthasDefaultColor,
  getAthasDefaultCssVariables,
  getAthasDefaultSyntaxColor,
  getAthasDefaultSyntaxTokens,
  getAthasDefaultTheme,
  getRequiredAthasDefaultColor,
  getRequiredAthasDefaultSyntaxColor,
} from "./default-theme";
import type { ThemeFile } from "./theme-schema";

const themeFile = athasThemes as ThemeFile;

describe("Athas default themes", () => {
  it("uses bundled athas.json as the canonical default theme source", () => {
    const bundledDark = themeFile.themes.find((theme) => theme.id === "athas-dark");
    const bundledLight = themeFile.themes.find((theme) => theme.id === "athas-light");

    expect(getAthasDefaultTheme("dark").colors).toEqual(bundledDark?.colors);
    expect(getAthasDefaultTheme("light").syntax).toEqual(bundledLight?.syntax);
  });

  it("builds prefixed CSS and syntax variables from the same defaults", () => {
    expect(getAthasDefaultCssVariables("dark")["--primary-bg"]).toBe(
      getAthasDefaultColor("dark", "primary-bg"),
    );
    expect(getAthasDefaultSyntaxTokens("dark")["--syntax-keyword"]).toBe(
      getAthasDefaultSyntaxColor("dark", "keyword"),
    );
  });

  it("requires bundled default color names to exist", () => {
    expect(getRequiredAthasDefaultColor("dark", "terminal-bright-blue")).toBe(
      getAthasDefaultColor("dark", "terminal-bright-blue"),
    );
    expect(getRequiredAthasDefaultSyntaxColor("light", "keyword")).toBe(
      getAthasDefaultSyntaxColor("light", "keyword"),
    );
    expect(() => getRequiredAthasDefaultColor("dark", "missing-color")).toThrow(
      "Missing Athas dark default color: missing-color",
    );
  });

  it("exposes theme definitions with both raw and tailwind-compatible variables", () => {
    const definition = getAthasDefaultTheme("light").definition;

    expect(definition.cssVariables["--primary-bg"]).toBe(
      getAthasDefaultColor("light", "primary-bg"),
    );
    expect(definition.cssVariables["--color-primary-bg"]).toBe(
      getAthasDefaultColor("light", "primary-bg"),
    );
    expect(definition.syntaxTokens?.["--syntax-keyword"]).toBe(
      getAthasDefaultSyntaxColor("light", "keyword"),
    );
    expect(definition.syntaxTokens?.["--color-syntax-keyword"]).toBe(
      getAthasDefaultSyntaxColor("light", "keyword"),
    );
  });
});
