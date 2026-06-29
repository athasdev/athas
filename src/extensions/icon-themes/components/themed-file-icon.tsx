import DOMPurify from "dompurify";
import { cloneElement, isValidElement, useMemo, useSyncExternalStore } from "react";
import { themeRegistry } from "@/extensions/themes/theme-registry";
import { getDefaultSetting, useSettingsStore } from "@/features/settings/stores/settings.store";
import { cn } from "@/utils/cn";
import { iconThemeRegistry } from "../icon-theme-registry";

const THEMED_FILE_ICON_CACHE_KEY = import.meta.env.DEV ? Date.now().toString(36) : "";

function getIconUrl(url: string) {
  if (!THEMED_FILE_ICON_CACHE_KEY || url.startsWith("data:")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${THEMED_FILE_ICON_CACHE_KEY}`;
}

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
  className = "text-text-lighter",
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
  const sanitizedSvg = useMemo(
    () =>
      iconResult?.svg
        ? DOMPurify.sanitize(iconResult.svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
          })
        : null,
    [iconResult?.svg],
  );

  if (!iconResult) {
    return <span className={className}>&#8226;</span>;
  }

  const iconClassName = cn("themed-file-icon", className);

  const renderIcon = () => {
    if (iconResult.component) {
      if (isValidElement(iconResult.component)) {
        return cloneElement(iconResult.component, {
          className: iconClassName,
        } as React.Attributes & {
          className: string;
        });
      }
      return <span className={iconClassName}>{iconResult.component}</span>;
    }

    if (sanitizedSvg) {
      return <span className={iconClassName} dangerouslySetInnerHTML={{ __html: sanitizedSvg }} />;
    }

    if (iconResult.url) {
      return (
        <img src={getIconUrl(iconResult.url)} alt="" aria-hidden="true" className={iconClassName} />
      );
    }

    return <span className={className}>&#8226;</span>;
  };

  if (isSymlink) {
    return (
      <span className="relative inline-block">
        {renderIcon()}
        <svg
          viewBox="0 0 16 16"
          className="-bottom-0.5 -right-0.5 themed-file-icon-badge absolute text-accent"
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

  return renderIcon();
}
