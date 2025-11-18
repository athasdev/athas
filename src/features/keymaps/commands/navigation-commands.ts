/**
 * Navigation commands
 */

import type { Command } from "../types";

export const navigationCommands: Command[] = [
  {
    id: "editor.goToLine",
    title: "Go to Line",
    category: "Navigation",
    keybinding: "cmd+g",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.nextTab",
    title: "Next Tab",
    category: "Navigation",
    keybinding: "ctrl+tab",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.previousTab",
    title: "Previous Tab",
    category: "Navigation",
    keybinding: "ctrl+shift+tab",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.nextTabAlt",
    title: "Next Tab (Alt)",
    category: "Navigation",
    keybinding: "ctrl+pagedown",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.previousTabAlt",
    title: "Previous Tab (Alt)",
    category: "Navigation",
    keybinding: "ctrl+pageup",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.switchToTab1",
    title: "Switch to Tab 1",
    category: "Navigation",
    keybinding: "cmd+1",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.switchToTab2",
    title: "Switch to Tab 2",
    category: "Navigation",
    keybinding: "cmd+2",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.switchToTab3",
    title: "Switch to Tab 3",
    category: "Navigation",
    keybinding: "cmd+3",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.switchToTab4",
    title: "Switch to Tab 4",
    category: "Navigation",
    keybinding: "cmd+4",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.switchToTab5",
    title: "Switch to Tab 5",
    category: "Navigation",
    keybinding: "cmd+5",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.switchToTab6",
    title: "Switch to Tab 6",
    category: "Navigation",
    keybinding: "cmd+6",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.switchToTab7",
    title: "Switch to Tab 7",
    category: "Navigation",
    keybinding: "cmd+7",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.switchToTab8",
    title: "Switch to Tab 8",
    category: "Navigation",
    keybinding: "cmd+8",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "workbench.switchToTab9",
    title: "Switch to Tab 9",
    category: "Navigation",
    keybinding: "cmd+9",
    execute: () => {
      // Handled by keyboard shortcuts hook - will migrate
    },
  },
  {
    id: "editor.goToDefinition",
    title: "Go to Definition",
    category: "Navigation",
    execute: () => {
      // To be implemented with LSP
    },
  },
  {
    id: "editor.goToReferences",
    title: "Go to References",
    category: "Navigation",
    execute: () => {
      // To be implemented with LSP
    },
  },
];
