import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/stores/settings.store";
import type { IconThemeContribution, ThemeContribution } from "../types/extension-manifest";
import { iconThemeRegistry } from "../icon-themes/icon-theme-registry";
import type { IconResult, IconThemeDefinition } from "../icon-themes/types";
import { themeRegistry } from "../themes/theme-registry";
import type { ThemeDefinition } from "../themes/types";
import type { ExtensionManifest } from "../types/extension-manifest";
import { getManifestIconContributions } from "../types/extension-contributions";
import {
  activateBundledContributionModule,
  deactivateBundledContributionModule,
} from "../bundled/bundled-contribution-modules";

function getThemeContributions(manifest: ExtensionManifest): ThemeContribution[] {
  return [...(manifest.themes ?? []), ...(manifest.contributes?.themes ?? [])];
}

function getIconThemeContributions(manifest: ExtensionManifest): IconThemeContribution[] {
  return getManifestIconContributions(manifest);
}

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

function resolveIcon(
  definitions: Record<string, string>,
  iconKey: string | undefined,
  extensionPath?: string,
): IconResult {
  if (!iconKey) return {};

  const definition = definitions[iconKey] ?? iconKey;

  if (definition.trim().startsWith("<svg")) {
    return { svg: definition };
  }

  if (
    definition.startsWith("http://") ||
    definition.startsWith("https://") ||
    definition.startsWith("data:") ||
    definition.startsWith("asset:")
  ) {
    return { url: definition };
  }

  if (definition.startsWith("./") && extensionPath) {
    return { url: convertFileSrc(`${extensionPath}/${definition.slice(2)}`) };
  }

  if (definition.startsWith("/")) {
    return { url: convertFileSrc(definition) };
  }

  return {};
}

function getFileExtensionCandidates(fileName: string): string[] {
  const parts = fileName.toLowerCase().split(".");
  if (parts.length < 2 || parts[0] === "") {
    return [];
  }

  return parts.map((_, index) => `.${parts.slice(index).join(".")}`);
}

function toIconThemeDefinition(
  contribution: IconThemeContribution,
  extensionPath?: string,
): IconThemeDefinition {
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

        return resolveIcon(contribution.iconDefinitions, folderIcon, extensionPath);
      }

      const icon =
        filenames.get(normalizedName) ||
        getFileExtensionCandidates(normalizedName)
          .map((extension) => fileExtensions.get(extension))
          .find(Boolean) ||
        contribution.defaultFile;

      return resolveIcon(contribution.iconDefinitions, icon, extensionPath);
    },
  };
}

function iconThemeUsesRelativePaths(iconThemes: IconThemeContribution[]): boolean {
  return iconThemes.some((theme) =>
    Object.values(theme.iconDefinitions).some((definition) => definition.startsWith("./")),
  );
}

async function resolveContributionExtensionPath(
  extensionId: string,
  iconThemes: IconThemeContribution[],
  extensionPath: string | undefined,
): Promise<string | undefined> {
  if (extensionPath || !iconThemeUsesRelativePaths(iconThemes)) {
    return extensionPath;
  }

  try {
    return await invoke<string>("get_extension_path", { extensionId });
  } catch (error) {
    console.warn(`Failed to resolve extension path for ${extensionId}:`, error);
    return undefined;
  }
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
  extensionPath?: string,
): Promise<void> {
  const iconThemes = getIconThemeContributions(manifest);
  const resolvedExtensionPath = await resolveContributionExtensionPath(
    extensionId,
    iconThemes,
    extensionPath,
  );

  for (const theme of getThemeContributions(manifest)) {
    themeRegistry.registerTheme(toThemeDefinition(theme), { extensionId });
  }

  for (const iconTheme of iconThemes) {
    iconThemeRegistry.registerTheme(toIconThemeDefinition(iconTheme, resolvedExtensionPath), {
      extensionId,
    });
  }

  await activateBundledContributionModule(extensionId, manifest);
}

export async function deactivateExtensionContributions(
  extensionId: string,
  manifest: ExtensionManifest,
): Promise<void> {
  await deactivateBundledContributionModule(extensionId, manifest);
  fallbackThemeIfNeeded(getThemeContributions(manifest));
  fallbackIconThemeIfNeeded(getIconThemeContributions(manifest));
  themeRegistry.unregisterThemesByExtension(extensionId);
  iconThemeRegistry.unregisterThemesByExtension(extensionId);
}
