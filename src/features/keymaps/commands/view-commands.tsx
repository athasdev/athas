import {
  ArrowCounterClockwiseIcon,
  CodeIcon,
  DatabaseIcon,
  HashIcon,
  ListIcon,
  SearchIcon,
  SidebarIcon,
  SparkleIcon,
  TerminalWindowIcon,
  TextAlignJustifyIcon,
  WarningCircleIcon,
  ZoomInIcon,
  ZoomOutIcon,
} from "@/ui/icons";
import { setNativeMenuBarEnabled } from "@/features/window/services/native-window-api";
import { usePerformanceExperiments } from "@/features/settings/stores/performance-experiments.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useUIState } from "@/features/layout/stores/ui-state.store";
import { IS_LINUX, IS_MAC, IS_WINDOWS } from "@/utils/platform";
import { emitAppEvent } from "@/utils/app-events";
import type { Command } from "../types/keymaps.types";
import {
  restartDebugSession,
  startGeneratedDebugSession,
  stopDebugSession,
  toggleActiveBreakpoint,
  toggleDebuggerPane,
} from "./debug-command-actions";
import {
  openCommandPalette,
  openDiagnosticsBuffer,
  openGlobalSearchBuffer,
  openKeyboardShortcuts,
  openNewAgentSession,
  resetZoom,
  showFind,
  showFindReplace,
  showNotifications,
  showThemeSelector,
  showWhatsNew,
  toggleDockerSidebar,
  toggleFilesSidebar,
  toggleGitHubSidebar,
  toggleLineNumbers,
  toggleMinimap,
  toggleRenderWhitespace,
  toggleSidebar,
  toggleSourceControlSidebar,
  toggleTerminalPane,
  toggleViewsSidebar,
  toggleWordWrap,
  zoomIn,
  zoomOut,
} from "./view-command-actions";
import { selectIsTerminalPaneVisible } from "@/features/layout/stores/ui-state-selectors";

export const viewCommands: Command[] = [
  {
    id: "workbench.togglePerformanceMonitor",
    title: "Toggle Performance Monitor",
    category: "View",
    execute: () => usePerformanceExperiments.getState().actions.toggleMonitor(),
  },
  {
    id: "workbench.toggleSidebar",
    title: "Toggle Sidebar",
    category: "View",
    icon: <SidebarIcon />,
    palette: ({ ui }) =>
      ui.isSidebarVisible
        ? { label: "View: Hide Sidebar", description: "Hide the sidebar panel" }
        : { label: "View: Show Sidebar", description: "Show the sidebar panel" },
    execute: toggleSidebar,
  },
  {
    id: "workbench.toggleTerminal",
    title: "Toggle Terminal",
    category: "View",
    execute: toggleTerminalPane,
  },
  {
    id: "workbench.toggleTerminalAlt",
    title: "Toggle Terminal (Alt)",
    category: "View",
    execute: toggleTerminalPane,
  },
  {
    id: "workbench.toggleDiagnostics",
    title: "Show Diagnostics",
    category: "View",
    description: "Open diagnostics",
    icon: <WarningCircleIcon />,
    palette: { label: "View: Show Diagnostics" },
    execute: openDiagnosticsBuffer,
  },
  {
    id: "workbench.commandPalette",
    title: "Command Palette",
    category: "View",
    execute: openCommandPalette,
  },
  {
    id: "workbench.showNotifications",
    title: "Show Notifications",
    category: "View",
    execute: showNotifications,
  },
  {
    id: "workbench.hostedAgent",
    title: "New Athas Agent",
    category: "Agent",
    execute: async () => {
      const { openNewAgentChat } = await import("@/features/ai/services/open-new-agent-chat");
      const { useAIChatStore } = await import("@/features/ai/stores/ai-chat.store");
      await useSettingsStore.getState().actions.updateSetting("aiProviderId", "athas");
      await useSettingsStore.getState().actions.updateSetting("aiModelId", "auto");
      await useAIChatStore.getState().actions.checkApiKey("athas");
      openNewAgentChat("custom");
    },
  },
  {
    id: "workbench.agentLauncher",
    title: "New Agent",
    category: "Agent",
    description: "Open a new agent chat",
    icon: <SparkleIcon />,
    palette: { label: "AI: New Agent", category: "AI" },
    execute: openNewAgentSession,
  },
  {
    id: "workbench.showFind",
    title: "Find",
    category: "View",
    description: "Find in the active editor",
    icon: <SearchIcon />,
    palette: { label: "View: Find" },
    execute: showFind,
  },
  {
    id: "workbench.showFindReplace",
    title: "Find and Replace",
    category: "View",
    execute: showFindReplace,
  },
  {
    id: "workbench.showGlobalSearch",
    title: "Global Search",
    category: "View",
    description: "Search across files in workspace",
    icon: <SearchIcon />,
    palette: { label: "Search: Global Search", category: "Navigation" },
    execute: openGlobalSearchBuffer,
  },
  {
    id: "workbench.showProjectSearch",
    title: "Project Search",
    category: "View",
    execute: openGlobalSearchBuffer,
  },
  {
    id: "workbench.showFileExplorer",
    title: "Show Files",
    category: "View",
    execute: toggleFilesSidebar,
  },
  {
    id: "workbench.showSourceControl",
    title: "Show Source Control",
    category: "View",
    execute: toggleSourceControlSidebar,
  },
  {
    id: "workbench.showGitHub",
    title: "Show GitHub",
    category: "View",
    execute: toggleGitHubSidebar,
  },
  {
    id: "workbench.showViews",
    title: "Show Views",
    category: "View",
    execute: toggleViewsSidebar,
  },
  {
    id: "workbench.showDocker",
    title: "Show Docker",
    category: "View",
    execute: toggleDockerSidebar,
  },
  {
    id: "workbench.showDebugger",
    title: "Show Run and Debug",
    category: "View",
    execute: toggleDebuggerPane,
  },
  {
    id: "debug.start",
    title: "Start Debugging",
    category: "Debug",
    execute: startGeneratedDebugSession,
  },
  {
    id: "debug.stop",
    title: "Stop Debugging",
    category: "Debug",
    execute: stopDebugSession,
  },
  {
    id: "debug.restart",
    title: "Restart Debugging",
    category: "Debug",
    execute: restartDebugSession,
  },
  {
    id: "debug.toggleBreakpoint",
    title: "Toggle Breakpoint",
    category: "Debug",
    execute: toggleActiveBreakpoint,
  },
  {
    id: "workbench.showThemeSelector",
    title: "Theme Selector",
    category: "View",
    execute: showThemeSelector,
  },
  {
    id: "help.showWhatsNew",
    title: "What's New",
    category: "Help",
    description: "Open the latest release notes for this version",
    icon: <SparkleIcon />,
    palette: { label: "Help: What's New", category: "Settings" },
    execute: showWhatsNew,
  },
  {
    id: "workbench.toggleMinimap",
    title: "Toggle Minimap",
    category: "View",
    icon: <CodeIcon />,
    palette: ({ settings }) =>
      settings.showMinimap
        ? {
            label: "Editor: Hide Minimap",
            description: "Hide the editor minimap overview",
            category: "Editor",
          }
        : {
            label: "Editor: Show Minimap",
            description: "Show the editor minimap overview",
            category: "Editor",
          },
    execute: toggleMinimap,
  },
  {
    id: "editor.toggleWordWrap",
    title: "Toggle Word Wrap",
    category: "View",
    icon: <TextAlignJustifyIcon />,
    palette: ({ settings }) =>
      settings.wordWrap
        ? {
            label: "Editor: Disable Word Wrap",
            description: "Disable line wrapping in editor",
            category: "Editor",
          }
        : {
            label: "Editor: Enable Word Wrap",
            description: "Wrap lines that exceed viewport width",
            category: "Editor",
          },
    execute: toggleWordWrap,
  },
  {
    id: "editor.toggleLineNumbers",
    title: "Toggle Line Numbers",
    category: "View",
    icon: <HashIcon />,
    palette: ({ settings }) =>
      settings.lineNumbers
        ? {
            label: "Editor: Hide Line Numbers",
            description: "Hide line numbers in editor",
            category: "Editor",
          }
        : {
            label: "Editor: Show Line Numbers",
            description: "Show line numbers in editor",
            category: "Editor",
          },
    execute: toggleLineNumbers,
  },
  {
    id: "editor.toggleRenderWhitespace",
    title: "Toggle Render Whitespace",
    category: "View",
    execute: toggleRenderWhitespace,
  },
  {
    id: "workbench.zoomIn",
    title: "Zoom In",
    category: "View",
    description: "Increase the zoom level of the focused view",
    icon: <ZoomInIcon />,
    palette: { label: "View: Zoom In" },
    execute: zoomIn,
  },
  {
    id: "workbench.zoomOut",
    title: "Zoom Out",
    category: "View",
    description: "Decrease the zoom level of the focused view",
    icon: <ZoomOutIcon />,
    palette: { label: "View: Zoom Out" },
    execute: zoomOut,
  },
  {
    id: "workbench.zoomReset",
    title: "Reset Zoom",
    category: "View",
    description: "Reset the zoom level of the focused view",
    icon: <ArrowCounterClockwiseIcon />,
    palette: { label: "View: Reset Zoom" },
    execute: resetZoom,
  },
  {
    id: "workbench.openKeyboardShortcuts",
    title: "Open Keyboard Shortcuts",
    category: "View",
    execute: openKeyboardShortcuts,
  },
  {
    id: "workbench.toggleBottomPane",
    title: "View: Toggle Bottom Pane",
    category: "View",
    icon: <SidebarIcon />,
    palette: ({ ui }) =>
      ui.isBottomPaneVisible
        ? { label: "View: Hide Bottom Pane", description: "Hide the bottom pane" }
        : { label: "View: Show Bottom Pane", description: "Show the bottom pane" },
    execute: () => {
      const state = useUIState.getState();
      state.setIsBottomPaneVisible(!state.isBottomPaneVisible);
    },
  },
  {
    id: "view.toggleTerminal",
    title: "View: Toggle Terminal",
    category: "View",
    description: "Toggle integrated terminal panel",
    icon: <TerminalWindowIcon />,
    palette: ({ ui }) => ({
      label: selectIsTerminalPaneVisible(ui) ? "View: Hide Terminal" : "View: Show Terminal",
      keybindingCommandId: "workbench.toggleTerminalAlt",
    }),
    execute: () => {
      const state = useUIState.getState();
      if (selectIsTerminalPaneVisible(state)) {
        state.setIsBottomPaneVisible(false);
      } else {
        state.setBottomPaneActiveTab("terminal");
        state.setIsBottomPaneVisible(true);
        emitAppEvent("terminal-ensure-session");
      }
    },
  },
  {
    id: "view.toggleNativeMenuBar",
    title: "View: Toggle Native Menu Bar",
    category: "View",
    icon: <ListIcon />,
    when: () => !IS_MAC && !IS_WINDOWS && !IS_LINUX,
    palette: ({ settings }) =>
      settings.nativeMenuBar
        ? {
            label: "View: Disable Native Menu Bar",
            description: "Use custom menu bar",
            closePalette: "settled",
          }
        : {
            label: "View: Enable Native Menu Bar",
            description: "Use native operating system menu bar",
            closePalette: "settled",
          },
    execute: async () => {
      const { settings, actions } = useSettingsStore.getState();
      const newValue = !settings.nativeMenuBar;
      void actions.updateSetting("nativeMenuBar", newValue);
      await setNativeMenuBarEnabled(newValue);
    },
  },
  {
    id: "view.toggleCompactMenuBar",
    title: "View: Toggle Compact Menu Bar",
    category: "View",
    icon: <ListIcon />,
    when: () => !IS_MAC,
    palette: ({ settings }) =>
      settings.compactMenuBar
        ? { label: "View: Disable Compact Menu Bar", description: "Show full menu bar" }
        : {
            label: "View: Enable Compact Menu Bar",
            description: "Use compact menu bar with hamburger icon",
          },
    execute: () => {
      const { settings, actions } = useSettingsStore.getState();
      void actions.updateSetting("compactMenuBar", !settings.compactMenuBar);
    },
  },
];

export const databaseCommands: Command[] = [
  {
    id: "database.connect",
    title: "Show Databases",
    category: "Database",
    description: "Show workspace database connections in the sidebar",
    icon: <DatabaseIcon />,
    palette: { label: "Database: Show Databases" },
    execute: () => {
      const ui = useUIState.getState();
      ui.setActiveView("databases");
      ui.setIsSidebarVisible(true);
    },
  },
];
