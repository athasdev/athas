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
import { findBestProjectIcon } from "@/features/window/utils/project-icons";
import { Button } from "@/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import { ChevronExpandYIcon, FolderOpenIcon, ImageIcon, RemoteIcon, XIcon } from "@/ui/icons";
import { showConfirmDialog } from "@/ui/dialog";
import { toast } from "sonner";
import {
  getClosedRemoteConnections,
  getProjectRemoteConnectionId,
} from "./sidebar/project-switcher-items";
import { getProjectNameFromPath, isRemoteProjectPath, ProjectGlyph } from "./sidebar/project-glyph";

export function ProjectSwitcher({
  project,
  projects,
  isSwitchingProject,
  onSelectProject,
  onAddRemote,
}: {
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
      if (!cancelled) setDetectedIconPath(iconFile?.path);
    });

    return () => {
      cancelled = true;
    };
  }, [displayProject, displayProjectKey, customIcon, isRemote, projectPath]);

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
            <Button
              variant="ghost"
              size="chrome"
              className="min-w-0 max-w-48 shrink"
              aria-label={`Switch project. Current project: ${projectName}`}
              title={projectPath || projectName}
            >
              <ProjectGlyph projectPath={projectPath} iconPath={displayIconPath} />
              <span className="min-w-0 truncate">{projectName}</span>
              <ChevronExpandYIcon className="text-subtle-foreground" />
            </Button>
          }
        />
        <DropdownMenuContent side="bottom" align="start">
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
                        iconOnly
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
                      iconOnly
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
          {displayProject && !isRemote ? (
            <DropdownMenuItem onClick={() => setIconPickerProject(displayProject)}>
              <ImageIcon />
              Select project icon…
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={onAddRemote}>
            <RemoteIcon />
            Add remote…
          </DropdownMenuItem>
        </DropdownMenuContent>
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
