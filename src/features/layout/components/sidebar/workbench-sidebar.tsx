import { Suspense } from "react";
import { createPortal } from "react-dom";
import { AgentsPlanFooter } from "@/features/ai/components/sidebar/agents-plan-footer";
import { openCustomize } from "@/features/ai/customize/services/open-customize";
import { startAgentInProject } from "@/features/ai/services/agent-project-navigation";
import { AccountMenu } from "@/features/auth/components/account-menu";
import { DiagnosticsActivityControl } from "@/features/diagnostics/components/diagnostics-activity-control";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";
import { keymapRegistry } from "@/features/keymaps/services/keymap-registry";
import { AppUpdateControl } from "@/features/layout/components/app-update-control";
import { selectIsTerminalPaneVisible } from "@/features/layout/stores/ui-state-selectors";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { NotificationsTrigger } from "@/features/notifications/components/notifications-trigger";
import RunActionsButton from "@/features/run-actions/components/run-actions-button";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import ProjectPicker from "@/features/workspace/project-picker/components/project-picker";
import { useWorkspaceTabsStore } from "@/features/workspace/stores/workspace-tabs.store";
import { ControlSizeProvider } from "@/ui/control-size";
import { PencilLineIcon, PuzzlePieceIcon, SearchIcon, TerminalWindowIcon } from "@/ui/icons";
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

/**
 * The workbench's one navigation: search and a new session at the top, pinned sessions and every
 * open project with its sessions below, and Integrations and the account at the bottom. With
 * `titleRow`, its first row is the window's top row, under the traffic lights and sidebar toggle.
 */
export function WorkbenchSidebar({ titleRow = false }: { titleRow?: boolean }) {
  return (
    <SidebarPanel data-slot="workbench-sidebar">
      {titleRow ? (
        <div
          data-slot="sidebar-title-row"
          data-tauri-drag-region
          className="h-pane-header shrink-0"
        />
      ) : null}
      <SidebarTop />
      <SidebarScrollArea aria-label="Projects and sessions">
        <SidebarProjects />
      </SidebarScrollArea>
      <SidebarBottom />
    </SidebarPanel>
  );
}
