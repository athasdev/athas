/**
 * Default keybindings for all platforms
 * Uses compact shortcut syntax, automatically normalized per platform
 */

import type { Keybinding } from "../types/keymaps.types";

export const defaultKeymaps: Keybinding[] = [
  // File Operations
  {
    key: "cmd+t",
    command: "workbench.newTab",
    source: "default",
    when: "!terminalFocus",
  },
  {
    key: "cmd+n",
    command: "workbench.newTab",
    source: "default",
    when: "!terminalFocus",
  },
  {
    key: "cmd+s",
    command: "file.save",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+shift+s",
    command: "file.saveAs",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+alt+s",
    command: "file.saveAll",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+w",
    command: "file.close",
    source: "default",
    when: "!terminalFocus",
  },
  {
    key: "cmd+shift+w",
    command: "workbench.closeWindow",
    source: "default",
  },
  { key: "cmd+shift+t", command: "file.reopenClosed", source: "default" },
  {
    key: "cmd+n",
    command: "terminal.new",
    source: "default",
    when: "terminalFocus",
  },
  { key: "cmd+o", command: "file.open", source: "default" },
  // Note: cmd+p is handled by the global keyboard shortcuts to avoid race conditions with command context

  // Edit Operations
  {
    key: "cmd+a",
    command: "editor.selectAll",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+z",
    command: "editor.undo",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+shift+z",
    command: "editor.redo",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+y",
    command: "editor.redo",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+c",
    command: "editor.copy",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+x",
    command: "editor.cut",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+v",
    command: "editor.paste",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+d",
    command: "editor.selectNextOccurrence",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+shift+l",
    command: "editor.selectAllOccurrences",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+t",
    command: "terminal.new",
    source: "default",
    when: "terminalFocus",
  },
  {
    key: "cmd+w",
    command: "terminal.close",
    source: "default",
    when: "terminalFocus",
  },
  {
    key: "cmd+d",
    command: "terminal.split",
    source: "default",
    when: "terminalFocus",
  },
  {
    key: "cmd+shift+k",
    command: "editor.deleteLine",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+/",
    command: "editor.toggleComment",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+k cmd+0",
    command: "editor.foldAll",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+k cmd+1",
    command: "editor.foldLevel1",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+k cmd+2",
    command: "editor.foldLevel2",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+k cmd+3",
    command: "editor.foldLevel3",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+k cmd+4",
    command: "editor.foldLevel4",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+k cmd+5",
    command: "editor.foldLevel5",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+k cmd+6",
    command: "editor.foldLevel6",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+k cmd+7",
    command: "editor.foldLevel7",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+k cmd+j",
    command: "editor.unfoldAll",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "alt+up",
    command: "editor.moveLineUp",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "alt+down",
    command: "editor.moveLineDown",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "alt+shift+up",
    command: "editor.copyLineUp",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "alt+shift+down",
    command: "editor.copyLineDown",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+alt+up",
    command: "editor.insertCursorAbove",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+alt+down",
    command: "editor.insertCursorBelow",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "shift+alt+i",
    command: "editor.insertCursorsAtLineEnds",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "shift+alt+f",
    command: "editor.formatDocument",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+k cmd+f",
    command: "editor.formatSelection",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "ctrl+space",
    command: "editor.triggerSuggest",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+shift+space",
    command: "editor.triggerParameterHints",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+k cmd+i",
    command: "editor.showHover",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+.",
    command: "editor.quickFix",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+i",
    command: "editor.inlineEdit",
    source: "default",
    when: "editorFocus",
  },

  // View Operations
  { key: "cmd+b", command: "workbench.toggleSidebar", source: "default" },
  { key: "cmd+j", command: "workbench.toggleTerminal", source: "default" },
  { key: "cmd+`", command: "workbench.toggleTerminalAlt", source: "default" },
  {
    key: "cmd+shift+j",
    command: "workbench.toggleDiagnostics",
    source: "default",
  },
  // Note: cmd+shift+p is handled by the global keyboard shortcuts to avoid race conditions with command context
  {
    key: "cmd+f",
    command: "workbench.showFind",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+f",
    command: "workbench.showFind",
    source: "default",
    when: "terminalFocus",
  },
  {
    key: "cmd+shift+f",
    command: "workbench.showGlobalSearch",
    source: "default",
  },
  {
    key: "cmd+shift+h",
    command: "workbench.showProjectSearch",
    source: "default",
  },
  {
    key: "cmd+shift+e",
    command: "workbench.showFileExplorer",
    source: "default",
  },
  {
    key: "cmd+shift+g",
    command: "workbench.showSourceControl",
    source: "default",
  },
  {
    key: "cmd+shift+d",
    command: "workbench.showDebugger",
    source: "default",
  },
  { key: "F5", command: "debug.start", source: "default" },
  { key: "shift+F5", command: "debug.stop", source: "default" },
  { key: "F9", command: "debug.toggleBreakpoint", source: "default" },
  {
    key: "cmd+shift+space",
    command: "workbench.agentLauncher",
    source: "default",
  },
  {
    key: "cmd+k cmd+t",
    command: "workbench.showThemeSelector",
    source: "default",
  },
  { key: "cmd+=", command: "workbench.zoomIn", source: "default" },
  { key: "cmd+-", command: "workbench.zoomOut", source: "default" },
  { key: "cmd+0", command: "workbench.zoomReset", source: "default" },

  // Navigation
  {
    key: "cmd+g",
    command: "editor.goToLine",
    source: "default",
    when: "editorFocus",
  },
  { key: "cmd+alt+right", command: "workbench.nextTab", source: "default" },
  { key: "cmd+alt+left", command: "workbench.previousTab", source: "default" },
  { key: "ctrl+tab", command: "workbench.nextTabCtrlTab", source: "default" },
  {
    key: "ctrl+shift+tab",
    command: "workbench.previousTabCtrlTab",
    source: "default",
  },
  { key: "ctrl+pagedown", command: "workbench.nextTabAlt", source: "default" },
  {
    key: "ctrl+pageup",
    command: "workbench.previousTabAlt",
    source: "default",
  },
  { key: "cmd+1", command: "workbench.switchToTab1", source: "default" },
  { key: "cmd+2", command: "workbench.switchToTab2", source: "default" },
  { key: "cmd+3", command: "workbench.switchToTab3", source: "default" },
  { key: "cmd+4", command: "workbench.switchToTab4", source: "default" },
  { key: "cmd+5", command: "workbench.switchToTab5", source: "default" },
  { key: "cmd+6", command: "workbench.switchToTab6", source: "default" },
  { key: "cmd+7", command: "workbench.switchToTab7", source: "default" },
  { key: "cmd+8", command: "workbench.switchToTab8", source: "default" },
  { key: "cmd+9", command: "workbench.switchToTab9", source: "default" },
  {
    key: "F12",
    command: "editor.goToDefinition",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+F12",
    command: "editor.goToImplementation",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "shift+F12",
    command: "editor.goToReferences",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+shift+\\",
    command: "editor.goToBracket",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+alt+backspace",
    command: "editor.removeBrackets",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+ctrl+shift+right",
    command: "editor.expandSelection",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+ctrl+shift+left",
    command: "editor.shrinkSelection",
    source: "default",
    when: "editorFocus",
  },
  { key: "ctrl+-", command: "navigation.goBack", source: "default" },
  { key: "ctrl+shift+-", command: "navigation.goForward", source: "default" },

  // Additional view commands
  { key: "cmd+p", command: "file.quickOpen", source: "default" },
  { key: "cmd+shift+o", command: "editor.showOutline", source: "default" },
  {
    key: "cmd+shift+p",
    command: "workbench.commandPalette",
    source: "default",
  },
  { key: "cmd+r", command: "workbench.toggleAIChat", source: "default" },
  { key: "cmd+shift+m", command: "workbench.toggleMinimap", source: "default" },
  {
    key: "alt+z",
    command: "editor.toggleWordWrap",
    source: "default",
    when: "editorFocus",
  },
  {
    key: "cmd+k cmd+s",
    command: "workbench.openKeyboardShortcuts",
    source: "default",
  },

  // Window Operations
  { key: "F11", command: "window.toggleFullscreen", source: "default" },
  {
    key: "cmd+ctrl+f",
    command: "window.toggleFullscreenMac",
    source: "default",
  },
  { key: "cmd+m", command: "window.minimize.mac", source: "default" },
  { key: "alt+F9", command: "window.minimize.alt", source: "default" },
  { key: "alt+F10", command: "window.maximize", source: "default" },
  { key: "cmd+q", command: "window.quit", source: "default" },
  { key: "alt+m", command: "window.toggleMenuBar", source: "default" },
];
