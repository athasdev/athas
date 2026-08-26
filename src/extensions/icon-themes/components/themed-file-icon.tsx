import { useMemo, useSyncExternalStore } from "react";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/stores/settings.store";
import { iconThemeRegistry } from "../icon-theme-registry";
import { IconThemeGraphic } from "./icon-theme-graphic";

interface ThemedFileIconProps {
  fileName: string;
  isDir: boolean;
  isExpanded?: boolean;
  isSymlink?: boolean;
  className?: string;
}

export function ThemedFileIcon({
  fileName,
  isDir,
  isExpanded = false,
  isSymlink = false,
  className = "text-subtle-foreground",
}: ThemedFileIconProps) {
  const iconThemeId = useSettingsStore((state) => state.settings.iconTheme);
  useSyncExternalStore(
    (callback) => iconThemeRegistry.onRegistryChange(callback),
    () => iconThemeRegistry.getVersion(),
    () => iconThemeRegistry.getVersion(),
  );
  const colorThemeId = useSyncExternalStore(
    (callback) => themeRegistry.onThemeChange(callback),
    () => themeRegistry.getCurrentTheme(),
    () => themeRegistry.getCurrentTheme(),
  );
  const iconTheme =
    iconThemeRegistry.getTheme(iconThemeId) ??
    iconThemeRegistry.getTheme(getDefaultSetting("iconTheme"));

  const iconResult = useMemo(
    () => iconTheme?.getFileIcon(fileName, isDir, isExpanded, isSymlink) ?? null,
    [fileName, iconTheme, isDir, isExpanded, isSymlink, colorThemeId],
  );
  const icon = <IconThemeGraphic result={iconResult} className={className} />;

  if (isSymlink) {
    return (
      <span className="relative inline-block">
        {icon}
        <svg
          viewBox="0 0 16 16"
          className="absolute -right-0.5 -bottom-0.5 size-[0.72em] text-primary"
          role="img"
          aria-label="Symlink"
        >
          <title>Symlink</title>
          <path
            fill="currentColor"
            d="M6.879 9.934a.81.81 0 0 1-.575-.238 3.818 3.818 0 0 1 0-5.392l3-3C10.024.584 10.982.187 12 .187s1.976.397 2.696 1.117a3.818 3.818 0 0 1 0 5.392l-1.371 1.371a.813.813 0 0 1-1.149-1.149l1.371-1.371A2.19 2.19 0 0 0 12 1.812c-.584 0-1.134.228-1.547.641l-3 3a2.19 2.19 0 0 0 0 3.094.813.813 0 0 1-.575 1.387z"
          />
          <path
            fill="currentColor"
            d="M4 15.813a3.789 3.789 0 0 1-2.696-1.117 3.818 3.818 0 0 1 0-5.392l1.371-1.371a.813.813 0 0 1 1.149 1.149l-1.371 1.371A2.19 2.19 0 0 0 4 14.188c.585 0 1.134-.228 1.547-.641l3-3a2.19 2.19 0 0 0 0-3.094.813.813 0 0 1 1.149-1.149 3.818 3.818 0 0 1 0 5.392l-3 3A3.789 3.789 0 0 1 4 15.813z"
          />
        </svg>
      </span>
    );
  }

  return icon;
}
