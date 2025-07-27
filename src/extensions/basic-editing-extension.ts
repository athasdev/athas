import { useBufferStore } from "../stores/buffer-store";
import type { EditorAPI, EditorExtension } from "./extension-types";

export const basicEditingExtension: EditorExtension = {
  name: "Basic Editing",
  version: "1.0.0",
  description: "Provides basic editing functionality like tab handling and common shortcuts",

  commands: [
    {
      id: "editor.indent",
      name: "Indent",
      execute: (args) => {
        const editor = args?.editor as EditorAPI;
        if (!editor) return;
        const tabSize = editor.getSettings().tabSize;
        editor.insertText(" ".repeat(tabSize));
      },
    },
    {
      id: "editor.moveToLineStart",
      name: "Move to Start of Line",
      execute: (args) => {
        const editor = args?.editor as EditorAPI;
        if (!editor) return;

        const cursor = editor.getCursorPosition();
        const lines = editor.getLines();

        // Calculate offset for line start
        let offset = 0;
        for (let i = 0; i < cursor.line; i++) {
          offset += lines[i].length + 1; // +1 for newline
        }

        editor.setCursorPosition({
          line: cursor.line,
          column: 0,
          offset: offset,
        });
      },
    },
    {
      id: "editor.moveToLineEnd",
      name: "Move to End of Line",
      execute: (args) => {
        const editor = args?.editor as EditorAPI;
        if (!editor) return;

        const cursor = editor.getCursorPosition();
        const lines = editor.getLines();
        const lineLength = lines[cursor.line]?.length || 0;

        // Calculate offset for line end
        let offset = 0;
        for (let i = 0; i < cursor.line; i++) {
          offset += lines[i].length + 1; // +1 for newline
        }
        offset += lineLength;

        editor.setCursorPosition({
          line: cursor.line,
          column: lineLength,
          offset: offset,
        });
      },
    },
    {
      id: "editor.moveToDocumentStart",
      name: "Move to Start of Document",
      execute: (args) => {
        const editor = args?.editor as EditorAPI;
        if (!editor) return;

        editor.setCursorPosition({
          line: 0,
          column: 0,
          offset: 0,
        });
      },
    },
    {
      id: "editor.moveToDocumentEnd",
      name: "Move to End of Document",
      execute: (args) => {
        const editor = args?.editor as EditorAPI;
        if (!editor) return;

        const lines = editor.getLines();
        const lastLine = lines.length - 1;
        const lastColumn = lines[lastLine]?.length || 0;
        const content = editor.getContent();

        editor.setCursorPosition({
          line: lastLine,
          column: lastColumn,
          offset: content.length,
        });
      },
    },
    {
      id: "editor.nextTab",
      name: "Next Tab",
      execute: () => {
        const bufferStore = useBufferStore.getState();
        bufferStore.actions.switchToNextBuffer();
      },
    },
    {
      id: "editor.previousTab",
      name: "Previous Tab",
      execute: () => {
        const bufferStore = useBufferStore.getState();
        bufferStore.actions.switchToPreviousBuffer();
      },
    },
  ],

  keybindings: {
    Tab: "editor.indent",
    "Cmd+ArrowLeft": "editor.moveToLineStart",
    "Ctrl+ArrowLeft": "editor.moveToLineStart",
    "Cmd+ArrowRight": "editor.moveToLineEnd",
    "Ctrl+ArrowRight": "editor.moveToLineEnd",
    "Cmd+ArrowUp": "editor.moveToDocumentStart",
    "Ctrl+ArrowUp": "editor.moveToDocumentStart",
    "Cmd+ArrowDown": "editor.moveToDocumentEnd",
    "Ctrl+ArrowDown": "editor.moveToDocumentEnd",
    "Ctrl+Tab": "editor.nextTab",
    "Ctrl+Shift+Tab": "editor.previousTab",
  },
};
