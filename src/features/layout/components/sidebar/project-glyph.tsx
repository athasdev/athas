import { ProjectCustomIcon } from "@/features/workspace/project-icons/components/project-custom-icon";
import { FolderIcon, PlusIcon, RemoteIcon } from "@/ui/icons";
import { cn } from "@/utils/cn";
import { isRemoteProjectPath } from "@/features/workspace/services/project-tab-path";

export function ProjectGlyph({
  projectPath,
  iconPath,
  className,
  imageClassName,
}: {
  projectPath?: string;
  iconPath?: string;
  className?: string;
  imageClassName?: string;
}) {
  if (iconPath) {
    return (
      <ProjectCustomIcon value={iconPath} className={className} imageClassName={imageClassName} />
    );
  }

  const Icon = isRemoteProjectPath(projectPath) ? RemoteIcon : projectPath ? FolderIcon : PlusIcon;

  return <Icon className={cn("shrink-0", className)} />;
}
