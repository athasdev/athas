import { useState } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import ProjectIconPicker from "@/features/window/components/project-icon-picker";
import type { ProjectTab } from "@/features/window/stores/workspace-tabs.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import {
  CopyIcon,
  FolderOpenIcon,
  ImageIcon,
  OpenExternalIcon,
  TrashIcon,
  WindowExpandIcon,
} from "@/ui/icons";
import { writeClipboardText } from "@/utils/clipboard";
import { cn } from "@/utils/cn";
import { isRemoteProjectPath } from "./project-glyph";

export function ActivityProjectDots({
  projects,
  activeProjectId,
  isSwitchingProject,
  onSelectProject,
}: {
  projects: ProjectTab[];
  activeProjectId?: string;
  isSwitchingProject: boolean;
  onSelectProject: (projectId: string) => void;
}) {
  const closeProject = useFileSystemStore((state) => state.closeProject);
  const [iconPickerProject, setIconPickerProject] = useState<ProjectTab | null>(null);

  if (projects.length === 0) return null;

  return (
    <>
      <div className="scrollbar-none pointer-events-none absolute right-workbench bottom-1.5 left-0 z-20 flex items-center justify-center overflow-x-auto px-2">
        {projects.map((project) => {
          const isRemote = isRemoteProjectPath(project.path);
          const isActive = project.id === activeProjectId;

          return (
            <ContextMenu key={project.id}>
              <ContextMenuTrigger
                role="button"
                tabIndex={isSwitchingProject ? -1 : 0}
                className={cn(
                  "group pointer-events-auto flex size-4 shrink-0 items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  isSwitchingProject && "cursor-default",
                )}
                aria-label={`${isActive ? "Current project" : "Switch to"} ${project.name}`}
                aria-current={isActive ? "page" : undefined}
                aria-disabled={isSwitchingProject}
                onContextMenu={(event) => event.stopPropagation()}
                onClick={() => {
                  if (!isSwitchingProject) onSelectProject(project.id);
                }}
                onKeyDown={(event) => {
                  if (isSwitchingProject || (event.key !== "Enter" && event.key !== " ")) return;
                  event.preventDefault();
                  onSelectProject(project.id);
                }}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "size-1.5 rounded-full bg-foreground transition-[opacity,transform] duration-fast ease-smooth",
                    isActive
                      ? "scale-100 opacity-100"
                      : "scale-75 opacity-25 group-hover:scale-100 group-hover:opacity-50",
                  )}
                />
              </ContextMenuTrigger>
              <ContextMenuContent side="top" sideOffset={6} align="center">
                <ContextMenuItem
                  disabled={isActive || isSwitchingProject}
                  onClick={() => onSelectProject(project.id)}
                >
                  <OpenExternalIcon />
                  Switch to Project
                </ContextMenuItem>
                <ContextMenuItem onClick={() => void writeClipboardText(project.path)}>
                  <CopyIcon />
                  Copy Path
                </ContextMenuItem>
                {!isRemote ? (
                  <ContextMenuItem
                    onClick={() =>
                      useFileSystemStore.getState().handleRevealInFolder?.(project.path)
                    }
                  >
                    <FolderOpenIcon />
                    Reveal in Finder
                  </ContextMenuItem>
                ) : null}
                <ContextMenuItem
                  onClick={() => {
                    if (isRemote) {
                      const match = project.path.match(/^remote:\/\/([^/]+)(\/.*)?$/);
                      if (!match) return;
                      void createAppWindow({
                        remoteConnectionId: match[1],
                        remoteConnectionName: project.name,
                      });
                      return;
                    }

                    void createAppWindow({ path: project.path, isDirectory: true });
                  }}
                >
                  <WindowExpandIcon />
                  Open in New Window
                </ContextMenuItem>
                {!isRemote ? (
                  <ContextMenuItem onClick={() => setIconPickerProject(project)}>
                    <ImageIcon />
                    Select Icon
                  </ContextMenuItem>
                ) : null}
                <ContextMenuSeparator />
                <ContextMenuItem
                  variant="destructive"
                  onClick={() => void closeProject(project.id)}
                >
                  <TrashIcon />
                  Remove Project
                </ContextMenuItem>
              </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>
      {iconPickerProject ? (
        <ProjectIconPicker
          isOpen
          onClose={() => setIconPickerProject(null)}
          projectId={iconPickerProject.id}
          projectPath={iconPickerProject.path}
        />
      ) : null}
    </>
  );
}
