import { cloneElement, isValidElement } from "react";
import { iconThemeRegistry } from "@/extensions/icon-themes";
import { useSettingsStore } from "@/settings/store";

interface FileIconProps {
  fileName: string;
  isDir: boolean;
  isExpanded?: boolean;
  size?: number;
  className?: string;
}

const FileIcon = ({
  fileName,
  isDir,
  isExpanded = false,
  size = 14,
  className = "text-text-lighter",
}: FileIconProps) => {
  const { settings } = useSettingsStore();
  const iconTheme = iconThemeRegistry.getTheme(settings.iconTheme);

  if (!iconTheme) {
    // Fallback if no theme is found
    return <span className={className}>•</span>;
  }

  const iconResult = iconTheme.getFileIcon(fileName, isDir, isExpanded);

  if (iconResult.component) {
    // If it's a valid React element, clone it and add className
    if (isValidElement(iconResult.component)) {
      return cloneElement(iconResult.component, { className } as any);
    }
    return <span className={className}>{iconResult.component}</span>;
  }

  if (iconResult.svg) {
    return (
      <span
        className={className}
        style={{
          width: `${size}px`,
          height: `${size}px`,
          display: "inline-block",
          lineHeight: 0,
        }}
        dangerouslySetInnerHTML={{ __html: iconResult.svg }}
      />
    );
  }

  return <span className={className}>•</span>;
};

export default FileIcon;
