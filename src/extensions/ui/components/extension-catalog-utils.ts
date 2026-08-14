import { PLATFORM_ARCH } from "@/utils/platform";
import type { UnifiedExtension } from "./extension-catalog-types";

export function isBuiltInDatabaseProvider(providerId: string): boolean {
  return providerId === "sqlite";
}

export function resolvePackageSize(manifest: {
  installation?: {
    size?: number;
    platformArch?: Record<string, { size?: number }>;
  };
}): number | undefined {
  const platformSize = manifest.installation?.platformArch?.[PLATFORM_ARCH]?.size;
  if (typeof platformSize === "number" && platformSize > 0) return platformSize;
  const size = manifest.installation?.size;
  return typeof size === "number" && size > 0 ? size : undefined;
}

export function getErrorMessage(error: unknown, fallback = "Unknown error"): string {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === "string") return error || fallback;
  return String(error || fallback);
}

export function getCategoryLabel(category: UnifiedExtension["category"]): string {
  const labels: Record<UnifiedExtension["category"], string> = {
    language: "Language",
    theme: "Theme",
    "icon-theme": "Icon Theme",
    database: "Database",
    ai: "AI",
    integration: "Integration",
    skill: "Skill",
    agent: "Agent",
  };
  return labels[category];
}

export function getPrimaryActionLabel(extension: UnifiedExtension): string {
  if (isAppearanceExtension(extension)) {
    if (!extension.isInstalled) return "Install";
    if (!extension.isEnabled) return "Activate";
    return extension.isActive ? "Current" : "Use";
  }
  if (extension.category === "skill") return extension.isInstalled ? "Remove" : "Add";
  if (extension.category === "agent") return extension.isInstalled ? "Uninstall" : "Install";
  return extension.isInstalled ? (extension.isEnabled ? "Deactivate" : "Activate") : "Install";
}

export function isAppearanceExtension(extension: UnifiedExtension): boolean {
  return extension.category === "theme" || extension.category === "icon-theme";
}

export function getAppearanceSettingKey(extension: UnifiedExtension): "theme" | "iconTheme" | null {
  if (extension.category === "theme") return "theme";
  if (extension.category === "icon-theme") return "iconTheme";
  return null;
}

export function getAppearanceOptionLabel(extension: UnifiedExtension, optionId: string): string {
  return (
    extension.appearanceOptions?.find((option) => option.id === optionId)?.name ?? extension.name
  );
}

export function canDeactivateAppearanceExtension(extension: UnifiedExtension): boolean {
  return Boolean(
    isAppearanceExtension(extension) &&
    extension.isInstalled &&
    extension.isEnabled &&
    !extension.isBundled,
  );
}
