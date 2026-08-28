import type { IconResult, IconThemeDefinition } from "../icon-themes/icon-theme.types";
import type { ThemeDefinition } from "../themes/theme.types";

export type AppearancePreview =
  | {
      kind: "theme";
      label: string;
      colors: string[];
    }
  | {
      kind: "icon-theme";
      label: string;
      icon: IconResult;
    };

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

export function getRepresentativeIcon(theme: IconThemeDefinition): IconResult | null {
  const fallbackTargets = [
    { fileName: "index.ts", isDirectory: false },
    { fileName: "package.json", isDirectory: false },
    { fileName: "src", isDirectory: true },
  ];
  const targets = theme.preview ? [theme.preview, ...fallbackTargets] : fallbackTargets;

  for (const target of targets) {
    const result = theme.getFileIcon(target.fileName, target.isDirectory);
    if (result.svg || result.url || result.component) return result;
  }

  return null;
}

export function getThemeAppearancePreview(theme: ThemeDefinition): AppearancePreview | undefined {
  const colors = getThemePreviewColors(theme);
  if (colors.length === 0) return undefined;

  return {
    kind: "theme",
    label: `${theme.name} color palette`,
    colors,
  };
}

export function getIconThemeAppearancePreview(
  theme: IconThemeDefinition,
): AppearancePreview | undefined {
  const icon = getRepresentativeIcon(theme);
  if (!icon) return undefined;

  return {
    kind: "icon-theme",
    label: `${theme.name} icon theme preview`,
    icon,
  };
}
