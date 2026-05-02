import { getDefaultSetting, useSettingsStore } from "@/features/settings/store";
import type { IconThemeContribution, ThemeContribution } from "../types/extension-manifest";
import { iconThemeRegistry } from "../icon-themes/icon-theme-registry";
import type { IconThemeDefinition } from "../icon-themes/types";
import { themeRegistry } from "../themes/theme-registry";
import type { ThemeDefinition } from "../themes/types";
import type { ExtensionManifest } from "../types/extension-manifest";

function toCssVariables(colors: Record<string, string>): Record<string, string> {
  const variables: Record<string, string> = {};

  for (const [key, value] of Object.entries(colors)) {
    const normalizedKey = key.startsWith("--") ? key : `--${key}`;
    variables[normalizedKey] = value;

    if (!normalizedKey.startsWith("--color-")) {
      variables[`--color-${normalizedKey.slice(2)}`] = value;
    }
  }

  return variables;
}

function toSyntaxVariables(syntax: Record<string, string> | undefined): Record<string, string> {
  const variables: Record<string, string> = {};

  for (const [key, value] of Object.entries(syntax ?? {})) {
    const normalizedKey = key.startsWith("--") ? key : `--syntax-${key}`;
    variables[normalizedKey] = value;

    if (!normalizedKey.startsWith("--color-")) {
      variables[`--color-${normalizedKey.slice(2)}`] = value;
    }
  }

  return variables;
}

function toThemeDefinition(contribution: ThemeContribution): ThemeDefinition {
  const isDark = contribution.appearance === "dark";

  return {
    id: contribution.id,
    name: contribution.name,
    description: contribution.description || "",
    category: isDark ? "Dark" : "Light",
    cssVariables: toCssVariables(contribution.colors),
    syntaxTokens: toSyntaxVariables(contribution.syntax),
    isDark,
  };
}

function normalizeLookupMap(map: Record<string, string> | undefined, withDot = false) {
  const normalized = new Map<string, string>();

  for (const [key, value] of Object.entries(map ?? {})) {
    const lookupKey = withDot && !key.startsWith(".") ? `.${key}` : key;
    normalized.set(lookupKey.toLowerCase(), value);
  }

  return normalized;
}

function resolveIconSvg(
  definitions: Record<string, string>,
  iconKey: string | undefined,
): string | undefined {
  if (!iconKey) return undefined;
  return definitions[iconKey] ?? iconKey;
}

function getFileExtension(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index > 0 ? fileName.slice(index).toLowerCase() : "";
}

function toIconThemeDefinition(contribution: IconThemeContribution): IconThemeDefinition {
  const filenames = normalizeLookupMap(contribution.filenames);
  const fileExtensions = normalizeLookupMap(contribution.fileExtensions, true);
  const folders = normalizeLookupMap(contribution.folders);
  const expandedFolders = normalizeLookupMap(contribution.expandedFolders);

  return {
    id: contribution.id,
    name: contribution.name,
    description: contribution.description || "",
    getFileIcon: (fileName, isDir, isExpanded = false) => {
      const normalizedName = fileName.split(/[\\/]/).pop()?.toLowerCase() || fileName.toLowerCase();

      if (isDir) {
        const folderIcon =
          (isExpanded ? expandedFolders.get(normalizedName) : undefined) ||
          folders.get(normalizedName) ||
          (isExpanded ? contribution.defaultFolderOpen : undefined) ||
          contribution.defaultFolder;

        return { svg: resolveIconSvg(contribution.iconDefinitions, folderIcon) };
      }

      const icon =
        filenames.get(normalizedName) ||
        fileExtensions.get(getFileExtension(normalizedName)) ||
        contribution.defaultFile;

      return { svg: resolveIconSvg(contribution.iconDefinitions, icon) };
    },
  };
}

function fallbackThemeIfNeeded(themes: ThemeContribution[]) {
  const currentTheme =
    themeRegistry.getCurrentTheme() || useSettingsStore.getState().settings.theme;
  if (!themes.some((theme) => theme.id === currentTheme)) {
    return;
  }

  const fallback = getDefaultSetting("theme");
  themeRegistry.applyTheme(fallback);
  void useSettingsStore.getState().updateSetting("theme", fallback);
}

function fallbackIconThemeIfNeeded(iconThemes: IconThemeContribution[]) {
  const currentIconTheme = useSettingsStore.getState().settings.iconTheme;
  if (!iconThemes.some((theme) => theme.id === currentIconTheme)) {
    return;
  }

  void useSettingsStore.getState().updateSetting("iconTheme", getDefaultSetting("iconTheme"));
}

export async function activateExtensionContributions(
  extensionId: string,
  manifest: ExtensionManifest,
): Promise<void> {
  for (const theme of manifest.themes ?? []) {
    themeRegistry.registerTheme(toThemeDefinition(theme), { extensionId });
  }

  for (const iconTheme of manifest.iconThemes ?? []) {
    iconThemeRegistry.registerTheme(toIconThemeDefinition(iconTheme), { extensionId });
  }
}

export async function deactivateExtensionContributions(
  extensionId: string,
  manifest: ExtensionManifest,
): Promise<void> {
  fallbackThemeIfNeeded(manifest.themes ?? []);
  fallbackIconThemeIfNeeded(manifest.iconThemes ?? []);
  themeRegistry.unregisterThemesByExtension(extensionId);
  iconThemeRegistry.unregisterThemesByExtension(extensionId);
}
