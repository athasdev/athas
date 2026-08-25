import { convertFileSrc } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRecentFoldersStore } from "@/features/file-system/stores/recent-folders.store";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import PasswordPromptDialog from "@/features/remote/components/password-prompt-dialog";
import {
  connectRemoteConnection,
  loadRemoteConnections,
} from "@/features/remote/services/remote-connection-actions";
import { connectionStore } from "@/features/remote/stores/remote-connection.store";
import type { RemoteConnection } from "@/features/remote/types/remote.types";
import { getFriendlyRemoteError, isRemoteAuthFailure } from "@/features/remote/utils/remote-errors";
import ProjectIconPicker from "@/features/window/components/project-icon-picker";
import type { ProjectTab } from "@/features/window/stores/workspace-tabs.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { findBestProjectIcon } from "@/features/window/utils/project-icons";
import { Button } from "@/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import {
  CaretRightIcon,
  CopyIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  OpenExternalIcon,
  PlusIcon,
  RemoteIcon,
  TrashIcon,
  WindowExpandIcon,
  XIcon,
} from "@/ui/icons";
import { SidebarListItem, SidebarMenuContent } from "@/ui/sidebar";
import { showConfirmDialog } from "@/ui/dialog";
import { writeClipboardText } from "@/utils/clipboard";
import { cn } from "@/utils/cn";
import { toast } from "sonner";
import { getClosedRemoteConnections, getProjectRemoteConnectionId } from "./project-switcher-items";

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
  projects,
  isSwitchingProject,
  onSelectProject,
  onAddRemote,
}: {
  expanded: boolean;
  project?: ProjectTab;
  projects: ProjectTab[];
  isSwitchingProject: boolean;
  onSelectProject: (projectId: string) => void;
  onAddRemote: () => void;
}) {
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const handleOpenFolder = useFileSystemStore((state) => state.handleOpenFolder);
  const closeProject = useFileSystemStore((state) => state.closeProject);
  const removeFromRecents = useRecentFoldersStore((state) => state.actions.removeFromRecents);
  const [isOpen, setIsOpen] = useState(false);
  const [remoteConnections, setRemoteConnections] = useState<RemoteConnection[]>([]);
  const [connectingRemoteId, setConnectingRemoteId] = useState<string | null>(null);
  const [passwordPromptConnection, setPasswordPromptConnection] = useState<RemoteConnection | null>(
    null,
  );
  const [detectedIconPath, setDetectedIconPath] = useState<string | undefined>();
  const [iconPickerProject, setIconPickerProject] = useState<ProjectTab | null>(null);
  const displayProject = project;
  const projectName = displayProject?.name || getProjectNameFromPath(rootFolderPath);
  const projectPath = displayProject?.path || rootFolderPath;
  const customIcon = displayProject?.customIcon;
  const isRemote = isRemoteProjectPath(projectPath);
  const displayIconPath = customIcon ?? detectedIconPath;
  const displayProjectKey = displayProject?.id ?? projectPath;
  const closedRemoteConnections = useMemo(
    () => getClosedRemoteConnections(projects, remoteConnections),
    [projects, remoteConnections],
  );

  const refreshRemoteConnections = useCallback(async () => {
    try {
      setRemoteConnections(await loadRemoteConnections());
    } catch (error) {
      console.error("Failed to load remote connections:", error);
    }
  }, []);

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

  const handleConnectRemote = async (connectionId: string, providedPassword?: string) => {
    const connection = remoteConnections.find((candidate) => candidate.id === connectionId);
    if (!connection || connectingRemoteId === connectionId) return;

    setConnectingRemoteId(connectionId);
    try {
      await connectRemoteConnection(connection, providedPassword);
      await refreshRemoteConnections();
    } catch (error) {
      if (isRemoteAuthFailure(error) && !providedPassword && !connection.password) {
        setPasswordPromptConnection(connection);
        return;
      }

      if (providedPassword) {
        throw new Error(getFriendlyRemoteError(error));
      }

      toast.error(getFriendlyRemoteError(error));
    } finally {
      setConnectingRemoteId(null);
    }
  };

  const handleRemoveProject = async (availableProject: ProjectTab) => {
    setIsOpen(false);
    const connectionId = getProjectRemoteConnectionId(availableProject.path);
    const confirmed = await showConfirmDialog(
      connectionId
        ? `Remove “${availableProject.name}” from Athas? Remote files will not be deleted.`
        : `Remove “${availableProject.name}” from Athas? Files on disk will not be deleted.`,
      {
        title: connectionId ? "Remove Remote Connection" : "Remove Project",
        confirmLabel: "Remove",
      },
    );
    if (!confirmed) return;

    try {
      if (!(await closeProject(availableProject.id))) return;

      if (connectionId) {
        await connectionStore.deleteConnection(connectionId);
        await refreshRemoteConnections();
      } else {
        removeFromRecents(availableProject.path);
      }
      toast.success(`Removed “${availableProject.name}” from Athas.`);
    } catch (error) {
      console.error("Failed to remove project from Athas:", error);
      toast.error("Failed to remove the project from Athas.");
    }
  };

  const handleRemoveRemoteConnection = async (connection: RemoteConnection) => {
    setIsOpen(false);
    const confirmed = await showConfirmDialog(
      `Remove “${connection.name}” from Athas? Remote files will not be deleted.`,
      {
        title: "Remove Remote Connection",
        confirmLabel: "Remove",
      },
    );
    if (!confirmed) return;

    try {
      await connectionStore.deleteConnection(connection.id);
      await refreshRemoteConnections();
      toast.success(`Removed “${connection.name}” from Athas.`);
    } catch (error) {
      console.error("Failed to remove remote connection from Athas:", error);
      toast.error("Failed to remove the remote connection from Athas.");
    }
  };

  return (
    <>
      <DropdownMenu
        open={isOpen}
        onOpenChange={(open) => {
          setIsOpen(open);
          if (open) void refreshRemoteConnections();
        }}
      >
        <DropdownMenuTrigger
          render={
            <SidebarListItem
              appearance="activity"
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
              trailing={expanded ? <CaretRightIcon className="size-3.5" /> : undefined}
              aria-label="Switch project"
              title={expanded ? undefined : projectName}
            >
              {projectName}
            </SidebarListItem>
          }
        />
        <SidebarMenuContent>
          {projects.length > 0 || closedRemoteConnections.length > 0 ? (
            <>
              <DropdownMenuRadioGroup
                value={displayProject?.id ?? ""}
                onValueChange={onSelectProject}
              >
                {projects.map((availableProject) => (
                  <DropdownMenuRadioItem
                    key={availableProject.id}
                    value={availableProject.id}
                    disabled={isSwitchingProject}
                    closeOnClick
                    trailingAction={
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${availableProject.name} from Athas`}
                        onClick={() => void handleRemoveProject(availableProject)}
                      >
                        <XIcon />
                      </Button>
                    }
                  >
                    <ProjectGlyph
                      projectPath={availableProject.path}
                      iconPath={availableProject.customIcon}
                    />
                    <span className="min-w-0 flex-1 truncate">{availableProject.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              {closedRemoteConnections.map((connection) => (
                <DropdownMenuItem
                  key={connection.id}
                  disabled={connectingRemoteId === connection.id}
                  onClick={() => void handleConnectRemote(connection.id)}
                  trailingAction={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label={`Remove ${connection.name} from Athas`}
                      onClick={() => void handleRemoveRemoteConnection(connection)}
                    >
                      <XIcon />
                    </Button>
                  }
                >
                  <RemoteIcon />
                  <span className="min-w-0 flex-1 truncate">{connection.name}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          ) : null}
          <DropdownMenuItem onClick={() => void handleOpenFolder()}>
            <FolderOpenIcon />
            Open project…
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onAddRemote}>
            <RemoteIcon />
            Add remote…
          </DropdownMenuItem>
        </SidebarMenuContent>
      </DropdownMenu>
      {iconPickerProject ? (
        <ProjectIconPicker
          isOpen
          onClose={() => setIconPickerProject(null)}
          projectId={iconPickerProject.id}
          projectPath={iconPickerProject.path}
        />
      ) : null}
      <PasswordPromptDialog
        isOpen={passwordPromptConnection !== null}
        connection={passwordPromptConnection}
        onClose={() => setPasswordPromptConnection(null)}
        onConnect={handleConnectRemote}
      />
    </>
  );
}

export function SidebarProjectDots({
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
