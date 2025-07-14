import { Folder, FolderOpen } from "lucide-react";
import { getIcon } from "material-file-icons";

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
  // Use Lucide icons for directories
  if (isDir) {
    const Icon = isExpanded ? FolderOpen : Folder;
    return <Icon className={className} size={size} />;
  }

  // Get the icon from material-file-icons for files
  const icon = getIcon(fileName);

  // Always render in monochrome
  const svgContent = icon.svg
    .replace(/fill="[^"]*"/g, 'fill="currentColor"')
    .replace(/stroke="[^"]*"/g, 'stroke="currentColor"');

  return (
    <span
      className={className}
      style={{
        width: `${size}px`,
        height: `${size}px`,
        display: "inline-block",
        lineHeight: 0,
      }}
      dangerouslySetInnerHTML={{ __html: svgContent }}
    />
  );
};

export default FileIcon;
