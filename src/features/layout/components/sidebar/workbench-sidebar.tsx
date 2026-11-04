import { type ReactNode, Suspense, useMemo } from "react";
import { createPortal } from "react-dom";
import { AgentsPlanFooter } from "@/features/ai/components/sidebar/agents-plan-footer";
import { openCustomize } from "@/features/ai/customize/services/open-customize";
import {
  startAgentInProject,
  startProjectlessChat,
} from "@/features/ai/services/agent-project-navigation";
import { AccountMenu } from "@/features/auth/components/account-menu";
import { DiagnosticsActivityControl } from "@/features/diagnostics/components/diagnostics-activity-control";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { keymapRegistry } from "@/features/keymaps/services/keymap-registry";
import { AppUpdateControl } from "@/features/layout/components/app-update-control";
import { selectIsTerminalPaneVisible } from "@/features/layout/stores/ui-state-selectors";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import {
  AGENTS_SIDEBAR_VIEW,
  useWorkbenchSidebarStore,
} from "@/features/layout/stores/workbench-sidebar.store";
import type { DockOwner } from "@/features/layout/types/dock.types";
import { normalizeProjectTabPath } from "@/features/workspace/services/project-tab-path";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { NotificationsTrigger } from "@/features/notifications/components/notifications-trigger";
import RunActionsButton from "@/features/run-actions/components/run-actions-button";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import ProjectPicker from "@/features/workspace/project-picker/components/project-picker";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItems,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import { ControlSizeProvider } from "@/ui/control-size";
import { EmptyState } from "@/ui/empty";
import { Pane, PaneActions, PaneBody, PaneHeader, PaneTitle } from "@/ui/pane";
import { type MenuItem, menuSeparator } from "@/ui/dropdown";
import {
  ChatBubbleTextIcon,
  FolderOpenIcon,
  PencilLineIcon,
  PuzzlePieceIcon,
  SearchIcon,
  TerminalWindowIcon,
} from "@/ui/icons";
import Keybinding from "@/ui/keybinding";
import { OverlaySideProvider } from "@/ui/overlay-side";
import { SidebarIconButton, SidebarListItem, SidebarPanel, SidebarScrollArea } from "@/ui/sidebar";
import { getWebContributions } from "@/utils/web-contributions";
import { useAddProjectItems } from "../../hooks/use-add-project-items";
import { type ProjectTool, useProjectTools } from "../dock/project-tools";
import { SidebarProjects } from "./sidebar-projects";

/** The project picker the sidebar and the title bar open, rendered over the whole window. */
export function ProjectPickerHost() {
  const isProjectPickerVisible = useUIState((state) => state.isProjectPickerVisible);
  const projectPickerInitialStep = useUIState((state) => state.projectPickerInitialStep);
  const setIsProjectPickerVisible = useUIState((state) => state.setIsProjectPickerVisible);
  return createPortal(
    isProjectPickerVisible ? (
      <ProjectPicker
        isOpen
        initialStep={projectPickerInitialStep}
        onClose={() => setIsProjectPickerVisible(false)}
      />
    ) : null,
    document.body,
  );
}

function TerminalToggle() {
  const shortcut = useCommandShortcut("workbench.toggleTerminal");
  const isTerminalOpen = useUIState(selectIsTerminalPaneVisible);
  return (
    <SidebarIconButton
      active={isTerminalOpen}
      onClick={() => void keymapRegistry.executeCommand("workbench.toggleTerminal")}
      tooltip={isTerminalOpen ? "Hide Terminal" : "Show Terminal"}
      shortcut={shortcut}
      aria-label={isTerminalOpen ? "Hide terminal" : "Show terminal"}
      aria-pressed={isTerminalOpen}
    >
      <TerminalWindowIcon />
    </SidebarIconButton>
  );
}

function SidebarTop() {
  const quickOpenShortcut = useCommandShortcut("file.quickOpen");
  const setIsQuickOpenVisible = useUIState((state) => state.setIsQuickOpenVisible);
  const aiEnabled = useSettingsStore((state) => state.settings.coreFeatures.aiChat);
  const activeProjectId = useWorkspaceTabsStore(
    (state) => state.projectTabs.find((project) => project.isActive)?.id,
  );

  return (
    <nav aria-label="Workbench" className="flex shrink-0 flex-col gap-px px-chrome-inline pt-1">
      <SidebarListItem
        leading={<SearchIcon />}
        trailing={quickOpenShortcut ? <Keybinding binding={quickOpenShortcut} /> : undefined}
        onClick={() => setIsQuickOpenVisible(true)}
      >
        Search
      </SidebarListItem>
      {aiEnabled ? (
        <SidebarListItem
          leading={<PencilLineIcon />}
          onClick={() => void startAgentInProject(activeProjectId)}
        >
          New session
        </SidebarListItem>
      ) : null}
    </nav>
  );
}

function SidebarBottom() {
  const WebAccountMenu = getWebContributions().AccountMenu;
  const terminalEnabled = useSettingsStore((state) => state.settings.coreFeatures.terminal);
  const aiEnabled = useSettingsStore((state) => state.settings.coreFeatures.aiChat);

  return (
    <OverlaySideProvider side="top" align="start">
      <div
        data-slot="workbench-sidebar-footer"
        className="flex shrink-0 flex-col gap-1 px-chrome-inline pb-1.5"
      >
        {aiEnabled ? (
          <SidebarListItem leading={<PuzzlePieceIcon />} onClick={() => openCustomize()}>
            Integrations
          </SidebarListItem>
        ) : null}
        <ControlSizeProvider size="sm">
          <div className="flex h-list-row items-center gap-chrome-tight">
            {WebAccountMenu ? (
              <Suspense fallback={null}>
                <WebAccountMenu />
              </Suspense>
            ) : (
              <AccountMenu />
            )}
            {aiEnabled ? <AgentsPlanFooter /> : null}
            <div className="ml-auto flex items-center gap-chrome-tight">
              <AppUpdateControl />
              <DiagnosticsActivityControl />
              <RunActionsButton />
              {terminalEnabled ? <TerminalToggle /> : null}
              <NotificationsTrigger />
            </div>
          </div>
        </ControlSizeProvider>
      </div>
    </OverlaySideProvider>
  );
}

/** Right-clicking the sidebar outside any row: start something or add a project. */
function SidebarAreaMenu({ children }: { children: ReactNode }) {
  const aiEnabled = useSettingsStore((state) => state.settings.coreFeatures.aiChat);
  const activeProjectId = useWorkspaceTabsStore(
    (state) => state.projectTabs.find((project) => project.isActive)?.id,
  );
  const addProjectItems = useAddProjectItems();
  const items: MenuItem[] = [
    ...(aiEnabled
      ? [
          {
            id: "new-session",
            label: "New session",
            icon: <PencilLineIcon />,
            onClick: () => void startAgentInProject(activeProjectId),
          },
          {
            id: "new-chat",
            label: "New chat",
            icon: <ChatBubbleTextIcon />,
            onClick: () => void startProjectlessChat(),
          },
          menuSeparator("project-separator"),
        ]
      : []),
    ...addProjectItems,
  ];
  return (
    <ContextMenu>
      <ContextMenuTrigger className="flex min-h-0 flex-1 flex-col">{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItems items={items} />
      </ContextMenuContent>
    </ContextMenu>
  );
}

function AgentsView() {
  return (
    <>
      <PaneHeader>
        <PaneTitle>Agents</PaneTitle>
      </PaneHeader>
      <SidebarTop />
      <SidebarAreaMenu>
        <SidebarScrollArea aria-label="Projects and sessions">
          <SidebarProjects />
        </SidebarScrollArea>
      </SidebarAreaMenu>
    </>
  );
}

function ProjectToolView({ tool }: { tool: ProjectTool }) {
  const rootFolderPath = useProjectStore((state) => state.rootFolderPath);
  const focusRequest = useWorkbenchSidebarStore.use.focusRequest();
  const owner = useMemo<DockOwner | null>(
    () =>
      rootFolderPath ? { kind: "project", id: normalizeProjectTabPath(rootFolderPath) } : null,
    [rootFolderPath],
  );
  return (
    <>
      <PaneHeader>
        <PaneTitle>{tool.title}</PaneTitle>
        {tool.renderActions && owner ? (
          <PaneActions>
            <Suspense fallback={null}>{tool.renderActions()}</Suspense>
          </PaneActions>
        ) : null}
      </PaneHeader>
      <PaneBody data-slot="sidebar-view" data-sidebar-view={tool.view}>
        {owner ? (
          <Suspense fallback={null}>
            {tool.render({ owner, focusRequested: focusRequest > 0, focusRequest })}
          </Suspense>
        ) : (
          <NoProjectOpen />
        )}
      </PaneBody>
    </>
  );
}

function NoProjectOpen() {
  const addProjectItems = useAddProjectItems();
  const openProject = addProjectItems.find((item) => item.id === "open-project");
  const onOpen = openProject && "onClick" in openProject ? openProject.onClick : undefined;
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center">
      <EmptyState
        layout="sidebar"
        icon={<FolderOpenIcon />}
        title="No project open"
        message="Open a folder to use its tools here."
        action={onOpen ? { label: "Open project…", onClick: onOpen } : undefined}
      />
    </div>
  );
}

/**
 * The sidebar: the view the activity bar picked, either the agents (search, a new session, and
 * every open project with its sessions) or a project tool, over Integrations and the account.
 * With `titleRow`, its first row is the window's top row, under the traffic lights and the title
 * bar controls.
 */
export function WorkbenchSidebar({ titleRow = false }: { titleRow?: boolean }) {
  const activeView = useWorkbenchSidebarStore.use.activeView();
  const aiEnabled = useSettingsStore((state) => state.settings.coreFeatures.aiChat);
  const tools = useProjectTools();
  const tool = tools.find((candidate) => candidate.view === activeView);
  const showAgents = aiEnabled && (activeView === AGENTS_SIDEBAR_VIEW || !tool);
  const shownTool = tool ?? tools[0];

  return (
    <SidebarPanel data-slot="workbench-sidebar">
      {titleRow ? (
        <div
          data-slot="sidebar-title-row"
          data-tauri-drag-region
          className="h-pane-header shrink-0"
        />
      ) : null}
      <Pane className="flex-1">
        {showAgents ? <AgentsView /> : shownTool ? <ProjectToolView tool={shownTool} /> : null}
      </Pane>
      <SidebarBottom />
    </SidebarPanel>
  );
}
