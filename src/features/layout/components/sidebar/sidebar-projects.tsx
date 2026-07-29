import { convertFileSrc } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import ProjectIconPicker from "@/features/window/components/project-icon-picker";
import { useUIState } from "@/features/window/stores/ui-state.store";
import type { ProjectTab } from "@/features/window/stores/workspace-tabs.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { findBestProjectIcon } from "@/features/window/utils/project-icons";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import {
  ChevronExpandYIcon,
  CopyIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  OpenExternalIcon,
  PlusIcon,
  RemoteIcon,
  TrashIcon,
  WindowExpandIcon,
} from "@/ui/icons";
import { SidebarListItem } from "@/ui/sidebar";
import { writeClipboardText } from "@/utils/clipboard";
import { cn } from "@/utils/cn";

export function getProjectNameFromPath(path?: string) {
  if (!path) return "Open Project";
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}

function isRemoteProjectPath(path?: string) {
  return path?.startsWith("remote://") === true;
}

function ProjectGlyph({
  projectPath,
  iconPath,
  className,
}: {
  projectPath?: string;
  iconPath?: string;
  className?: string;
}) {
  const isRemote = isRemoteProjectPath(projectPath);

  if (iconPath) {
    return (
      <img
        src={convertFileSrc(iconPath)}
        alt=""
        className={cn("shrink-0 rounded-md object-contain", className ?? "size-4")}
      />
    );
  }

  const Icon = isRemote ? RemoteIcon : projectPath ? FolderIcon : PlusIcon;

  return <Icon className={cn("shrink-0", className ?? "size-4")} />;
}

export function SidebarProjectSwitcher({
  expanded,
  project,
  openProject = false,
}: {
  expanded: boolean;
  project?: ProjectTab;
  openProject?: boolean;
}) {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const setIsProjectPickerVisible = useUIState((state) => state.setIsProjectPickerVisible);
  const [detectedIconPath, setDetectedIconPath] = useState<string | undefined>();
  const [iconPickerProject, setIconPickerProject] = useState<ProjectTab | null>(null);
  const displayProject = openProject ? undefined : project;
  const projectName = openProject
    ? "Open Project"
    : displayProject?.name || getProjectNameFromPath(rootFolderPath);
  const projectPath = openProject ? undefined : displayProject?.path || rootFolderPath;
  const customIcon = displayProject?.customIcon;
  const isRemote = isRemoteProjectPath(projectPath);
  const displayIconPath = customIcon ?? detectedIconPath;
  const displayProjectKey = displayProject?.id ?? projectPath;

  useEffect(() => {
    setDetectedIconPath(undefined);

    if (!displayProject || customIcon || isRemote || !projectPath) return;

    let cancelled = false;

    findBestProjectIcon(projectPath).then((iconFile) => {
      if (!cancelled) {
        setDetectedIconPath(iconFile?.path);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [displayProject, displayProjectKey, customIcon, isRemote, projectPath]);

  const canChangeIcon = !!displayProject && !!projectPath && !isRemote;
  const projectGlyph = <ProjectGlyph projectPath={projectPath} iconPath={displayIconPath} />;

  return (
    <>
      <SidebarListItem
        leading={
          expanded ? (
            <span
              role={canChangeIcon ? "button" : undefined}
              tabIndex={canChangeIcon ? 0 : undefined}
              aria-label={canChangeIcon ? "Change project icon" : undefined}
              className={cn(
                "flex size-4 items-center justify-center rounded-md",
                canChangeIcon &&
                  "hover:bg-accent/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/20",
              )}
              onClick={(event) => {
                if (!canChangeIcon || !displayProject) return;
                event.stopPropagation();
                setIconPickerProject(displayProject);
              }}
              onKeyDown={(event) => {
                if (!canChangeIcon || !displayProject) return;
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                event.stopPropagation();
                setIconPickerProject(displayProject);
              }}
            >
              {projectGlyph}
            </span>
          ) : (
            projectGlyph
          )
        }
        iconOnly={!expanded}
        trailing={expanded ? <ChevronExpandYIcon className="size-3.5" /> : undefined}
        onClick={() => setIsProjectPickerVisible(true)}
        aria-label={openProject ? "Open project switcher" : "Switch project"}
        title={expanded ? undefined : projectName}
      >
        {projectName}
      </SidebarListItem>
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

export function SidebarProjectIcons({
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
      <div className="scrollbar-hidden pointer-events-none absolute right-[var(--athas-workbench-gap)] bottom-1.5 left-0 z-20 flex items-center justify-center gap-(--athas-chrome-gap) overflow-x-auto px-2">
        {projects.map((project) => {
          const isRemote = isRemoteProjectPath(project.path);
          const isActive = project.id === activeProjectId;

          return (
            <ContextMenu key={project.id}>
              <ContextMenuTrigger
                role="button"
                tabIndex={isSwitchingProject ? -1 : 0}
                className={cn(
                  "pointer-events-auto flex size-(--athas-chrome-hit-target) shrink-0 items-center justify-center rounded-[var(--athas-chrome-radius)] text-subtle-foreground outline-none transition-[opacity,color] duration-[var(--app-duration-fast)] ease-[var(--app-ease-smooth)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40",
                  isActive ? "opacity-100" : "opacity-55 hover:opacity-100",
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
                <ProjectGlyph
                  projectPath={project.path}
                  iconPath={project.customIcon}
                  className="size-4"
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
