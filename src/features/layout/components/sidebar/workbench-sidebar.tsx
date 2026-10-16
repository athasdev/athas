import { Suspense } from "react";
import { createPortal } from "react-dom";
import { SessionInboxList } from "@/features/ai/components/sidebar/workbench-sessions";
import { AgentsPlanFooter } from "@/features/ai/components/sidebar/agents-plan-footer";
import { openCustomize } from "@/features/ai/customize/services/open-customize";
import { useInboxSessions } from "@/features/ai/hooks/use-inbox-sessions";
import { startAgentInProject } from "@/features/ai/services/agent-project-navigation";
import { AccountMenu } from "@/features/auth/components/account-menu";
import { DiagnosticsActivityControl } from "@/features/diagnostics/components/diagnostics-activity-control";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { keymapRegistry } from "@/features/keymaps/services/keymap-registry";
import { AppUpdateControl } from "@/features/layout/components/app-update-control";
import { selectIsTerminalPaneVisible } from "@/features/layout/stores/ui-state-selectors";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { useWorkbenchSidebarStore } from "@/features/layout/stores/workbench-sidebar.store";
import { NotificationsTrigger } from "@/features/notifications/components/notifications-trigger";
import RunActionsButton from "@/features/run-actions/components/run-actions-button";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import ProjectPicker from "@/features/workspace/project-picker/components/project-picker";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";
import { ControlSizeProvider } from "@/ui/control-size";
import {
  ChevronLeftIcon,
  InboxIcon,
  PencilLineIcon,
  SearchIcon,
  SettingsIcon,
  SlidersIcon,
  TerminalWindowIcon,
} from "@/ui/icons";
import Keybinding from "@/ui/keybinding";
import { OverlaySideProvider } from "@/ui/overlay-side";
import { SidebarIconButton, SidebarListItem, SidebarPanel, SidebarScrollArea } from "@/ui/sidebar";
import { getWebContributions } from "@/utils/web-contributions";
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
  const inboxOpen = useWorkbenchSidebarStore.use.inboxOpen();
  const { setInboxOpen } = useWorkbenchSidebarStore.use.actions();
  const inboxCount = useInboxSessions().length;

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
        <>
          <SidebarListItem
            leading={<PencilLineIcon />}
            onClick={() => void startAgentInProject(activeProjectId)}
          >
            New session
          </SidebarListItem>
          <SidebarListItem
            leading={<InboxIcon />}
            active={inboxOpen}
            aria-pressed={inboxOpen}
            aria-label={inboxCount > 0 ? `Inbox, ${inboxCount} need you` : "Inbox"}
            trailing={
              inboxCount > 0 ? (
                <span className="tabular-nums text-subtle-foreground">{inboxCount}</span>
              ) : undefined
            }
            onClick={() => setInboxOpen(!inboxOpen)}
          >
            Inbox
          </SidebarListItem>
        </>
      ) : null}
    </nav>
  );
}

function SidebarBottom() {
  const WebAccountMenu = getWebContributions().AccountMenu;
  const openSettings = useUIState((state) => state.openSettings);
  const settingsShortcut = useCommandShortcut("workbench.openSettings");
  const terminalEnabled = useSettingsStore((state) => state.settings.coreFeatures.terminal);
  const aiEnabled = useSettingsStore((state) => state.settings.coreFeatures.aiChat);

  return (
    <OverlaySideProvider side="top" align="start">
      <div
        data-slot="workbench-sidebar-footer"
        className="flex shrink-0 flex-col gap-px px-chrome-inline pb-1.5"
      >
        {aiEnabled ? (
          <SidebarListItem leading={<SlidersIcon />} onClick={() => openCustomize()}>
            Customize
          </SidebarListItem>
        ) : null}
        <SidebarListItem
          leading={<SettingsIcon />}
          trailing={settingsShortcut ? <Keybinding binding={settingsShortcut} /> : undefined}
          onClick={() => openSettings()}
        >
          Settings
        </SidebarListItem>
        <ControlSizeProvider size="sm">
          <div className="flex items-center gap-chrome-tight pt-1">
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

function InboxHeader() {
  const { setInboxOpen } = useWorkbenchSidebarStore.use.actions();
  return (
    <SidebarListItem leading={<ChevronLeftIcon />} onClick={() => setInboxOpen(false)}>
      Projects
    </SidebarListItem>
  );
}

/**
 * The workbench's one navigation: search, a new session and the Inbox at the top, every open
 * project with its sessions below, and Customize, Settings and the account at the bottom.
 */
export function WorkbenchSidebar() {
  const inboxOpen = useWorkbenchSidebarStore.use.inboxOpen();
  const aiEnabled = useSettingsStore((state) => state.settings.coreFeatures.aiChat);
  const showsInbox = inboxOpen && aiEnabled;
  return (
    <SidebarPanel data-slot="workbench-sidebar">
      <SidebarTop />
      <SidebarScrollArea aria-label={showsInbox ? "Inbox" : "Projects and sessions"}>
        {showsInbox ? (
          <div className="flex flex-col gap-1">
            <InboxHeader />
            <SessionInboxList />
          </div>
        ) : (
          <SidebarProjects />
        )}
      </SidebarScrollArea>
      <SidebarBottom />
    </SidebarPanel>
  );
}
