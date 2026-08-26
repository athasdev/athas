import type { ThemeDefinition } from "@/extensions/themes/theme.types";

export function getThemePreviewColors(theme: ThemeDefinition): string[] {
  const colors = [
    theme.cssVariables["--primary"],
    theme.syntaxTokens?.["--syntax-keyword"],
    theme.syntaxTokens?.["--syntax-string"],
    theme.cssVariables["--surface"],
    theme.cssVariables["--foreground"],
    theme.cssVariables["--background"],
  ].filter((color): color is string => Boolean(color));

  return colors.slice(0, 4);
}
