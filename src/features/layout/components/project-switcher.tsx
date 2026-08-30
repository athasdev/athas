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
  DropdownMenuSearch,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import {
  ChevronExpandYIcon,
  DotsThreeIcon,
  FolderOpenIcon,
  ImageIcon,
  RemoteIcon,
  TrashIcon,
} from "@/ui/icons";
import { showConfirmDialog } from "@/ui/dialog";
import { toast } from "sonner";
import {
  getClosedRemoteConnections,
  getProjectRemoteConnectionId,
} from "@/features/layout/utils/project-switcher-items";
import { matchesSearchQuery } from "@/utils/search-match";
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
  const [query, setQuery] = useState("");
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
  const filteredProjects = useMemo(
    () =>
      projects.filter((availableProject) =>
        matchesSearchQuery(query, [availableProject.name, availableProject.path]),
      ),
    [projects, query],
  );
  const filteredRemoteConnections = useMemo(
    () =>
      closedRemoteConnections.filter((connection) =>
        matchesSearchQuery(query, [connection.name, connection.host, connection.username]),
      ),
    [closedRemoteConnections, query],
  );
  const hasProjectMatches = filteredProjects.length > 0 || filteredRemoteConnections.length > 0;

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
          else setQuery("");
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
        <DropdownMenuContent side="bottom" align="start" viewport="searchable" className="w-64">
          <DropdownMenuSearch
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects"
            autoFocus
          />
          {hasProjectMatches ? (
            <>
              <DropdownMenuRadioGroup
                value={displayProject?.id ?? ""}
                onValueChange={onSelectProject}
              >
                {filteredProjects.map((availableProject) => (
                  <DropdownMenuRadioItem
                    key={availableProject.id}
                    value={availableProject.id}
                    disabled={isSwitchingProject}
                    closeOnClick
                    trailingAction={
                      <ProjectRowActions
                        projectName={availableProject.name}
                        onSelectIcon={
                          isRemoteProjectPath(availableProject.path)
                            ? undefined
                            : () => setIconPickerProject(availableProject)
                        }
                        onRemove={() => void handleRemoveProject(availableProject)}
                      />
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
              {filteredRemoteConnections.map((connection) => (
                <DropdownMenuItem
                  key={connection.id}
                  disabled={connectingRemoteId === connection.id}
                  onClick={() => void handleConnectRemote(connection.id)}
                  trailingAction={
                    <ProjectRowActions
                      projectName={connection.name}
                      onRemove={() => void handleRemoveRemoteConnection(connection)}
                    />
                  }
                >
                  <RemoteIcon />
                  <span className="min-w-0 flex-1 truncate">{connection.name}</span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
            </>
          ) : null}
          {!hasProjectMatches && query.trim() ? (
            <DropdownMenuItem disabled>No projects match</DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onClick={() => void handleOpenFolder()}>
            <FolderOpenIcon />
            Open project…
          </DropdownMenuItem>
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
function ProjectRowActions({
  projectName,
  onSelectIcon,
  onRemove,
}: {
  projectName: string;
  onSelectIcon?: () => void;
  onRemove: () => void;
}) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        appearance="action"
        render={
          <Button
            type="button"
            variant="ghost"
            iconOnly
            size="chrome"
            aria-label={`More actions for ${projectName}`}
          />
        }
      >
        <DotsThreeIcon />
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="min-w-44">
        {onSelectIcon ? (
          <DropdownMenuItem onClick={onSelectIcon}>
            <ImageIcon />
            Select project icon…
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem variant="destructive" onClick={onRemove}>
          <TrashIcon />
          Remove from Athas…
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
