/**
 * Navigation commands
 */

import type { Command } from "../types";
import { commandContext } from "./command-context";

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
      const switchToNextBuffer = commandContext.get("switchToNextBuffer");
      if (switchToNextBuffer) {
        switchToNextBuffer();
      }
    },
  },
  {
    id: "workbench.previousTab",
    title: "Previous Tab",
    category: "Navigation",
    keybinding: "ctrl+shift+tab",
    execute: () => {
      const switchToPreviousBuffer = commandContext.get("switchToPreviousBuffer");
      if (switchToPreviousBuffer) {
        switchToPreviousBuffer();
      }
    },
  },
  {
    id: "workbench.nextTabAlt",
    title: "Next Tab (Alt)",
    category: "Navigation",
    keybinding: "ctrl+pagedown",
    execute: () => {
      const switchToNextBuffer = commandContext.get("switchToNextBuffer");
      if (switchToNextBuffer) {
        switchToNextBuffer();
      }
    },
  },
  {
    id: "workbench.previousTabAlt",
    title: "Previous Tab (Alt)",
    category: "Navigation",
    keybinding: "ctrl+pageup",
    execute: () => {
      const switchToPreviousBuffer = commandContext.get("switchToPreviousBuffer");
      if (switchToPreviousBuffer) {
        switchToPreviousBuffer();
      }
    },
  },
  {
    id: "workbench.switchToTab1",
    title: "Switch to Tab 1",
    category: "Navigation",
    keybinding: "cmd+1",
    execute: () => {
      const buffers = commandContext.get("buffers");
      const setActiveBuffer = commandContext.get("setActiveBuffer");
      if (buffers && setActiveBuffer && buffers[0]) {
        setActiveBuffer(buffers[0].id);
      }
    },
  },
  {
    id: "workbench.switchToTab2",
    title: "Switch to Tab 2",
    category: "Navigation",
    keybinding: "cmd+2",
    execute: () => {
      const buffers = commandContext.get("buffers");
      const setActiveBuffer = commandContext.get("setActiveBuffer");
      if (buffers && setActiveBuffer && buffers[1]) {
        setActiveBuffer(buffers[1].id);
      }
    },
  },
  {
    id: "workbench.switchToTab3",
    title: "Switch to Tab 3",
    category: "Navigation",
    keybinding: "cmd+3",
    execute: () => {
      const buffers = commandContext.get("buffers");
      const setActiveBuffer = commandContext.get("setActiveBuffer");
      if (buffers && setActiveBuffer && buffers[2]) {
        setActiveBuffer(buffers[2].id);
      }
    },
  },
  {
    id: "workbench.switchToTab4",
    title: "Switch to Tab 4",
    category: "Navigation",
    keybinding: "cmd+4",
    execute: () => {
      const buffers = commandContext.get("buffers");
      const setActiveBuffer = commandContext.get("setActiveBuffer");
      if (buffers && setActiveBuffer && buffers[3]) {
        setActiveBuffer(buffers[3].id);
      }
    },
  },
  {
    id: "workbench.switchToTab5",
    title: "Switch to Tab 5",
    category: "Navigation",
    keybinding: "cmd+5",
    execute: () => {
      const buffers = commandContext.get("buffers");
      const setActiveBuffer = commandContext.get("setActiveBuffer");
      if (buffers && setActiveBuffer && buffers[4]) {
        setActiveBuffer(buffers[4].id);
      }
    },
  },
  {
    id: "workbench.switchToTab6",
    title: "Switch to Tab 6",
    category: "Navigation",
    keybinding: "cmd+6",
    execute: () => {
      const buffers = commandContext.get("buffers");
      const setActiveBuffer = commandContext.get("setActiveBuffer");
      if (buffers && setActiveBuffer && buffers[5]) {
        setActiveBuffer(buffers[5].id);
      }
    },
  },
  {
    id: "workbench.switchToTab7",
    title: "Switch to Tab 7",
    category: "Navigation",
    keybinding: "cmd+7",
    execute: () => {
      const buffers = commandContext.get("buffers");
      const setActiveBuffer = commandContext.get("setActiveBuffer");
      if (buffers && setActiveBuffer && buffers[6]) {
        setActiveBuffer(buffers[6].id);
      }
    },
  },
  {
    id: "workbench.switchToTab8",
    title: "Switch to Tab 8",
    category: "Navigation",
    keybinding: "cmd+8",
    execute: () => {
      const buffers = commandContext.get("buffers");
      const setActiveBuffer = commandContext.get("setActiveBuffer");
      if (buffers && setActiveBuffer && buffers[7]) {
        setActiveBuffer(buffers[7].id);
      }
    },
  },
  {
    id: "workbench.switchToTab9",
    title: "Switch to Tab 9",
    category: "Navigation",
    keybinding: "cmd+9",
    execute: () => {
      const buffers = commandContext.get("buffers");
      const setActiveBuffer = commandContext.get("setActiveBuffer");
      if (buffers && setActiveBuffer && buffers[8]) {
        setActiveBuffer(buffers[8].id);
      }
    },
  },
  {
    id: "editor.goToDefinition",
    title: "Go to Definition",
    category: "Navigation",
    keybinding: "F12",
    execute: async () => {
      const { LspClient } = await import("@/features/editor/lsp/lsp-client");
      const { useBufferStore } = await import("@/features/editor/stores/buffer-store");
      const { useEditorStateStore } = await import("@/features/editor/stores/state-store");
      const { readFileContent } = await import(
        "@/features/file-system/controllers/file-operations"
      );
      const { editorAPI } = await import("@/features/editor/extensions/api");

      const lspClient = LspClient.getInstance();
      const bufferStore = useBufferStore.getState();
      const activeBuffer = bufferStore.buffers.find((b) => b.id === bufferStore.activeBufferId);
      const cursorPosition = useEditorStateStore.getState().cursorPosition;

      if (!activeBuffer?.path) {
        console.warn("No active file to get definition");
        return;
      }

      const definition = await lspClient.getDefinition(
        activeBuffer.path,
        cursorPosition.line,
        cursorPosition.column,
      );

      if (definition && definition.length > 0) {
        const target = definition[0];
        const filePath = target.uri.replace("file://", "");

        const existingBuffer = bufferStore.buffers.find((b) => b.path === filePath);

        if (existingBuffer) {
          bufferStore.actions.setActiveBuffer(existingBuffer.id);
        } else {
          try {
            const content = await readFileContent(filePath);
            const fileName = filePath.split("/").pop() || "untitled";
            const bufferId = bufferStore.actions.openBuffer(filePath, fileName, content);
            bufferStore.actions.setActiveBuffer(bufferId);
          } catch (error) {
            console.error("Failed to open file:", error);
            return;
          }
        }

        setTimeout(() => {
          const lines = editorAPI.getLines();
          let offset = 0;
          for (let i = 0; i < target.range.start.line; i++) {
            offset += lines[i].length + 1;
          }
          offset += target.range.start.character;

          editorAPI.setCursorPosition({
            line: target.range.start.line,
            column: target.range.start.character,
            offset,
          });
        }, 100);
      }
    },
  },
  {
    id: "editor.goToReferences",
    title: "Go to References",
    category: "Navigation",
    keybinding: "shift+F12",
    execute: async () => {
      const { LspClient } = await import("@/features/editor/lsp/lsp-client");
      const { useBufferStore } = await import("@/features/editor/stores/buffer-store");
      const { useEditorStateStore } = await import("@/features/editor/stores/state-store");

      const lspClient = LspClient.getInstance();
      const bufferStore = useBufferStore.getState();
      const activeBuffer = bufferStore.buffers.find((b) => b.id === bufferStore.activeBufferId);
      const cursorPosition = useEditorStateStore.getState().cursorPosition;

      if (!activeBuffer?.path) {
        console.warn("No active file to get references");
        return;
      }

      const references = await lspClient.getReferences(
        activeBuffer.path,
        cursorPosition.line,
        cursorPosition.column,
      );

      if (references && references.length > 0) {
        console.log(`Found ${references.length} references:`, references);
      } else {
        console.log("No references found");
      }
    },
  },
];
