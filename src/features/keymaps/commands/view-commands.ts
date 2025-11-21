/**
 * View and UI toggle commands
 */

import type { Command } from "../types";
import { commandContext } from "./command-context";

export const viewCommands: Command[] = [
  {
    id: "workbench.toggleSidebar",
    title: "Toggle Sidebar",
    category: "View",
    keybinding: "cmd+b",
    execute: () => {
      const setIsSidebarVisible = commandContext.get("setIsSidebarVisible");
      if (setIsSidebarVisible) {
        setIsSidebarVisible((prev) => !prev);
      }
    },
  },
  {
    id: "workbench.toggleTerminal",
    title: "Toggle Terminal",
    category: "View",
    keybinding: "cmd+`",
    execute: () => {
      const setIsBottomPaneVisible = commandContext.get("setIsBottomPaneVisible");
      const setBottomPaneActiveTab = commandContext.get("setBottomPaneActiveTab");
      const isBottomPaneVisible = commandContext.get("isBottomPaneVisible");
      const bottomPaneActiveTab = commandContext.get("bottomPaneActiveTab");

      if (setIsBottomPaneVisible && setBottomPaneActiveTab) {
        if (isBottomPaneVisible && bottomPaneActiveTab === "terminal") {
          setIsBottomPaneVisible(false);
        } else {
          setBottomPaneActiveTab("terminal");
          setIsBottomPaneVisible(true);
        }
      }
    },
  },
  {
    id: "workbench.toggleDiagnostics",
    title: "Toggle Diagnostics",
    category: "View",
    keybinding: "cmd+shift+j",
    execute: () => {
      const setIsBottomPaneVisible = commandContext.get("setIsBottomPaneVisible");
      const setBottomPaneActiveTab = commandContext.get("setBottomPaneActiveTab");
      const isBottomPaneVisible = commandContext.get("isBottomPaneVisible");
      const bottomPaneActiveTab = commandContext.get("bottomPaneActiveTab");

      if (setIsBottomPaneVisible && setBottomPaneActiveTab) {
        if (isBottomPaneVisible && bottomPaneActiveTab === "diagnostics") {
          setIsBottomPaneVisible(false);
        } else {
          setBottomPaneActiveTab("diagnostics");
          setIsBottomPaneVisible(true);
        }
      }
    },
  },
  {
    id: "workbench.commandPalette",
    title: "Command Palette",
    category: "View",
    keybinding: "cmd+shift+p",
    execute: () => {
      const setIsCommandPaletteVisible = commandContext.get("setIsCommandPaletteVisible");
      if (setIsCommandPaletteVisible) {
        setIsCommandPaletteVisible((prev) => !prev);
      }
    },
  },
  {
    id: "workbench.showFind",
    title: "Find",
    category: "View",
    keybinding: "cmd+f",
    execute: () => {
      const setIsFindVisible = commandContext.get("setIsFindVisible");
      if (setIsFindVisible) {
        setIsFindVisible((prev) => !prev);
      }
    },
  },
  {
    id: "workbench.showGlobalSearch",
    title: "Global Search",
    category: "View",
    keybinding: "cmd+shift+f",
    execute: () => {
      const setIsGlobalSearchVisible = commandContext.get("setIsGlobalSearchVisible");
      if (setIsGlobalSearchVisible) {
        setIsGlobalSearchVisible((prev) => !prev);
      }
    },
  },
  {
    id: "workbench.showProjectSearch",
    title: "Project Search",
    category: "View",
    keybinding: "cmd+shift+h",
    execute: () => {
      const setIsSidebarVisible = commandContext.get("setIsSidebarVisible");
      const setIsSearchViewActive = commandContext.get("setIsSearchViewActive");
      const focusSearchInput = commandContext.get("focusSearchInput");

      if (setIsSidebarVisible && setIsSearchViewActive && focusSearchInput) {
        setIsSidebarVisible(true);
        setIsSearchViewActive(true);
        setTimeout(() => {
          if (focusSearchInput) focusSearchInput();
        }, 100);
      }
    },
  },
  {
    id: "workbench.toggleSidebarPosition",
    title: "Toggle Sidebar Position",
    category: "View",
    keybinding: "cmd+shift+b",
    execute: () => {
      const onToggleSidebarPosition = commandContext.get("onToggleSidebarPosition");
      if (onToggleSidebarPosition) {
        onToggleSidebarPosition();
      }
    },
  },
  {
    id: "workbench.showThemeSelector",
    title: "Theme Selector",
    category: "View",
    keybinding: "cmd+k cmd+t",
    execute: () => {
      const setIsThemeSelectorVisible = commandContext.get("setIsThemeSelectorVisible");
      if (setIsThemeSelectorVisible) {
        setIsThemeSelectorVisible(true);
      }
    },
  },
  {
    id: "workbench.zoomIn",
    title: "Zoom In",
    category: "View",
    keybinding: "cmd+=",
    execute: () => {
      const zoomIn = commandContext.get("zoomIn");
      if (zoomIn) {
        zoomIn();
      }
    },
  },
  {
    id: "workbench.zoomOut",
    title: "Zoom Out",
    category: "View",
    keybinding: "cmd+-",
    execute: () => {
      const zoomOut = commandContext.get("zoomOut");
      if (zoomOut) {
        zoomOut();
      }
    },
  },
  {
    id: "workbench.zoomReset",
    title: "Reset Zoom",
    category: "View",
    keybinding: "cmd+0",
    execute: () => {
      const resetZoom = commandContext.get("resetZoom");
      if (resetZoom) {
        resetZoom();
      }
    },
  },
  {
    id: "workbench.openKeyboardShortcuts",
    title: "Open Keyboard Shortcuts",
    category: "View",
    keybinding: "cmd+k cmd+s",
    execute: async () => {
      const { useUIState } = await import("@/stores/ui-state-store");
      const { openSettingsDialog } = useUIState.getState();
      openSettingsDialog("keyboard");
    },
  },
];
