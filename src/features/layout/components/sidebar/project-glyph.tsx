import { ProjectCustomIcon } from "@/features/window/components/project-custom-icon";
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
    return <ProjectCustomIcon value={iconPath} className={className} />;
  }

  const Icon = isRemoteProjectPath(projectPath) ? RemoteIcon : projectPath ? FolderIcon : PlusIcon;

  return <Icon className={cn("shrink-0", className)} />;
}
