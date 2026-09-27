import { useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { openFolder } from "@/features/file-system/controllers/platform";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { AppUpdateControl } from "@/features/layout/components/app-update-control";
import { NotificationsTrigger } from "@/features/notifications/components/notifications-trigger";
import RunActionsButton from "@/features/run-actions/components/run-actions-button";
import { toggleTerminalPane } from "@/features/keymaps/commands/view-command-actions";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { AccountMenu } from "@/features/window/components/account-menu";
import ProjectPicker from "@/features/window/components/project-picker";
import WindowMenuBar from "@/features/window/components/window-menu-bar";
import { useUIState } from "@/features/window/stores/ui-state.store";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { Button } from "@/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/ui/context-menu";
import {
  FilesIcon,
  FolderOpenIcon,
  ListIcon,
  TerminalWindowIcon,
  TrashIcon,
  WindowExpandIcon,
} from "@/ui/icons";
import { SidebarIconButton } from "@/ui/sidebar";
import Tooltip from "@/ui/tooltip";
import { IS_MAC } from "@/utils/platform";

export function ActivityChrome() {
  const handleOpenFolder = useFileSystemStore((state) => state.handleOpenFolder);
  const closeProject = useFileSystemStore((state) => state.closeProject);
  const projectTabs = useWorkspaceTabsStore.use.projectTabs();
  const openProjectPicker = useUIState((state) => state.openProjectPicker);
  const isProjectPickerVisible = useUIState((state) => state.isProjectPickerVisible);
  const projectPickerInitialStep = useUIState((state) => state.projectPickerInitialStep);
  const setIsProjectPickerVisible = useUIState((state) => state.setIsProjectPickerVisible);
  const [menuBarActiveMenu, setMenuBarActiveMenu] = useState<string | null>(null);
  const [isCompactMenuVisible, setIsCompactMenuVisible] = useState(false);
  const menuAnchorRef = useRef<HTMLDivElement>(null);

  const handleCloseAllProjects = useCallback(async () => {
    for (const tab of useWorkspaceTabsStore.getState().projectTabs) {
      await closeProject(tab.id);
    }
  }, [closeProject]);

  const menuItem = !IS_MAC ? (
    <div ref={menuAnchorRef}>
      <Tooltip content="Menu">
        <Button
          onClick={() => {
            setMenuBarActiveMenu(null);
            setIsCompactMenuVisible((visible) => !visible);
          }}
          variant="ghost"
          iconOnly
          size="lg"
          active={isCompactMenuVisible}
          aria-label="Menu"
          aria-expanded={isCompactMenuVisible}
        >
          <ListIcon />
        </Button>
      </Tooltip>
    </div>
  ) : null;

  return (
    <>
      {menuItem ? (
        <ContextMenu>
          <ContextMenuTrigger
            className="flex w-full shrink-0 flex-col gap-1 px-1 pb-2"
            onContextMenu={(event) => event.stopPropagation()}
          >
            {menuItem}
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem onClick={() => void createAppWindow()}>
              <WindowExpandIcon />
              New Window
            </ContextMenuItem>
            <ContextMenuItem onClick={() => openProjectPicker()}>
              <FilesIcon />
              Add Project
            </ContextMenuItem>
            <ContextMenuItem onClick={() => void handleOpenFolder()}>
              <FolderOpenIcon />
              Open Folder
            </ContextMenuItem>
            <ContextMenuItem
              onClick={() =>
                void openFolder().then(
                  (path) => path && createAppWindow({ path, isDirectory: true }),
                )
              }
            >
              <WindowExpandIcon />
              Open Folder in New Window
            </ContextMenuItem>
            {projectTabs.length > 0 ? (
              <>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => void handleCloseAllProjects()}>
                  <TrashIcon />
                  Close All Projects
                </ContextMenuItem>
              </>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      ) : null}
      {isCompactMenuVisible &&
        menuAnchorRef.current &&
        createPortal(
          <div
            className="fixed z-100000"
            style={{
              top: menuAnchorRef.current.getBoundingClientRect().bottom,
              left: menuAnchorRef.current.getBoundingClientRect().left,
            }}
          >
            <WindowMenuBar
              activeMenu={menuBarActiveMenu}
              setActiveMenu={setMenuBarActiveMenu}
              compactFloating
              onCompactClose={() => {
                setMenuBarActiveMenu(null);
                setIsCompactMenuVisible(false);
              }}
            />
          </div>,
          document.body,
        )}
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
  const isTerminalOpen = useUIState(
    (state) => state.isBottomPaneVisible && state.bottomPaneActiveTab === "terminal",
  );
  return (
    <SidebarIconButton
      size="lg"
      active={isTerminalOpen}
      onClick={toggleTerminalPane}
      tooltip={isTerminalOpen ? "Hide Terminal" : "Show Terminal"}
      commandId="workbench.toggleTerminal"
      aria-label={isTerminalOpen ? "Hide terminal" : "Show terminal"}
      aria-pressed={isTerminalOpen}
    >
      <TerminalWindowIcon />
    </SidebarIconButton>
  );
}

export function ActivityChromeFooter() {
  const terminalEnabled = useSettingsStore((state) => state.settings.coreFeatures.terminal);
  return (
    <div className="flex w-full flex-col items-center gap-1">
      <div className="flex flex-col items-center gap-1">
        <AppUpdateControl compact />
        {terminalEnabled ? <TerminalToggle /> : null}
        <RunActionsButton />
        <NotificationsTrigger />
      </div>
      <AccountMenu />
    </div>
  );
}
