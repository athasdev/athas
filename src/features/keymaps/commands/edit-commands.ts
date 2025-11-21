/**
 * Edit operation commands
 */

import { editorAPI } from "@/features/editor/extensions/api";
import type { Command } from "../types";

export const editCommands: Command[] = [
  {
    id: "editor.selectAll",
    title: "Select All",
    category: "Edit",
    keybinding: "cmd+a",
    execute: () => {
      editorAPI.selectAll();
    },
  },
  {
    id: "editor.undo",
    title: "Undo",
    category: "Edit",
    keybinding: "cmd+z",
    execute: () => {
      editorAPI.undo();
    },
  },
  {
    id: "editor.redo",
    title: "Redo",
    category: "Edit",
    keybinding: "cmd+shift+z",
    execute: () => {
      editorAPI.redo();
    },
  },
  {
    id: "editor.copy",
    title: "Copy",
    category: "Edit",
    keybinding: "cmd+c",
    execute: () => {
      document.execCommand("copy");
    },
  },
  {
    id: "editor.cut",
    title: "Cut",
    category: "Edit",
    keybinding: "cmd+x",
    execute: () => {
      document.execCommand("cut");
    },
  },
  {
    id: "editor.paste",
    title: "Paste",
    category: "Edit",
    keybinding: "cmd+v",
    execute: async () => {
      try {
        const text = await navigator.clipboard.readText();
        const textarea = editorAPI.getTextareaRef();
        if (textarea) {
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const currentValue = textarea.value;
          const newValue = currentValue.substring(0, start) + text + currentValue.substring(end);
          textarea.value = newValue;
          textarea.selectionStart = textarea.selectionEnd = start + text.length;
          const event = new Event("input", { bubbles: true });
          textarea.dispatchEvent(event);
        }
      } catch (error) {
        console.error("Failed to paste:", error);
      }
    },
  },
  {
    id: "editor.duplicateLine",
    title: "Duplicate Line",
    category: "Edit",
    keybinding: "cmd+d",
    execute: () => {
      editorAPI.duplicateLine();
    },
  },
  {
    id: "editor.deleteLine",
    title: "Delete Line",
    category: "Edit",
    keybinding: "cmd+shift+k",
    execute: () => {
      editorAPI.deleteLine();
    },
  },
  {
    id: "editor.toggleComment",
    title: "Toggle Comment",
    category: "Edit",
    keybinding: "cmd+/",
    execute: () => {
      editorAPI.toggleComment();
    },
  },
  {
    id: "editor.moveLineUp",
    title: "Move Line Up",
    category: "Edit",
    keybinding: "alt+up",
    execute: () => {
      editorAPI.moveLineUp();
    },
  },
  {
    id: "editor.moveLineDown",
    title: "Move Line Down",
    category: "Edit",
    keybinding: "alt+down",
    execute: () => {
      editorAPI.moveLineDown();
    },
  },
  {
    id: "editor.copyLineUp",
    title: "Copy Line Up",
    category: "Edit",
    keybinding: "alt+shift+up",
    execute: () => {
      editorAPI.copyLineUp();
    },
  },
  {
    id: "editor.copyLineDown",
    title: "Copy Line Down",
    category: "Edit",
    keybinding: "alt+shift+down",
    execute: () => {
      editorAPI.copyLineDown();
    },
  },
  {
    id: "editor.formatDocument",
    title: "Format Document",
    category: "Edit",
    keybinding: "shift+alt+f",
    execute: () => {
      // To be implemented
    },
  },
];
