import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/stores/settings.store";
import type { IconThemeContribution, ThemeContribution } from "../types/extension-manifest";
import { resolveBundledIconThemeAsset } from "../icon-themes/bundled-icon-theme-assets";
import { iconThemeRegistry } from "../icon-themes/icon-theme-registry";
import type { IconResult, IconThemeDefinition } from "../icon-themes/icon-theme.types";
import { themeRegistry } from "../themes/theme-registry";
import { toThemeDefinition as convertThemeToDefinition } from "../themes/theme-file";
import type { ThemeDefinition } from "../themes/theme.types";
import type { ExtensionManifest } from "../types/extension-manifest";
import { getManifestIconContributions } from "../types/extension-contributions";
import { isRetiredExtensionId } from "../registry/retired-extensions";
import { uiExtensionHost } from "../ui/services/ui-extension-host";
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

function toThemeDefinition(contribution: ThemeContribution): ThemeDefinition {
  return convertThemeToDefinition(contribution);
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
  extensionId: string,
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

  const bundledAsset = resolveBundledIconThemeAsset(extensionId, definition);
  if (bundledAsset) {
    return { url: bundledAsset };
  }

  if (definition.startsWith("./") && extensionPath) {
    return { url: convertFileSrc(`${extensionPath}/${definition.slice(2)}`) };
  }

  if (definition.startsWith("/")) {
    return { url: convertFileSrc(definition) };
  }

  return {};
}

function getIconDefinitionsForAppearance(contribution: IconThemeContribution) {
  const currentThemeId =
    themeRegistry.getCurrentTheme() || useSettingsStore.getState().settings.theme;
  const currentTheme = themeRegistry.getTheme(currentThemeId);

  if (currentTheme && !currentTheme.isDark) {
    return contribution.lightIconDefinitions ?? contribution.iconDefinitions;
  }

  return contribution.iconDefinitions;
}

function getFileExtensionCandidates(fileName: string): string[] {
  const parts = fileName.toLowerCase().split(".");
  if (parts.length < 2 || parts[0] === "") {
    return [];
  }

  return parts.map((_, index) => `.${parts.slice(index).join(".")}`);
}

function toIconThemeDefinition(
  extensionId: string,
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
      const iconDefinitions = getIconDefinitionsForAppearance(contribution);
      const normalizedName = fileName.split(/[\\/]/).pop()?.toLowerCase() || fileName.toLowerCase();

      if (isDir) {
        const folderIcon =
          (isExpanded ? expandedFolders.get(normalizedName) : undefined) ||
          folders.get(normalizedName) ||
          (isExpanded ? contribution.defaultFolderOpen : undefined) ||
          contribution.defaultFolder;

        return resolveIcon(iconDefinitions, folderIcon, extensionId, extensionPath);
      }

      const icon =
        filenames.get(normalizedName) ||
        getFileExtensionCandidates(normalizedName)
          .map((extension) => fileExtensions.get(extension))
          .find(Boolean) ||
        contribution.defaultFile;

      return resolveIcon(iconDefinitions, icon, extensionId, extensionPath);
    },
  };
}

function iconThemeUsesRelativePaths(iconThemes: IconThemeContribution[]): boolean {
  return iconThemes.some((theme) =>
    [theme.iconDefinitions, theme.lightIconDefinitions].some((definitions) =>
      Object.values(definitions ?? {}).some((definition) => definition.startsWith("./")),
    ),
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
  void useSettingsStore.getState().actions.updateSetting("theme", fallback);
}

function fallbackIconThemeIfNeeded(iconThemes: IconThemeContribution[]) {
  const currentIconTheme = useSettingsStore.getState().settings.iconTheme;
  if (!iconThemes.some((theme) => theme.id === currentIconTheme)) {
    return;
  }

  void useSettingsStore
    .getState()
    .actions.updateSetting("iconTheme", getDefaultSetting("iconTheme"));
}

export async function activateExtensionContributions(
  extensionId: string,
  manifest: ExtensionManifest,
  extensionPath?: string,
): Promise<void> {
  if (isRetiredExtensionId(extensionId)) {
    return;
  }

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
    iconThemeRegistry.registerTheme(
      toIconThemeDefinition(extensionId, iconTheme, resolvedExtensionPath),
      {
        extensionId,
      },
    );
  }

  await activateBundledContributionModule(extensionId, manifest);
  if (manifest.main) {
    await uiExtensionHost.loadExtension(manifest, resolvedExtensionPath);
  }
}

export async function deactivateExtensionContributions(
  extensionId: string,
  manifest: ExtensionManifest,
): Promise<void> {
  await uiExtensionHost.unloadExtension(extensionId);
  await deactivateBundledContributionModule(extensionId, manifest);
  fallbackThemeIfNeeded(getThemeContributions(manifest));
  fallbackIconThemeIfNeeded(getIconThemeContributions(manifest));
  themeRegistry.unregisterThemesByExtension(extensionId);
  iconThemeRegistry.unregisterThemesByExtension(extensionId);
}
