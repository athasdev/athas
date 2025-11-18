/**
 * File operation commands
 */

import type { Command } from "../types";
import { commandContext } from "./command-context";

export const fileCommands: Command[] = [
  {
    id: "file.save",
    title: "Save File",
    category: "File",
    keybinding: "cmd+s",
    execute: () => {
      window.dispatchEvent(new CustomEvent("menu-save"));
    },
  },
  {
    id: "file.saveAs",
    title: "Save File As",
    category: "File",
    keybinding: "cmd+shift+s",
    execute: () => {
      window.dispatchEvent(new CustomEvent("menu-save-as"));
    },
  },
  {
    id: "file.close",
    title: "Close Tab",
    category: "File",
    keybinding: "cmd+w",
    execute: () => {
      const closeBuffer = commandContext.get("closeBuffer");
      const activeBuffer = commandContext.get("activeBuffer");
      if (closeBuffer && activeBuffer) {
        closeBuffer(activeBuffer.id);
      }
    },
  },
  {
    id: "file.closeAll",
    title: "Close All Tabs",
    category: "File",
    execute: () => {
      // To be implemented
    },
  },
  {
    id: "file.reopenClosed",
    title: "Reopen Closed Tab",
    category: "File",
    keybinding: "cmd+shift+t",
    execute: async () => {
      const reopenClosedTab = commandContext.get("reopenClosedTab");
      if (reopenClosedTab) {
        await reopenClosedTab();
      }
    },
  },
  {
    id: "file.new",
    title: "New File",
    category: "File",
    keybinding: "cmd+n",
    execute: () => {
      window.dispatchEvent(new CustomEvent("menu-new-file"));
    },
  },
  {
    id: "file.open",
    title: "Open File",
    category: "File",
    keybinding: "cmd+o",
    execute: () => {
      window.dispatchEvent(new CustomEvent("menu-open-file"));
    },
  },
  {
    id: "file.quickOpen",
    title: "Quick Open",
    category: "File",
    keybinding: "cmd+p",
    execute: () => {
      const setIsCommandPaletteVisible = commandContext.get("setIsCommandPaletteVisible");
      if (setIsCommandPaletteVisible) {
        setIsCommandPaletteVisible(true);
      }
    },
  },
];
