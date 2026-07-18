import { useBufferStore } from "@/features/editor/stores/buffer.store";
import {
  closeActiveEditorGroup,
  closeOtherEditorGroups,
  moveActiveEditorToAdjacentGroup,
  resetEditorGroupSizes,
  splitActiveEditorGroup,
  toggleActiveEditorGroupLock,
} from "@/features/panes/utils/pane-command-actions";
import { useUIState } from "@/features/window/stores/ui-state.store";
import {
  startGeneratedDebugSession,
  stopDebugSession,
  toggleActiveBreakpoint,
  toggleDebuggerPane,
} from "./debug-command-actions";
import {
  closeActiveTab,
  closeAllTabs,
  closeCurrentWindow,
  closeOtherTabs,
  closeSavedTabs,
  closeTabsToLeft,
  closeTabsToRight,
  createNewFile,
  openLocalHistoryForActiveFile,
  openProjectPicker,
  openQuickOpen,
  reopenClosedTab,
  revertActiveFile,
  saveActiveFile,
  saveActiveFileAs,
  saveAllFiles,
  showNewTab,
} from "./file-command-actions";
import {
  copyActiveEditorLineDown,
  copyActiveEditorLineUp,
  copyActiveEditorSelection,
  cutActiveEditorSelection,
  deleteActiveEditorLine,
  duplicateActiveEditorLine,
  expandActiveEditorSelection,
  foldAllActiveEditor,
  foldLevelActiveEditor,
  formatActiveEditorDocument,
  formatActiveEditorSelection,
  goToActiveEditorMatchingBracket,
  insertActiveEditorCursorAbove,
  insertActiveEditorCursorBelow,
  insertActiveEditorCursorsAtLineEnds,
  moveActiveEditorLineDown,
  moveActiveEditorLineUp,
  pasteIntoActiveEditor,
  redoActiveEditor,
  removeActiveEditorBrackets,
  runQuickFixForActiveEditor,
  selectAllActiveEditor,
  selectAllEditorOccurrences,
  selectNextEditorOccurrence,
  selectPreviousEditorOccurrence,
  selectToActiveEditorBracket,
  showHoverForActiveEditor,
  showInlineEditToolbar,
  shrinkActiveEditorSelection,
  toggleActiveEditorComment,
  triggerActiveEditorParameterHints,
  triggerActiveEditorRenameSymbol,
  triggerActiveEditorSuggest,
  unfoldAllActiveEditor,
  undoActiveEditor,
} from "./editor-command-actions";
import {
  goBack,
  goForward,
  goToDefinition,
  goToImplementation,
  goToReferences,
  goToTypeDefinition,
  openOutlinePicker,
  openOutlineSidebar,
  promptGoToLine,
} from "./navigation-command-actions";
import { restartAllLanguageServers, stopAllLanguageServers } from "./lsp-command-actions";
import {
  openCommandPalette,
  openDiagnosticsBuffer,
  openGlobalSearchBuffer,
  openKeyboardShortcuts,
  resetZoom,
  showFind,
  showFindReplace,
  showNotifications,
  showThemeSelector,
  showWhatsNew,
  toggleAgentLauncher,
  toggleAIChat,
  toggleFilesSidebar,
  toggleDockerSidebar,
  toggleGitHubSidebar,
  toggleLineNumbers,
  toggleMinimap,
  toggleRenderWhitespace,
  toggleSidebar,
  toggleSourceControlSidebar,
  toggleTerminalPane,
  toggleWordWrap,
  zoomIn,
  zoomOut,
} from "./view-command-actions";
import {
  maximizeWindow,
  minimizeWindow,
  minimizeWindowAlt,
  minimizeWindowMac,
  quitApplication,
  toggleFullscreen,
  toggleFullscreenMac,
  toggleNativeMenuBar,
} from "./window-command-actions";
import { useKeymapStore } from "../stores/keymaps.store";
import type { Command } from "../types/keymaps.types";
import { keymapRegistry } from "../utils/registry";

const fileCommands: Command[] = [
  {
    id: "workbench.newTab",
    title: "New Tab",
    category: "File",
    keybinding: "cmd+n",
    execute: showNewTab,
  },
  {
    id: "file.save",
    title: "Save File",
    category: "File",
    keybinding: "cmd+s",
    execute: saveActiveFile,
  },
  {
    id: "file.saveAs",
    title: "Save File As",
    category: "File",
    keybinding: "cmd+shift+s",
    execute: saveActiveFileAs,
  },
  {
    id: "file.saveAll",
    title: "Save All",
    category: "File",
    keybinding: "cmd+alt+s",
    execute: saveAllFiles,
  },
  {
    id: "file.revert",
    title: "Revert File",
    category: "File",
    execute: revertActiveFile,
  },
  {
    id: "file.close",
    title: "Close Tab",
    category: "File",
    keybinding: "cmd+w",
    execute: closeActiveTab,
  },
  {
    id: "workbench.closeWindow",
    title: "Close Window",
    category: "Workbench",
    keybinding: "cmd+shift+w",
    execute: closeCurrentWindow,
  },
  {
    id: "file.closeAll",
    title: "Close All Tabs",
    category: "File",
    execute: closeAllTabs,
  },
  {
    id: "file.closeOthers",
    title: "Close Other Tabs",
    category: "File",
    execute: closeOtherTabs,
  },
  {
    id: "file.closeSaved",
    title: "Close Saved Tabs",
    category: "File",
    execute: closeSavedTabs,
  },
  {
    id: "file.closeTabsToLeft",
    title: "Close Tabs to the Left",
    category: "File",
    execute: closeTabsToLeft,
  },
  {
    id: "file.closeTabsToRight",
    title: "Close Tabs to the Right",
    category: "File",
    execute: closeTabsToRight,
  },
  {
    id: "file.reopenClosed",
    title: "Reopen Closed Tab",
    category: "File",
    keybinding: "cmd+shift+t",
    execute: reopenClosedTab,
  },
  {
    id: "file.new",
    title: "New File",
    category: "File",
    execute: createNewFile,
  },
  {
    id: "file.open",
    title: "Open Project",
    category: "File",
    keybinding: "cmd+o",
    execute: openProjectPicker,
  },
  {
    id: "file.quickOpen",
    title: "Quick Open",
    category: "File",
    keybinding: "cmd+p",
    execute: openQuickOpen,
  },
  {
    id: "file.localHistory",
    title: "Show Local History",
    category: "File",
    execute: openLocalHistoryForActiveFile,
  },
];

const terminalCommands: Command[] = [
  {
    id: "terminal.new",
    title: "New Terminal",
    category: "Terminal",
    keybinding: "cmd+t",
    execute: () => {
      window.dispatchEvent(new CustomEvent("terminal-new"));
    },
  },
  {
    id: "terminal.close",
    title: "Close Terminal",
    category: "Terminal",
    keybinding: "cmd+w",
    execute: () => {
      window.dispatchEvent(new CustomEvent("close-active-terminal"));
    },
  },
  {
    id: "terminal.split",
    title: "Split Terminal",
    category: "Terminal",
    keybinding: "cmd+d",
    execute: () => {
      window.dispatchEvent(new CustomEvent("terminal-split"));
    },
  },
];

const lspCommands: Command[] = [
  {
    id: "lsp.restartAllServers",
    title: "Language Server: Restart All Servers",
    category: "Language Server",
    description: "Restart every active language server",
    execute: () => {
      void restartAllLanguageServers();
    },
  },
  {
    id: "lsp.stopAllServers",
    title: "Language Server: Stop All Servers",
    category: "Language Server",
    description: "Stop every active language server",
    execute: () => {
      void stopAllLanguageServers();
    },
  },
];

const foldLevelCommands: Command[] = Array.from({ length: 7 }, (_, index) => {
  const level = index + 1;

  return {
    id: `editor.foldLevel${level}`,
    title: `Fold Level ${level}`,
    category: "Edit",
    keybinding: `cmd+k cmd+${level}`,
    execute: () => foldLevelActiveEditor(level),
  };
});

const editCommands: Command[] = [
  {
    id: "editor.selectAll",
    title: "Select All",
    category: "Edit",
    keybinding: "cmd+a",
    execute: selectAllActiveEditor,
  },
  {
    id: "editor.undo",
    title: "Undo",
    category: "Edit",
    keybinding: "cmd+z",
    execute: undoActiveEditor,
  },
  {
    id: "editor.redo",
    title: "Redo",
    category: "Edit",
    keybinding: "cmd+shift+z",
    execute: redoActiveEditor,
  },
  {
    id: "editor.copy",
    title: "Copy",
    category: "Edit",
    keybinding: "cmd+c",
    execute: copyActiveEditorSelection,
  },
  {
    id: "editor.cut",
    title: "Cut",
    category: "Edit",
    keybinding: "cmd+x",
    execute: cutActiveEditorSelection,
  },
  {
    id: "editor.paste",
    title: "Paste",
    category: "Edit",
    keybinding: "cmd+v",
    execute: pasteIntoActiveEditor,
  },
  {
    id: "editor.selectNextOccurrence",
    title: "Add Selection To Next Find Match",
    category: "Edit",
    keybinding: "cmd+d",
    execute: selectNextEditorOccurrence,
  },
  {
    id: "editor.selectPreviousOccurrence",
    title: "Add Selection To Previous Find Match",
    category: "Edit",
    execute: selectPreviousEditorOccurrence,
  },
  {
    id: "editor.selectAllOccurrences",
    title: "Select All Occurrences of Find Match",
    category: "Edit",
    keybinding: "cmd+shift+l",
    execute: selectAllEditorOccurrences,
  },
  {
    id: "editor.duplicateLine",
    title: "Duplicate Line",
    category: "Edit",
    execute: duplicateActiveEditorLine,
  },
  {
    id: "editor.deleteLine",
    title: "Delete Line",
    category: "Edit",
    keybinding: "cmd+shift+k",
    execute: deleteActiveEditorLine,
  },
  {
    id: "editor.toggleComment",
    title: "Toggle Comment",
    category: "Edit",
    keybinding: "cmd+/",
    execute: toggleActiveEditorComment,
  },
  {
    id: "editor.foldAll",
    title: "Fold All",
    category: "Edit",
    keybinding: "cmd+k cmd+0",
    execute: () => foldAllActiveEditor(),
  },
  ...foldLevelCommands,
  {
    id: "editor.unfoldAll",
    title: "Unfold All",
    category: "Edit",
    keybinding: "cmd+k cmd+j",
    execute: () => unfoldAllActiveEditor(),
  },
  {
    id: "editor.moveLineUp",
    title: "Move Line Up",
    category: "Edit",
    keybinding: "alt+up",
    execute: moveActiveEditorLineUp,
  },
  {
    id: "editor.moveLineDown",
    title: "Move Line Down",
    category: "Edit",
    keybinding: "alt+down",
    execute: moveActiveEditorLineDown,
  },
  {
    id: "editor.copyLineUp",
    title: "Copy Line Up",
    category: "Edit",
    keybinding: "alt+shift+up",
    execute: copyActiveEditorLineUp,
  },
  {
    id: "editor.copyLineDown",
    title: "Copy Line Down",
    category: "Edit",
    keybinding: "alt+shift+down",
    execute: copyActiveEditorLineDown,
  },
  {
    id: "editor.insertCursorAbove",
    title: "Add Cursor Above",
    category: "Edit",
    keybinding: "cmd+alt+up",
    execute: insertActiveEditorCursorAbove,
  },
  {
    id: "editor.insertCursorBelow",
    title: "Add Cursor Below",
    category: "Edit",
    keybinding: "cmd+alt+down",
    execute: insertActiveEditorCursorBelow,
  },
  {
    id: "editor.insertCursorsAtLineEnds",
    title: "Add Cursors to Line Ends",
    category: "Edit",
    keybinding: "shift+alt+i",
    execute: insertActiveEditorCursorsAtLineEnds,
  },
  {
    id: "editor.formatDocument",
    title: "Format Document",
    category: "Edit",
    keybinding: "shift+alt+f",
    execute: () => {
      void formatActiveEditorDocument();
    },
  },
  {
    id: "editor.formatSelection",
    title: "Format Selection",
    category: "Edit",
    keybinding: "cmd+k cmd+f",
    execute: () => {
      void formatActiveEditorSelection();
    },
  },
  {
    id: "editor.triggerSuggest",
    title: "Trigger Suggest",
    category: "Edit",
    keybinding: "ctrl+space",
    execute: triggerActiveEditorSuggest,
  },
  {
    id: "editor.triggerParameterHints",
    title: "Trigger Parameter Hints",
    category: "Edit",
    keybinding: "cmd+shift+space",
    execute: triggerActiveEditorParameterHints,
  },
  {
    id: "editor.showHover",
    title: "Show Hover",
    category: "Edit",
    keybinding: "cmd+k cmd+i",
    execute: () => {
      void showHoverForActiveEditor();
    },
  },
  {
    id: "editor.quickFix",
    title: "Quick Fix",
    category: "Edit",
    keybinding: "cmd+.",
    execute: () => {
      void runQuickFixForActiveEditor();
    },
  },
  {
    id: "editor.inlineEdit",
    title: "Agent Inline Edit",
    category: "Edit",
    keybinding: "cmd+i",
    execute: showInlineEditToolbar,
  },
];

const viewCommands: Command[] = [
  {
    id: "workbench.toggleSidebar",
    title: "Toggle Sidebar",
    category: "View",
    keybinding: "cmd+b",
    execute: toggleSidebar,
  },
  {
    id: "workbench.toggleTerminal",
    title: "Toggle Terminal",
    category: "View",
    keybinding: "cmd+j",
    execute: toggleTerminalPane,
  },
  {
    id: "workbench.toggleTerminalAlt",
    title: "Toggle Terminal (Alt)",
    category: "View",
    keybinding: "cmd+`",
    execute: toggleTerminalPane,
  },
  {
    id: "workbench.toggleDiagnostics",
    title: "Show Diagnostics",
    category: "View",
    keybinding: "cmd+shift+j",
    execute: openDiagnosticsBuffer,
  },
  {
    id: "workbench.commandPalette",
    title: "Command Palette",
    category: "View",
    keybinding: "cmd+shift+p",
    execute: openCommandPalette,
  },
  {
    id: "workbench.showNotifications",
    title: "Show Notifications",
    category: "View",
    execute: showNotifications,
  },
  {
    id: "workbench.agentLauncher",
    title: "New Agent",
    category: "Agent",
    keybinding: "cmd+shift+space",
    execute: toggleAgentLauncher,
  },
  {
    id: "workbench.showFind",
    title: "Find",
    category: "View",
    keybinding: "cmd+f",
    execute: showFind,
  },
  {
    id: "workbench.showFindReplace",
    title: "Find and Replace",
    category: "View",
    keybinding: "cmd+alt+f",
    execute: showFindReplace,
  },
  {
    id: "workbench.showGlobalSearch",
    title: "Global Search",
    category: "View",
    keybinding: "cmd+shift+f",
    execute: openGlobalSearchBuffer,
  },
  {
    id: "workbench.showProjectSearch",
    title: "Project Search",
    category: "View",
    keybinding: "cmd+shift+h",
    execute: openGlobalSearchBuffer,
  },
  {
    id: "workbench.showFileExplorer",
    title: "Show Files",
    category: "View",
    keybinding: "cmd+shift+e",
    execute: toggleFilesSidebar,
  },
  {
    id: "workbench.showSourceControl",
    title: "Show Source Control",
    category: "View",
    keybinding: "cmd+shift+g",
    execute: toggleSourceControlSidebar,
  },
  {
    id: "workbench.showGitHub",
    title: "Show GitHub",
    category: "View",
    execute: toggleGitHubSidebar,
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
    keybinding: "cmd+shift+d",
    execute: toggleDebuggerPane,
  },
  {
    id: "debug.start",
    title: "Start Debugging",
    category: "Debug",
    keybinding: "F5",
    execute: startGeneratedDebugSession,
  },
  {
    id: "debug.stop",
    title: "Stop Debugging",
    category: "Debug",
    keybinding: "shift+F5",
    execute: stopDebugSession,
  },
  {
    id: "debug.toggleBreakpoint",
    title: "Toggle Breakpoint",
    category: "Debug",
    keybinding: "F9",
    execute: toggleActiveBreakpoint,
  },
  {
    id: "workbench.showThemeSelector",
    title: "Theme Selector",
    category: "View",
    keybinding: "cmd+k cmd+t",
    execute: showThemeSelector,
  },
  {
    id: "help.showWhatsNew",
    title: "What's New",
    category: "Help",
    execute: showWhatsNew,
  },
  {
    id: "workbench.toggleAIChat",
    title: "Toggle Agent",
    category: "View",
    keybinding: "cmd+r",
    execute: toggleAIChat,
  },
  {
    id: "workbench.toggleMinimap",
    title: "Toggle Minimap",
    category: "View",
    keybinding: "cmd+shift+m",
    execute: toggleMinimap,
  },
  {
    id: "editor.toggleWordWrap",
    title: "Toggle Word Wrap",
    category: "View",
    keybinding: "alt+z",
    execute: toggleWordWrap,
  },
  {
    id: "editor.toggleLineNumbers",
    title: "Toggle Line Numbers",
    category: "View",
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
    keybinding: "cmd+=",
    execute: zoomIn,
  },
  {
    id: "workbench.zoomOut",
    title: "Zoom Out",
    category: "View",
    keybinding: "cmd+-",
    execute: zoomOut,
  },
  {
    id: "workbench.zoomReset",
    title: "Reset Zoom",
    category: "View",
    keybinding: "cmd+0",
    execute: resetZoom,
  },
  {
    id: "workbench.openKeyboardShortcuts",
    title: "Open Keyboard Shortcuts",
    category: "View",
    keybinding: "cmd+k cmd+s",
    execute: openKeyboardShortcuts,
  },
];

const isTerminalFocused = () => useKeymapStore.getState().contexts.terminalFocus;

const switchNextTab = () => {
  if (isTerminalFocused()) {
    window.dispatchEvent(new CustomEvent("terminal-switch-tab", { detail: "next" }));
  } else {
    useBufferStore.getState().actions.switchToNextBuffer();
  }
};

const switchPrevTab = () => {
  if (isTerminalFocused()) {
    window.dispatchEvent(new CustomEvent("terminal-switch-tab", { detail: "prev" }));
  } else {
    useBufferStore.getState().actions.switchToPreviousBuffer();
  }
};

const navigationCommands: Command[] = [
  {
    id: "editor.goToLine",
    title: "Go to Line",
    category: "Navigation",
    keybinding: "cmd+g",
    execute: promptGoToLine,
  },
  {
    id: "editor.showOutline",
    title: "Go to Symbol in Editor",
    category: "Navigation",
    keybinding: "cmd+shift+o",
    execute: openOutlinePicker,
  },
  {
    id: "workbench.showOutline",
    title: "Show Outline",
    category: "Navigation",
    execute: openOutlineSidebar,
  },
  {
    id: "workbench.nextTab",
    title: "Next Tab",
    category: "Navigation",
    keybinding: "cmd+alt+right",
    execute: switchNextTab,
  },
  {
    id: "workbench.nextTabCtrlTab",
    title: "Next Tab (Ctrl+Tab)",
    category: "Navigation",
    keybinding: "ctrl+tab",
    execute: switchNextTab,
  },
  {
    id: "workbench.previousTab",
    title: "Previous Tab",
    category: "Navigation",
    keybinding: "cmd+alt+left",
    execute: switchPrevTab,
  },
  {
    id: "workbench.previousTabCtrlTab",
    title: "Previous Tab (Ctrl+Shift+Tab)",
    category: "Navigation",
    keybinding: "ctrl+shift+tab",
    execute: switchPrevTab,
  },
  {
    id: "workbench.nextTabAlt",
    title: "Next Tab (Alt)",
    category: "Navigation",
    keybinding: "ctrl+pagedown",
    execute: switchNextTab,
  },
  {
    id: "workbench.previousTabAlt",
    title: "Previous Tab (Alt)",
    category: "Navigation",
    keybinding: "ctrl+pageup",
    execute: switchPrevTab,
  },
  ...Array.from({ length: 9 }, (_, i) => ({
    id: `workbench.switchToTab${i + 1}`,
    title: `Switch to Tab ${i + 1}`,
    category: "Navigation",
    keybinding: `cmd+${i + 1}`,
    execute: () => {
      if (isTerminalFocused()) {
        window.dispatchEvent(new CustomEvent("terminal-activate-tab", { detail: i }));
        return;
      }
      const bufferStore = useBufferStore.getState();
      const buffer = bufferStore.buffers[i];
      if (buffer) bufferStore.actions.setActiveBuffer(buffer.id);
    },
  })),
  {
    id: "editor.goToDefinition",
    title: "Go to Definition",
    category: "Navigation",
    keybinding: "F12",
    execute: goToDefinition,
  },
  {
    id: "editor.goToImplementation",
    title: "Go to Implementation",
    category: "Navigation",
    keybinding: "cmd+F12",
    execute: goToImplementation,
  },
  {
    id: "editor.goToTypeDefinition",
    title: "Go to Type Definition",
    category: "Navigation",
    execute: goToTypeDefinition,
  },
  {
    id: "editor.goToReferences",
    title: "Go to References",
    category: "Navigation",
    keybinding: "shift+F12",
    execute: goToReferences,
  },
  {
    id: "editor.goToBracket",
    title: "Go to Bracket",
    category: "Navigation",
    keybinding: "cmd+shift+\\",
    execute: goToActiveEditorMatchingBracket,
  },
  {
    id: "editor.selectToBracket",
    title: "Select to Bracket",
    category: "Navigation",
    execute: selectToActiveEditorBracket,
  },
  {
    id: "editor.removeBrackets",
    title: "Remove Brackets",
    category: "Navigation",
    keybinding: "cmd+alt+backspace",
    execute: removeActiveEditorBrackets,
  },
  {
    id: "editor.expandSelection",
    title: "Expand Selection",
    category: "Selection",
    keybinding: "cmd+ctrl+shift+right",
    execute: expandActiveEditorSelection,
  },
  {
    id: "editor.shrinkSelection",
    title: "Shrink Selection",
    category: "Selection",
    keybinding: "cmd+ctrl+shift+left",
    execute: shrinkActiveEditorSelection,
  },
  {
    id: "editor.renameSymbol",
    title: "Rename Symbol",
    category: "Navigation",
    keybinding: "F2",
    execute: triggerActiveEditorRenameSymbol,
  },
  {
    id: "navigation.goBack",
    title: "Go Back",
    category: "Navigation",
    keybinding: "ctrl+-",
    execute: goBack,
  },
  {
    id: "navigation.goForward",
    title: "Go Forward",
    category: "Navigation",
    keybinding: "ctrl+shift+-",
    execute: goForward,
  },
];

const paneCommands: Command[] = [
  {
    id: "workbench.splitEditorRight",
    title: "Split Editor Right",
    category: "View",
    execute: () => {
      splitActiveEditorGroup("horizontal");
    },
  },
  {
    id: "workbench.splitEditorDown",
    title: "Split Editor Down",
    category: "View",
    execute: () => {
      splitActiveEditorGroup("vertical");
    },
  },
  {
    id: "workbench.closeEditorGroup",
    title: "Close Editor Group",
    category: "View",
    execute: () => {
      closeActiveEditorGroup();
    },
  },
  {
    id: "workbench.closeOtherEditorGroups",
    title: "Close Other Editor Groups",
    category: "View",
    execute: () => {
      closeOtherEditorGroups();
    },
  },
  {
    id: "workbench.moveEditorToNextGroup",
    title: "Move Editor Into Next Group",
    category: "View",
    execute: () => {
      moveActiveEditorToAdjacentGroup("next");
    },
  },
  {
    id: "workbench.moveEditorToPreviousGroup",
    title: "Move Editor Into Previous Group",
    category: "View",
    execute: () => {
      moveActiveEditorToAdjacentGroup("previous");
    },
  },
  {
    id: "workbench.resetEditorGroupSizes",
    title: "Reset Editor Group Sizes",
    category: "View",
    execute: () => {
      resetEditorGroupSizes();
    },
  },
  {
    id: "workbench.toggleEditorGroupLock",
    title: "Toggle Editor Group Lock",
    category: "View",
    execute: () => {
      toggleActiveEditorGroupLock();
    },
  },
];

const databaseCommands: Command[] = [
  {
    id: "database.connect",
    title: "Show Databases",
    category: "Database",
    execute: () => {
      useUIState.getState().openCommandPaletteView("databases");
    },
  },
];

const windowCommands: Command[] = [
  {
    id: "window.toggleFullscreen",
    title: "Toggle Fullscreen",
    category: "Window",
    keybinding: "F11",
    execute: toggleFullscreen,
  },
  {
    id: "window.toggleFullscreenMac",
    title: "Toggle Fullscreen (Mac)",
    category: "Window",
    keybinding: "cmd+ctrl+f",
    execute: toggleFullscreenMac,
  },
  {
    id: "window.minimize",
    title: "Minimize Window",
    category: "Window",
    execute: minimizeWindow,
  },
  {
    id: "window.minimize.mac",
    title: "Minimize (Mac)",
    category: "Window",
    keybinding: "cmd+m",
    execute: minimizeWindowMac,
  },
  {
    id: "window.minimize.alt",
    title: "Minimize (Alt)",
    category: "Window",
    keybinding: "alt+F9",
    execute: minimizeWindowAlt,
  },
  {
    id: "window.maximize",
    title: "Maximize Window",
    category: "Window",
    keybinding: "alt+F10",
    execute: maximizeWindow,
  },
  {
    id: "window.quit",
    title: "Quit Application",
    category: "Window",
    keybinding: "cmd+q",
    execute: quitApplication,
  },
  {
    id: "window.toggleMenuBar",
    title: "Toggle Menu Bar",
    category: "Window",
    keybinding: "alt+m",
    execute: toggleNativeMenuBar,
  },
];

const allCommands: Command[] = [
  ...fileCommands,
  ...editCommands,
  ...terminalCommands,
  ...lspCommands,
  ...viewCommands,
  ...navigationCommands,
  ...paneCommands,
  ...databaseCommands,
  ...windowCommands,
];

export function registerCommands(): void {
  for (const command of allCommands) {
    keymapRegistry.registerCommand(command);
  }
}
