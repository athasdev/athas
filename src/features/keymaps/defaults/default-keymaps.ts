/**
 * Default keybindings for all platforms
 * Uses VS Code-style syntax, automatically normalized per platform
 */

import type { Keybinding } from "../types";

export const defaultKeymaps: Keybinding[] = [
  // File Operations
  { key: "cmd+s", command: "file.save", source: "default", when: "editorFocus" },
  { key: "cmd+shift+s", command: "file.saveAs", source: "default", when: "editorFocus" },
  { key: "cmd+w", command: "file.close", source: "default", when: "!terminalFocus" },
  { key: "cmd+shift+t", command: "file.reopenClosed", source: "default" },
  { key: "cmd+n", command: "file.new", source: "default" },
  { key: "cmd+o", command: "file.open", source: "default" },
  // Note: cmd+p is handled by the global keyboard shortcuts to avoid race conditions with command context

  // Edit Operations
  { key: "cmd+a", command: "editor.selectAll", source: "default", when: "editorFocus" },
  { key: "cmd+z", command: "editor.undo", source: "default", when: "editorFocus" },
  { key: "cmd+shift+z", command: "editor.redo", source: "default", when: "editorFocus" },
  { key: "cmd+y", command: "editor.redo", source: "default", when: "editorFocus" },
  { key: "cmd+c", command: "editor.copy", source: "default", when: "editorFocus" },
  { key: "cmd+x", command: "editor.cut", source: "default", when: "editorFocus" },
  { key: "cmd+v", command: "editor.paste", source: "default", when: "editorFocus" },
  { key: "cmd+d", command: "editor.duplicateLine", source: "default", when: "editorFocus" },
  { key: "cmd+shift+k", command: "editor.deleteLine", source: "default", when: "editorFocus" },
  { key: "cmd+/", command: "editor.toggleComment", source: "default", when: "editorFocus" },
  { key: "alt+up", command: "editor.moveLineUp", source: "default", when: "editorFocus" },
  { key: "alt+down", command: "editor.moveLineDown", source: "default", when: "editorFocus" },
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
    key: "shift+alt+f",
    command: "editor.formatDocument",
    source: "default",
    when: "editorFocus",
  },

  // View Operations
  { key: "cmd+b", command: "workbench.toggleSidebar", source: "default" },
  { key: "cmd+`", command: "workbench.toggleTerminal", source: "default" },
  { key: "cmd+shift+j", command: "workbench.toggleDiagnostics", source: "default" },
  // Note: cmd+shift+p is handled by the global keyboard shortcuts to avoid race conditions with command context
  { key: "cmd+f", command: "workbench.showFind", source: "default", when: "editorFocus" },
  { key: "cmd+shift+f", command: "workbench.showGlobalSearch", source: "default" },
  { key: "cmd+shift+h", command: "workbench.showProjectSearch", source: "default" },
  { key: "cmd+shift+b", command: "workbench.toggleSidebarPosition", source: "default" },
  { key: "cmd+k cmd+t", command: "workbench.showThemeSelector", source: "default" },
  { key: "cmd+=", command: "workbench.zoomIn", source: "default" },
  { key: "cmd+-", command: "workbench.zoomOut", source: "default" },
  { key: "cmd+0", command: "workbench.zoomReset", source: "default" },

  // Navigation
  { key: "cmd+g", command: "editor.goToLine", source: "default", when: "editorFocus" },
  { key: "ctrl+tab", command: "workbench.nextTab", source: "default" },
  { key: "ctrl+shift+tab", command: "workbench.previousTab", source: "default" },
  { key: "ctrl+pagedown", command: "workbench.nextTabAlt", source: "default" },
  { key: "ctrl+pageup", command: "workbench.previousTabAlt", source: "default" },
  { key: "cmd+1", command: "workbench.switchToTab1", source: "default" },
  { key: "cmd+2", command: "workbench.switchToTab2", source: "default" },
  { key: "cmd+3", command: "workbench.switchToTab3", source: "default" },
  { key: "cmd+4", command: "workbench.switchToTab4", source: "default" },
  { key: "cmd+5", command: "workbench.switchToTab5", source: "default" },
  { key: "cmd+6", command: "workbench.switchToTab6", source: "default" },
  { key: "cmd+7", command: "workbench.switchToTab7", source: "default" },
  { key: "cmd+8", command: "workbench.switchToTab8", source: "default" },
  { key: "cmd+9", command: "workbench.switchToTab9", source: "default" },
  { key: "F12", command: "editor.goToDefinition", source: "default", when: "editorFocus" },
  { key: "shift+F12", command: "editor.goToReferences", source: "default", when: "editorFocus" },
  { key: "ctrl+-", command: "navigation.goBack", source: "default" },
  { key: "ctrl+shift+-", command: "navigation.goForward", source: "default" },

  // Additional view commands
  { key: "cmd+p", command: "file.quickOpen", source: "default" },
  { key: "cmd+shift+p", command: "workbench.commandPalette", source: "default" },
  { key: "cmd+r", command: "workbench.toggleAIChat", source: "default" },
  { key: "cmd+shift+m", command: "workbench.toggleMinimap", source: "default" },
  { key: "cmd+k cmd+s", command: "workbench.openKeyboardShortcuts", source: "default" },

  // Window Operations
  { key: "F11", command: "window.toggleFullscreen", source: "default" },
  { key: "cmd+ctrl+f", command: "window.toggleFullscreenMac", source: "default" },
  { key: "cmd+m", command: "window.minimize.mac", source: "default" },
  { key: "alt+F9", command: "window.minimize.alt", source: "default" },
  { key: "alt+F10", command: "window.maximize", source: "default" },
  { key: "cmd+q", command: "window.quit", source: "default" },
  { key: "alt+m", command: "window.toggleMenuBar", source: "default" },
];
