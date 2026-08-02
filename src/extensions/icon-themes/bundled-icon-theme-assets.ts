const BUNDLED_ICON_THEME_ASSETS = import.meta.glob(
  "../bundled/icon-themes/{athas,material,pierre,symbols}/**/*.svg",
  {
    eager: true,
    import: "default",
    query: "?url",
  },
) as Record<string, string>;

const BUNDLED_ICON_THEME_DIRECTORIES: Record<string, string> = {
  "athas.icon-theme.athas-icons": "athas",
  "athas.icon-theme.material": "material",
  "athas.icon-theme.pierre": "pierre",
  "athas.icon-theme.symbols": "symbols",
};

export function resolveBundledIconThemeAsset(
  extensionId: string,
  relativePath: string,
): string | undefined {
  const directory = BUNDLED_ICON_THEME_DIRECTORIES[extensionId];
  if (!directory) {
    return undefined;
  }

  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  return BUNDLED_ICON_THEME_ASSETS[`../bundled/icon-themes/${directory}/${normalizedPath}`];
}
