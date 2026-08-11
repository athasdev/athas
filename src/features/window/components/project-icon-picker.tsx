import { TrashIcon as Trash2 } from "@/ui/icons";
import { memo, useCallback, useEffect, useState } from "react";
import { useRecentFoldersStore } from "@/features/file-system/stores/recent-folders.store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { scanProjectIconFiles, type ProjectIconFile } from "@/features/window/utils/project-icons";
import { Button } from "@/ui/button";
import Dialog from "@/ui/dialog";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/ui/empty";
import { Spinner } from "@/ui/spinner";
import Tooltip from "@/ui/tooltip";

function relativePath(fullPath: string, basePath: string): string {
  const normalized = fullPath.startsWith(basePath) ? fullPath.slice(basePath.length) : fullPath;
  return normalized.replace(/^[/\\]/, "");
}

interface ProjectIconPickerProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectPath: string;
}

const ProjectIconPicker = memo(
  ({ isOpen, onClose, projectId, projectPath }: ProjectIconPickerProps) => {
    const [icons, setIcons] = useState<ProjectIconFile[]>([]);
    const [loading, setLoading] = useState(false);
    const { setProjectIcon } = useWorkspaceTabsStore.getState().actions;
    const currentIcon = useWorkspaceTabsStore(
      (s) => s.projectTabs.find((t) => t.id === projectId)?.customIcon,
    );

    useEffect(() => {
      if (!isOpen) return;

      setLoading(true);
      scanProjectIconFiles(projectPath).then((found) => {
        setIcons(found);
        setLoading(false);
      });
    }, [isOpen, projectPath]);

    const handleSelect = useCallback(
      (iconPath: string) => {
        setProjectIcon(projectId, iconPath);
        useRecentFoldersStore.getState().actions.updateRecentFolder(projectPath, {
          activeProjectTabId: projectId,
          customIcon: iconPath,
        });
        onClose();
      },
      [projectId, projectPath, onClose, setProjectIcon],
    );

    const handleRemoveIcon = useCallback(() => {
      setProjectIcon(projectId, undefined);
      useRecentFoldersStore.getState().actions.updateRecentFolder(projectPath, {
        activeProjectTabId: projectId,
        customIcon: undefined,
      });
      onClose();
    }, [projectId, projectPath, onClose, setProjectIcon]);

    if (!isOpen) return null;

    return (
      <Dialog
        title="Select project icon"
        onClose={onClose}
        size="sm"
        headerBorder={false}
        headerActions={
          currentIcon ? (
            <Tooltip content="Remove icon" side="bottom">
              <Button
                onClick={handleRemoveIcon}
                variant="ghost"
                aria-label="Remove custom icon"
                size="icon-xs"
              >
                <Trash2 />
              </Button>
            </Tooltip>
          ) : undefined
        }
        classNames={{
          modal: "max-w-90 rounded-xl",
          content: "p-3",
        }}
      >
        {loading ? (
          <Empty className="min-h-0 flex-none py-6">
            <EmptyDescription>
              <Spinner label="Scanning for icons" showLabel compact />
            </EmptyDescription>
          </Empty>
        ) : icons.length === 0 ? (
          <Empty className="min-h-0 flex-none py-6">
            <EmptyHeader>
              <EmptyTitle>No icon files found in this project</EmptyTitle>
              <EmptyDescription>
                Looks for .ico, icon/logo/favicon .png and .svg files
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="grid grid-cols-6 gap-1.5">
            {icons.map((icon) => (
              <Tooltip key={icon.path} content={relativePath(icon.path, projectPath)} side="bottom">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => handleSelect(icon.path)}
                  className={`group size-12 border ${
                    currentIcon === icon.path ? "border-primary bg-primary/10" : "border-border/50"
                  }`}
                  aria-label={`Select ${icon.name} as project icon`}
                  size="icon"
                >
                  <img
                    src={icon.src}
                    alt={icon.name}
                    className="size-7 object-contain"
                    onError={(e) => {
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                </Button>
              </Tooltip>
            ))}
          </div>
        )}
      </Dialog>
    );
  },
);

ProjectIconPicker.displayName = "ProjectIconPicker";

export default ProjectIconPicker;
