import { convertFileSrc } from "@tauri-apps/api/core";
import { FolderIcon, PlusIcon, RemoteIcon } from "@/ui/icons";
import { cn } from "@/utils/cn";

export function getProjectNameFromPath(path?: string) {
  if (!path) return "Open Project";
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

export function isRemoteProjectPath(path?: string) {
  return path?.startsWith("remote://") === true;
}

export function ProjectGlyph({
  projectPath,
  iconPath,
  className,
}: {
  projectPath?: string;
  iconPath?: string;
  className?: string;
}) {
  if (iconPath) {
    return (
      <img
        src={convertFileSrc(iconPath)}
        alt=""
        className={cn("shrink-0 rounded-md object-contain", className ?? "size-4")}
      />
    );
  }

  const Icon = isRemoteProjectPath(projectPath) ? RemoteIcon : projectPath ? FolderIcon : PlusIcon;

  return <Icon className={cn("shrink-0", className ?? "size-4")} />;
}
