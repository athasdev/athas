import DOMPurify from "dompurify";
import { cloneElement, isValidElement } from "react";
import { iconThemeRegistry } from "@/extensions/icon-themes/icon-theme-registry";
import { useSettingsStore } from "@/features/settings/store";

interface FileIconProps {
  fileName: string;
  isDir: boolean;
  isExpanded?: boolean;
  isSymlink?: boolean;
  size?: number;
  className?: string;
}

export function FileIcon({
  fileName,
  isDir,
  isExpanded = false,
  isSymlink = false,
  size = 14,
  className = "text-text-lighter",
}: FileIconProps) {
  const { settings } = useSettingsStore();
  const iconTheme = iconThemeRegistry.getTheme(settings.iconTheme);

  if (!iconTheme) {
    return <span className={className}>&#8226;</span>;
  }

  const iconResult = iconTheme.getFileIcon(fileName, isDir, isExpanded, isSymlink);
  const sanitizedSvg = iconResult.svg
    ? DOMPurify.sanitize(iconResult.svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
      })
    : null;

  const renderIcon = () => {
    if (iconResult.component) {
      if (isValidElement(iconResult.component)) {
        return cloneElement(iconResult.component, { className } as React.Attributes & {
          className: string;
        });
      }
      return <span className={className}>{iconResult.component}</span>;
    }

    if (sanitizedSvg) {
      return (
        <span
          className={className}
          style={{
            width: `${size}px`,
            height: `${size}px`,
            display: "inline-block",
            lineHeight: 0,
          }}
          dangerouslySetInnerHTML={{ __html: sanitizedSvg }}
        />
      );
    }

    return <span className={className}>&#8226;</span>;
  };

  if (isSymlink) {
    return (
      <span className="relative inline-block">
        {renderIcon()}
        <svg
          width="8"
          height="8"
          viewBox="0 0 16 16"
          className="-bottom-0.5 -right-0.5 absolute text-accent drop-shadow-sm"
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
