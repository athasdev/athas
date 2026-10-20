import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { AgentAttentionDot } from "@/features/ai/components/agent-attention-dot";
import {
  ArchivedSessions,
  ChatSessions,
  OtherCloudSessions,
  PinnedSessions,
  ProjectSessionList,
} from "@/features/ai/components/sidebar/workbench-sessions";
import { useOutsideAgentSessions } from "@/features/ai/hooks/use-outside-agent-sessions";
import { useProjectAgentStatus } from "@/features/ai/hooks/use-project-agent-status";
import { type SidebarSessions, useSidebarSessions } from "@/features/ai/hooks/use-sidebar-sessions";
import {
  openProjectDashboard,
  startAgentInProject,
} from "@/features/ai/services/agent-project-navigation";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { useRecentFoldersStore } from "@/features/file-system/stores/recent-folders.store";
import { activateProject, showProjectView } from "@/features/layout/services/project-view";
import { showProjectTool } from "@/features/layout/services/project-tools";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useWorkbenchSidebarStore } from "@/features/layout/stores/workbench-sidebar.store";
import {
  getClosedRemoteConnections,
  getProjectRemoteConnectionId,
} from "@/features/layout/utils/project-switcher-items";
import PasswordPromptDialog from "@/features/remote/components/password-prompt-dialog";
import {
  getFriendlyRemoteError,
  isRemoteAuthFailure,
} from "@/features/remote/services/remote-errors";
import { connectionStore } from "@/features/remote/stores/remote-connection.store";
import type { RemoteConnection } from "@/features/remote/types/remote.types";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { isWslPath } from "@/features/wsl/services/wsl-path";
import ProjectIconPicker from "@/features/workspace/project-icons/components/project-icon-picker";
import { ProjectGlyph } from "@/features/workspace/project-icons/components/project-glyph";
import { isRemoteProjectPath } from "@/features/workspace/services/project-tab-path";
import {
  connectRemoteConnection,
  loadRemoteConnections,
} from "@/features/workspace/services/remote-connection-actions";
import {
  type ProjectTab,
  useWorkspaceTabsStore,
} from "@/features/workspace/stores/workspace-tabs.store";
import { Button } from "@/ui/button";
import { showConfirmDialog } from "@/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/ui/dropdown";
import {
  ChevronRightIcon,
  DotsIcon,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  PlusIcon,
  RemoteIcon,
  SidebarRightIcon,
  TrashIcon,
  WrenchIcon,
  XIcon,
} from "@/ui/icons";
import {
  SidebarIconButton,
  SidebarListActionRow,
  SidebarListItem,
  SidebarSectionLabel,
} from "@/ui/sidebar";
import { Spinner } from "@/ui/spinner";
import { cn } from "@/utils/cn";
import { useProjectIcon } from "../../hooks/use-project-icon";
import { useProjectTools } from "../dock/project-tools";

function ProjectToolsMenu({ project }: { project: ProjectTab }) {
  const tools = useProjectTools();
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <WrenchIcon />
        Project tools
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent size="compact">
        {tools.map((tool) => (
          <DropdownMenuItem
            key={tool.view}
            onClick={() =>
              void activateProject(project.id).then((active) => {
                if (active) showProjectTool(tool.view);
              })
            }
          >
            {tool.icon}
            {tool.title}
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

interface ProjectGroupProps {
  project: ProjectTab;
  sessions: SidebarSessions["byProject"][string] | undefined;
  active: boolean;
  aiEnabled: boolean;
  onSelectIcon: (project: ProjectTab) => void;
  onRemove: (project: ProjectTab) => void;
}

function ProjectGroup({
  project,
  sessions,
  active,
  aiEnabled,
  onSelectIcon,
  onRemove,
}: ProjectGroupProps) {
  const collapsed = useWorkbenchSidebarStore((state) =>
    Boolean(state.collapsedProjects[project.id]),
  );
  const { toggleProjectCollapsed } = useWorkbenchSidebarStore.use.actions();
  const status = useProjectAgentStatus(sessions?.chats ?? []);
  const closeProject = useFileSystemStore((state) => state.closeProject);
  const revealInFolder = useFileSystemStore((state) => state.handleRevealInFolder);
  const isLocal = !isRemoteProjectPath(project.path) && !isWslPath(project.path);
  const newSession = () => void startAgentInProject(project.id);
  const outside = useOutsideAgentSessions(project.path, aiEnabled && !collapsed && isLocal);
  const iconPath = useProjectIcon(project.path, project.customIcon);

  return (
    <section
      aria-label={project.name}
      data-project-id={project.id}
      data-active-project={active || undefined}
      className="flex flex-col gap-px"
    >
      <SidebarListActionRow
        actions={[
          ...(aiEnabled
            ? [
                <SidebarIconButton
                  key="new"
                  tooltip={`New session in ${project.name}`}
                  aria-label={`New session in ${project.name}`}
                  onClick={newSession}
                >
                  <PlusIcon />
                </SidebarIconButton>,
              ]
            : []),
          <DropdownMenu key="menu">
            <DropdownMenuTrigger
              render={
                <SidebarIconButton
                  tooltip="Project actions"
                  aria-label={`Actions for ${project.name}`}
                />
              }
            >
              <DotsIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" size="default">
              <DropdownMenuItem onClick={() => void openProjectDashboard(project.id)}>
                <FolderIcon />
                Open dashboard
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => void showProjectView(project.id)}>
                <SidebarRightIcon />
                Show project files
              </DropdownMenuItem>
              <ProjectToolsMenu project={project} />
              {aiEnabled ? (
                <DropdownMenuItem onClick={newSession}>
                  <PlusIcon />
                  New session
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuSeparator />
              {isLocal ? (
                <DropdownMenuItem onClick={() => void revealInFolder(project.path)}>
                  <FolderOpenIcon />
                  Reveal in file manager
                </DropdownMenuItem>
              ) : null}
              {isRemoteProjectPath(project.path) ? null : (
                <DropdownMenuItem onClick={() => onSelectIcon(project)}>
                  <ImageIcon />
                  Select project icon…
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => void closeProject(project.id)}>
                <XIcon />
                Close project
              </DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onClick={() => onRemove(project)}>
                <TrashIcon />
                Remove from Athas…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>,
        ]}
      >
        <SidebarListItem
          active={active && collapsed}
          aria-expanded={!collapsed}
          title={project.path}
          leading={
            <span className="relative flex size-[1em] items-center justify-center">
              <span className="flex items-center justify-center transition-opacity duration-fast group-hover/sidebar-list-action-row:opacity-0 group-has-focus-visible/sidebar-list-action-row:opacity-0 motion-reduce:transition-none">
                <ProjectGlyph projectPath={project.path} iconPath={iconPath} />
              </span>
              <ChevronRightIcon
                aria-hidden
                className={cn(
                  "absolute opacity-0 transition-[opacity,transform] duration-fast group-hover/sidebar-list-action-row:opacity-100 group-has-focus-visible/sidebar-list-action-row:opacity-100 motion-reduce:transition-none",
                  !collapsed && "rotate-90",
                )}
              />
            </span>
          }
          trailing={
            collapsed && status.attention ? (
              <AgentAttentionDot attention={status.attention} />
            ) : collapsed && status.working ? (
              <Spinner label={`A session is working in ${project.name}`} compact />
            ) : null
          }
          onClick={(event) => {
            if (event.target instanceof Element && event.target.closest("[data-project-name]")) {
              void openProjectDashboard(project.id);
              return;
            }
            toggleProjectCollapsed(project.id);
          }}
        >
          <span
            data-project-name
            title={`Open ${project.name} dashboard`}
            className={cn("hover:underline", active && "font-medium text-foreground")}
          >
            {project.name}
          </span>
        </SidebarListItem>
      </SidebarListActionRow>
      {collapsed ? null : (
        <div className="flex flex-col gap-px pl-4">
          <ProjectSessionList
            sessions={sessions}
            projectId={project.id}
            projectPath={project.path}
            outside={outside}
          />
          {aiEnabled &&
          (sessions?.chats.length ?? 0) === 0 &&
          !sessions?.cloudRuns.length &&
          outside.length === 0 ? (
            <SidebarListItem leading={<PlusIcon />} onClick={newSession}>
              New session
            </SidebarListItem>
          ) : null}
        </div>
      )}
    </section>
  );
}

/**
 * Every open project as a group of its sessions, with the ways to open, connect, close and remove
 * projects that the title bar's project switcher used to hold.
 */
export function SidebarProjects() {
  const projects = useWorkspaceTabsStore.use.projectTabs();
  const activeProject = projects.find((project) => project.isActive)?.id;
  const aiEnabled = useSettingsStore((state) => state.settings.coreFeatures.aiChat);
  const sessions = useSidebarSessions();
  const handleOpenFolder = useFileSystemStore((state) => state.handleOpenFolder);
  const closeProject = useFileSystemStore((state) => state.closeProject);
  const removeFromRecents = useRecentFoldersStore((state) => state.actions.removeFromRecents);
  const openProjectPicker = useUIState((state) => state.openProjectPicker);
  const [remoteConnections, setRemoteConnections] = useState<RemoteConnection[]>([]);
  const [connectingRemoteId, setConnectingRemoteId] = useState<string | null>(null);
  const [passwordPromptConnection, setPasswordPromptConnection] = useState<RemoteConnection | null>(
    null,
  );
  const [iconPickerProject, setIconPickerProject] = useState<ProjectTab | null>(null);
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
      if (providedPassword) throw new Error(getFriendlyRemoteError(error));
      toast.error(getFriendlyRemoteError(error));
    } finally {
      setConnectingRemoteId(null);
    }
  };

  const handleRemoveProject = async (project: ProjectTab) => {
    const connectionId = getProjectRemoteConnectionId(project.path);
    const confirmed = await showConfirmDialog(
      connectionId
        ? `Remove “${project.name}” from Athas? Remote files will not be deleted.`
        : `Remove “${project.name}” from Athas? Files on disk will not be deleted.`,
      {
        title: connectionId ? "Remove Remote Connection" : "Remove Project",
        confirmLabel: "Remove",
        destructive: true,
      },
    );
    if (!confirmed) return;
    try {
      if (!(await closeProject(project.id))) return;
      if (connectionId) {
        await connectionStore.deleteConnection(connectionId);
        await refreshRemoteConnections();
      } else {
        removeFromRecents(project.path);
      }
      toast.success(`Removed “${project.name}” from Athas.`);
    } catch (error) {
      console.error("Failed to remove project from Athas:", error);
      toast.error("Failed to remove the project from Athas.");
    }
  };

  const handleRemoveRemoteConnection = async (connection: RemoteConnection) => {
    const confirmed = await showConfirmDialog(
      `Remove “${connection.name}” from Athas? Remote files will not be deleted.`,
      { title: "Remove Remote Connection", confirmLabel: "Remove", destructive: true },
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
    <div className="flex flex-col gap-3">
      <PinnedSessions chats={sessions.pinned} />
      <section aria-label="Projects" className="flex flex-col gap-1">
        <SidebarSectionLabel
          className="pr-0.5"
          trailing={
            <DropdownMenu
              onOpenChange={(open) => {
                if (open) void refreshRemoteConnections();
              }}
            >
              <DropdownMenuTrigger
                render={<SidebarIconButton tooltip="Add project" aria-label="Add project" />}
              >
                <PlusIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" size="default">
                <DropdownMenuItem onClick={() => void handleOpenFolder()}>
                  <FolderOpenIcon />
                  Open project…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openProjectPicker("addRemote")}>
                  <RemoteIcon />
                  Add remote…
                </DropdownMenuItem>
                {closedRemoteConnections.length > 0 ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuGroup>
                      <DropdownMenuLabel>Saved remotes</DropdownMenuLabel>
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
                              size="sm"
                              aria-label={`Remove ${connection.name} from Athas`}
                              onClick={() => void handleRemoveRemoteConnection(connection)}
                            >
                              <TrashIcon />
                            </Button>
                          }
                        >
                          <RemoteIcon />
                          {connection.name}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuGroup>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          }
        >
          Projects
        </SidebarSectionLabel>
        {projects.map((project) => (
          <ProjectGroup
            key={project.id}
            project={project}
            sessions={sessions.byProject[project.id]}
            active={project.id === activeProject}
            aiEnabled={aiEnabled}
            onSelectIcon={setIconPickerProject}
            onRemove={(target) => void handleRemoveProject(target)}
          />
        ))}
        {projects.length === 0 ? (
          <SidebarListItem leading={<FolderOpenIcon />} onClick={() => void handleOpenFolder()}>
            Open project…
          </SidebarListItem>
        ) : null}
      </section>
      {aiEnabled ? <ChatSessions chats={sessions.chats} /> : null}
      <OtherCloudSessions chats={sessions.otherChats} runs={sessions.otherRuns} />
      <ArchivedSessions chats={sessions.archived} />
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
    </div>
  );
}
