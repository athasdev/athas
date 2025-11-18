/**
 * View and UI toggle commands
 */

import type { Command } from "../types";

export const viewCommands: Command[] = [
  {
    id: "workbench.toggleSidebar",
    title: "Toggle Sidebar",
    category: "View",
    keybinding: "cmd+b",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.toggleTerminal",
    title: "Toggle Terminal",
    category: "View",
    keybinding: "cmd+`",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.toggleDiagnostics",
    title: "Toggle Diagnostics",
    category: "View",
    keybinding: "cmd+shift+j",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.commandPalette",
    title: "Command Palette",
    category: "View",
    keybinding: "cmd+shift+p",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.showFind",
    title: "Find",
    category: "View",
    keybinding: "cmd+f",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.showGlobalSearch",
    title: "Global Search",
    category: "View",
    keybinding: "cmd+shift+f",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.showProjectSearch",
    title: "Project Search",
    category: "View",
    keybinding: "cmd+shift+h",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.toggleSidebarPosition",
    title: "Toggle Sidebar Position",
    category: "View",
    keybinding: "cmd+shift+b",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.showThemeSelector",
    title: "Theme Selector",
    category: "View",
    keybinding: "cmd+k cmd+t",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.zoomIn",
    title: "Zoom In",
    category: "View",
    keybinding: "cmd+=",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.zoomOut",
    title: "Zoom Out",
    category: "View",
    keybinding: "cmd+-",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.zoomReset",
    title: "Reset Zoom",
    category: "View",
    keybinding: "cmd+0",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
];
