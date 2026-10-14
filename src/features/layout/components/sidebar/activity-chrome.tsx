import { Suspense } from "react";
import { createPortal } from "react-dom";
import { AppUpdateControl } from "@/features/layout/components/app-update-control";
import { NotificationsTrigger } from "@/features/notifications/components/notifications-trigger";
import RunActionsButton from "@/features/run-actions/components/run-actions-button";
import { keymapRegistry } from "@/features/keymaps/services/keymap-registry";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { AccountMenu } from "@/features/auth/components/account-menu";
import ProjectPicker from "@/features/workspace/project-picker/components/project-picker";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { TerminalWindowIcon } from "@/ui/icons";
import { SidebarIconButton } from "@/ui/sidebar";
import { getWebContributions } from "@/utils/web-contributions";
import { selectIsTerminalPaneVisible } from "@/features/layout/stores/ui-state-selectors";
import { useCommandShortcut } from "@/features/keymaps/hooks/use-command-shortcut";

export function ActivityChrome() {
  const isProjectPickerVisible = useUIState((state) => state.isProjectPickerVisible);
  const projectPickerInitialStep = useUIState((state) => state.projectPickerInitialStep);
  const setIsProjectPickerVisible = useUIState((state) => state.setIsProjectPickerVisible);

  return (
    <>
      {createPortal(
        isProjectPickerVisible ? (
          <ProjectPicker
            isOpen
            initialStep={projectPickerInitialStep}
            onClose={() => setIsProjectPickerVisible(false)}
          />
        ) : null,
        document.body,
      )}
    </>
  );
}

function TerminalToggle() {
  const toggleTerminalShortcut = useCommandShortcut("workbench.toggleTerminal");
  const isTerminalOpen = useUIState(selectIsTerminalPaneVisible);
  return (
    <SidebarIconButton
      size="lg"
      active={isTerminalOpen}
      onClick={() => void keymapRegistry.executeCommand("workbench.toggleTerminal")}
      tooltip={isTerminalOpen ? "Hide Terminal" : "Show Terminal"}
      shortcut={toggleTerminalShortcut}
      aria-label={isTerminalOpen ? "Hide terminal" : "Show terminal"}
      aria-pressed={isTerminalOpen}
    >
      <TerminalWindowIcon />
    </SidebarIconButton>
  );
}

export function ActivityChromeFooter() {
  const WebAccountMenu = getWebContributions().AccountMenu;
  const terminalEnabled = useSettingsStore((state) => state.settings.coreFeatures.terminal);
  return (
    <div className="flex w-full flex-col items-center gap-1">
      <div className="flex flex-col items-center gap-1">
        <AppUpdateControl compact />
        {terminalEnabled ? <TerminalToggle /> : null}
        <RunActionsButton />
        <NotificationsTrigger />
      </div>
      {WebAccountMenu ? (
        <Suspense fallback={null}>
          <WebAccountMenu />
        </Suspense>
      ) : (
        <AccountMenu />
      )}
    </div>
  );
}
