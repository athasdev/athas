import {
  ArrowCounterClockwiseIcon,
  ArrowDownIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  ArrowUpIcon,
  BroomIcon,
  ColumnsIcon,
  CopyIcon,
  ListIcon,
  RowsIcon,
  SearchIcon,
  SelectAllIcon,
  SidebarIcon,
  TerminalWindowIcon,
  WarningCircleIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@/ui/icons";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import type { BottomPaneTab } from "@/features/window/stores/ui-state/types/ui-state.types";
import { keymapRegistry } from "@/features/keymaps/utils/registry";
import { IS_LINUX, IS_MAC, IS_WINDOWS } from "@/utils/platform";
import type { Action } from "../types/action.types";

interface ViewActionsParams {
  isSidebarVisible: boolean;
  setIsSidebarVisible: (v: boolean) => void;
  isBottomPaneVisible: boolean;
  setIsBottomPaneVisible: (v: boolean) => void;
  bottomPaneActiveTab: BottomPaneTab;
  setBottomPaneActiveTab: (tab: BottomPaneTab) => void;
  settings: {
    activityRailExpanded: boolean;
    nativeMenuBar: boolean;
    compactMenuBar: boolean;
  };
  updateSetting: (key: string, value: any) => void | Promise<void>;
  zoomIn: (target: "editor" | "terminal") => void;
  zoomOut: (target: "editor" | "terminal") => void;
  resetZoom: (target: "editor" | "terminal") => void;
  onClose: () => void;
}

export const createViewActions = (params: ViewActionsParams): Action[] => {
  const {
    isSidebarVisible,
    setIsSidebarVisible,
    isBottomPaneVisible,
    setIsBottomPaneVisible,
    bottomPaneActiveTab,
    setBottomPaneActiveTab,
    settings,
    updateSetting,
    zoomIn,
    zoomOut,
    resetZoom,
    onClose,
  } = params;

  return [
    {
      id: "toggle-activity-sidebar",
      label: settings.activityRailExpanded
        ? "View: Collapse Activity Sidebar"
        : "View: Expand Activity Sidebar",
      description: settings.activityRailExpanded
        ? "Collapse the activity sidebar"
        : "Expand the activity sidebar",
      icon: <SidebarIcon />,
      category: "View",
      commandId: "workbench.toggleActivitySidebar",
      action: () => {
        void keymapRegistry.executeCommand("workbench.toggleActivitySidebar");
        onClose();
      },
    },
    {
      id: "toggle-sidebar",
      label: isSidebarVisible ? "View: Hide Secondary Sidebar" : "View: Show Secondary Sidebar",
      description: isSidebarVisible
        ? "Hide the secondary sidebar panel"
        : "Show the secondary sidebar panel",
      icon: <SidebarIcon />,
      category: "View",
      commandId: "workbench.toggleSidebar",
      action: () => {
        setIsSidebarVisible(!isSidebarVisible);
        onClose();
      },
    },
    {
      id: "toggle-bottom-pane",
      label: isBottomPaneVisible ? "View: Hide Bottom Pane" : "View: Show Bottom Pane",
      description: isBottomPaneVisible ? "Hide the bottom pane" : "Show the bottom pane",
      icon: <SidebarIcon />,
      category: "View",
      action: () => {
        setIsBottomPaneVisible(!isBottomPaneVisible);
        onClose();
      },
    },
    {
      id: "toggle-terminal",
      label:
        isBottomPaneVisible && bottomPaneActiveTab === "terminal"
          ? "View: Hide Terminal"
          : "View: Show Terminal",
      description: "Toggle integrated terminal panel",
      icon: <TerminalWindowIcon />,
      category: "View",
      commandId: "workbench.toggleTerminalAlt",
      action: () => {
        if (isBottomPaneVisible && bottomPaneActiveTab === "terminal") {
          setIsBottomPaneVisible(false);
        } else {
          setBottomPaneActiveTab("terminal");
          setIsBottomPaneVisible(true);
          window.dispatchEvent(new CustomEvent("terminal-ensure-session"));
        }
        onClose();
      },
    },
    {
      id: "toggle-diagnostics-panel",
      label: "View: Show Diagnostics",
      description: "Open diagnostics",
      icon: <WarningCircleIcon />,
      category: "View",
      commandId: "workbench.toggleDiagnostics",
      action: () => {
        useBufferStore.getState().actions.openDiagnosticsBuffer();
        onClose();
      },
    },
    {
      id: "toggle-find-view",
      label: "View: Find",
      description: "Find in the active editor",
      icon: <SearchIcon />,
      category: "View",
      commandId: "workbench.showFind",
      action: () => {
        void keymapRegistry.executeCommand("workbench.showFind");
        onClose();
      },
    },
    ...(!IS_MAC && !IS_WINDOWS && !IS_LINUX
      ? [
          {
            id: "toggle-native-menu-bar",
            label: settings.nativeMenuBar
              ? "View: Disable Native Menu Bar"
              : "View: Enable Native Menu Bar",
            description: settings.nativeMenuBar
              ? "Use custom menu bar"
              : "Use native operating system menu bar",
            icon: <ListIcon />,
            category: "View",
            action: async () => {
              const newValue = !settings.nativeMenuBar;
              updateSetting("nativeMenuBar", newValue);
              const { invoke } = await import("@tauri-apps/api/core");
              await invoke("toggle_menu_bar", { toggle: newValue });
              onClose();
            },
          },
        ]
      : []),
    ...(!IS_MAC
      ? [
          {
            id: "toggle-compact-menu-bar",
            label: settings.compactMenuBar
              ? "View: Disable Compact Menu Bar"
              : "View: Enable Compact Menu Bar",
            description: settings.compactMenuBar
              ? "Show full menu bar"
              : "Use compact menu bar with hamburger icon",
            icon: <ListIcon />,
            category: "View",
            action: () => {
              updateSetting("compactMenuBar", !settings.compactMenuBar);
              onClose();
            },
          },
        ]
      : []),
    {
      id: "view-zoom-in",
      label: "Editor: Zoom In",
      description: "Increase editor zoom level",
      icon: <ZoomInIcon />,
      category: "View",
      commandId: "workbench.zoomIn",
      action: () => {
        zoomIn("editor");
        onClose();
      },
    },
    {
      id: "view-zoom-out",
      label: "Editor: Zoom Out",
      description: "Decrease editor zoom level",
      icon: <ZoomOutIcon />,
      category: "View",
      commandId: "workbench.zoomOut",
      action: () => {
        zoomOut("editor");
        onClose();
      },
    },
    {
      id: "view-reset-zoom",
      label: "Editor: Reset Zoom",
      description: "Reset editor zoom to default level",
      icon: <ArrowCounterClockwiseIcon />,
      category: "View",
      commandId: "workbench.zoomReset",
      action: () => {
        resetZoom("editor");
        onClose();
      },
    },
    {
      id: "terminal-new",
      label: "Terminal: New Terminal",
      description: "Create a new integrated terminal",
      icon: <TerminalWindowIcon />,
      category: "Terminal",
      commandId: "terminal.new",
      action: () => {
        onClose();
        void keymapRegistry.executeCommand("terminal.new");
      },
    },
    {
      id: "terminal-find",
      label: "Terminal: Find",
      description: "Search in the active terminal",
      icon: <SearchIcon />,
      category: "Terminal",
      commandId: "terminal.find",
      action: () => {
        onClose();
        void keymapRegistry.executeCommand("terminal.find");
      },
    },
    {
      id: "terminal-previous-command",
      label: "Terminal: Scroll to Previous Command",
      description: "Jump to the previous prompt in the active terminal",
      icon: <ArrowUpIcon />,
      category: "Terminal",
      commandId: "terminal.previousCommand",
      action: () => {
        onClose();
        void keymapRegistry.executeCommand("terminal.previousCommand");
      },
    },
    {
      id: "terminal-next-command",
      label: "Terminal: Scroll to Next Command",
      description: "Jump to the next prompt in the active terminal",
      icon: <ArrowDownIcon />,
      category: "Terminal",
      commandId: "terminal.nextCommand",
      action: () => {
        onClose();
        void keymapRegistry.executeCommand("terminal.nextCommand");
      },
    },
    {
      id: "terminal-clear",
      label: "Terminal: Clear",
      description: "Clear the scrollback of the active terminal",
      icon: <BroomIcon />,
      category: "Terminal",
      commandId: "terminal.clear",
      action: () => {
        onClose();
        void keymapRegistry.executeCommand("terminal.clear");
      },
    },
    {
      id: "terminal-select-all",
      label: "Terminal: Select All",
      description: "Select the whole buffer of the active terminal",
      icon: <SelectAllIcon />,
      category: "Terminal",
      commandId: "terminal.selectAll",
      action: () => {
        onClose();
        void keymapRegistry.executeCommand("terminal.selectAll");
      },
    },
    {
      id: "terminal-copy-last-command-output",
      label: "Terminal: Copy Last Command Output",
      description: "Copy the output of the most recent command to the clipboard",
      icon: <CopyIcon />,
      category: "Terminal",
      commandId: "terminal.copyLastCommandOutput",
      action: () => {
        onClose();
        void keymapRegistry.executeCommand("terminal.copyLastCommandOutput");
      },
    },
    {
      id: "terminal-split-right",
      label: "Terminal: Split Right",
      description: "Open a terminal beside the active terminal",
      icon: <ColumnsIcon />,
      category: "Terminal",
      commandId: "terminal.split",
      action: () => {
        onClose();
        void keymapRegistry.executeCommand("terminal.split");
      },
    },
    {
      id: "terminal-split-down",
      label: "Terminal: Split Down",
      description: "Open a terminal below the active terminal",
      icon: <RowsIcon />,
      category: "Terminal",
      commandId: "terminal.splitDown",
      action: () => {
        onClose();
        void keymapRegistry.executeCommand("terminal.splitDown");
      },
    },
    {
      id: "terminal-unsplit",
      label: "Terminal: Unsplit",
      description: "Move the focused terminal pane back into its own tab",
      icon: <TerminalWindowIcon />,
      category: "Terminal",
      commandId: "terminal.unsplit",
      action: () => {
        onClose();
        void keymapRegistry.executeCommand("terminal.unsplit");
      },
    },
    {
      id: "terminal-focus-next-pane",
      label: "Terminal: Focus Next Pane",
      description: "Move focus to the next split pane of the active terminal",
      icon: <ArrowRightIcon />,
      category: "Terminal",
      commandId: "terminal.focusNextPane",
      action: () => {
        onClose();
        void keymapRegistry.executeCommand("terminal.focusNextPane");
      },
    },
    {
      id: "terminal-focus-previous-pane",
      label: "Terminal: Focus Previous Pane",
      description: "Move focus to the previous split pane of the active terminal",
      icon: <ArrowLeftIcon />,
      category: "Terminal",
      commandId: "terminal.focusPreviousPane",
      action: () => {
        onClose();
        void keymapRegistry.executeCommand("terminal.focusPreviousPane");
      },
    },
    {
      id: "terminal-zoom-in",
      label: "Terminal: Zoom In",
      description: "Increase terminal zoom level",
      icon: <ZoomInIcon />,
      category: "Terminal",
      action: () => {
        zoomIn("terminal");
        onClose();
      },
    },
    {
      id: "terminal-zoom-out",
      label: "Terminal: Zoom Out",
      description: "Decrease terminal zoom level",
      icon: <ZoomOutIcon />,
      category: "Terminal",
      action: () => {
        zoomOut("terminal");
        onClose();
      },
    },
    {
      id: "terminal-reset-zoom",
      label: "Terminal: Reset Zoom",
      description: "Reset terminal zoom to default level",
      icon: <ArrowCounterClockwiseIcon />,
      category: "Terminal",
      action: () => {
        resetZoom("terminal");
        onClose();
      },
    },
  ];
};
