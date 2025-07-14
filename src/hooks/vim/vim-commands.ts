import { getLineEndPosition, getLineStartPosition } from "./vim-motions";
import type { VimCommand } from "./vim-types";

export const commands: VimCommand[] = [
  // Insert mode commands
  {
    key: "i",
    mode: "normal",
    execute: context => {
      context.setState({ mode: "insert" });
    },
    description: "Enter insert mode",
  },
  {
    key: "I",
    mode: "normal",
    execute: context => {
      const lineStart = getLineStartPosition(context.content, context.cursorPosition);
      context.setCursorPosition(lineStart);
      context.setState({ mode: "insert" });
    },
    description: "Insert at beginning of line",
  },
  {
    key: "a",
    mode: "normal",
    execute: context => {
      context.setCursorPosition(Math.min(context.content.length, context.cursorPosition + 1));
      context.setState({ mode: "insert" });
    },
    description: "Insert after cursor",
  },
  {
    key: "A",
    mode: "normal",
    execute: context => {
      const lineEnd = getLineEndPosition(context.content, context.cursorPosition);
      context.setCursorPosition(lineEnd);
      context.setState({ mode: "insert" });
    },
    description: "Insert at end of line",
  },
  {
    key: "o",
    mode: "normal",
    execute: context => {
      const lineEnd = getLineEndPosition(context.content, context.cursorPosition);
      const newContent = `${context.content.slice(0, lineEnd)}\n${context.content.slice(lineEnd)}`;
      context.updateContent(newContent);
      context.setCursorPosition(lineEnd + 1);
      context.setState({ mode: "insert" });
    },
    description: "Open new line below",
  },
  {
    key: "O",
    mode: "normal",
    execute: context => {
      const lineStart = getLineStartPosition(context.content, context.cursorPosition);
      const newContent = `${context.content.slice(0, lineStart)}\n${context.content.slice(lineStart)}`;
      context.updateContent(newContent);
      context.setCursorPosition(lineStart);
      context.setState({ mode: "insert" });
    },
    description: "Open new line above",
  },

  // Visual mode commands
  {
    key: "v",
    mode: "normal",
    execute: context => {
      context.setState({ mode: "visual", visualStart: context.cursorPosition });
    },
    description: "Enter visual mode",
  },
  {
    key: "V",
    mode: "normal",
    execute: context => {
      const lineStart = getLineStartPosition(context.content, context.cursorPosition);
      const lineEnd = getLineEndPosition(context.content, context.cursorPosition);
      context.setState({ mode: "visual-line", visualStart: lineStart });
      if ("setSelectionRange" in context.textarea) {
        context.textarea.setSelectionRange(lineStart, lineEnd);
      }
    },
    description: "Enter visual line mode",
  },

  // Delete/change/substitute commands
  {
    key: "s",
    mode: "normal",
    execute: context => {
      if (context.cursorPosition < context.content.length) {
        const newContent =
          context.content.slice(0, context.cursorPosition) +
          context.content.slice(context.cursorPosition + 1);
        context.updateContent(newContent);
        context.setState({ mode: "insert" });
      }
    },
    description: "Substitute character",
  },
  {
    key: "S",
    mode: "normal",
    execute: context => {
      const lineStart = getLineStartPosition(context.content, context.cursorPosition);
      const lineEnd = getLineEndPosition(context.content, context.cursorPosition);
      const newContent = context.content.slice(0, lineStart) + context.content.slice(lineEnd);
      context.updateContent(newContent);
      context.setCursorPosition(lineStart);
      context.setState({ mode: "insert" });
    },
    description: "Substitute line",
  },
  {
    key: "x",
    mode: "normal",
    execute: context => {
      if (context.cursorPosition < context.content.length) {
        const deletedChar = context.content[context.cursorPosition];
        const newContent =
          context.content.slice(0, context.cursorPosition) +
          context.content.slice(context.cursorPosition + 1);
        context.updateContent(newContent);
        context.setState({ register: deletedChar });
      }
    },
    description: "Delete character under cursor",
  },
  {
    key: "X",
    mode: "normal",
    execute: context => {
      if (context.cursorPosition > 0) {
        const deletedChar = context.content[context.cursorPosition - 1];
        const newContent =
          context.content.slice(0, context.cursorPosition - 1) +
          context.content.slice(context.cursorPosition);
        context.updateContent(newContent);
        context.setState({ register: deletedChar });
        context.setCursorPosition(context.cursorPosition - 1);
      }
    },
    description: "Delete character before cursor",
  },
  {
    key: "D",
    mode: "normal",
    execute: context => {
      const lineEnd = getLineEndPosition(context.content, context.cursorPosition);
      const deletedText = context.content.slice(context.cursorPosition, lineEnd);
      const newContent =
        context.content.slice(0, context.cursorPosition) + context.content.slice(lineEnd);
      context.updateContent(newContent);
      context.setState({ register: deletedText });
    },
    description: "Delete to end of line",
  },
  {
    key: "C",
    mode: "normal",
    execute: context => {
      const lineEnd = getLineEndPosition(context.content, context.cursorPosition);
      const deletedText = context.content.slice(context.cursorPosition, lineEnd);
      const newContent =
        context.content.slice(0, context.cursorPosition) + context.content.slice(lineEnd);
      context.updateContent(newContent);
      context.setState({ register: deletedText, mode: "insert" });
    },
    description: "Change to end of line",
  },

  // Copy/paste commands
  {
    key: "p",
    mode: "normal",
    execute: context => {
      if (context.state.register) {
        const insertPos = Math.min(context.content.length, context.cursorPosition + 1);
        const newContent =
          context.content.slice(0, insertPos) +
          context.state.register +
          context.content.slice(insertPos);
        context.updateContent(newContent);
        context.setCursorPosition(insertPos + context.state.register.length);
      }
    },
    description: "Paste after cursor",
  },
  {
    key: "P",
    mode: "normal",
    execute: context => {
      if (context.state.register) {
        const newContent =
          context.content.slice(0, context.cursorPosition) +
          context.state.register +
          context.content.slice(context.cursorPosition);
        context.updateContent(newContent);
        context.setCursorPosition(context.cursorPosition + context.state.register.length);
      }
    },
    description: "Paste before cursor",
  },

  // Line operations
  {
    key: "dd",
    mode: "normal",
    execute: context => {
      const lineStart = getLineStartPosition(context.content, context.cursorPosition);
      const lineEnd = getLineEndPosition(context.content, context.cursorPosition);
      const lineEndWithNewline = context.content[lineEnd] === "\n" ? lineEnd + 1 : lineEnd;
      const deletedLine = context.content.slice(lineStart, lineEndWithNewline);
      const newContent =
        context.content.slice(0, lineStart) + context.content.slice(lineEndWithNewline);
      context.updateContent(newContent);
      context.setState({ register: deletedLine });
      context.setCursorPosition(Math.min(lineStart, newContent.length));
    },
    description: "Delete entire line",
  },
  {
    key: "yy",
    mode: "normal",
    execute: context => {
      const lineStart = getLineStartPosition(context.content, context.cursorPosition);
      const lineEnd = getLineEndPosition(context.content, context.cursorPosition);
      const lineEndWithNewline = context.content[lineEnd] === "\n" ? lineEnd + 1 : lineEnd;
      const yankedLine = context.content.slice(lineStart, lineEndWithNewline);
      context.setState({ register: yankedLine });
    },
    description: "Yank entire line",
  },
  {
    key: "cc",
    mode: "normal",
    execute: context => {
      const lineStart = getLineStartPosition(context.content, context.cursorPosition);
      const lineEnd = getLineEndPosition(context.content, context.cursorPosition);
      const deletedLine = context.content.slice(lineStart, lineEnd);
      const newContent = context.content.slice(0, lineStart) + context.content.slice(lineEnd);
      context.updateContent(newContent);
      context.setState({ register: deletedLine, mode: "insert" });
      context.setCursorPosition(lineStart);
    },
    description: "Change entire line",
  },

  // Command line mode
  {
    key: ":",
    mode: "normal",
    execute: context => {
      if (context.showCommandLine) {
        context.showCommandLine("");
      }
    },
    description: "Enter command line mode",
  },

  // Search commands
  {
    key: "/",
    mode: "normal",
    execute: context => {
      if (context.showCommandLine) {
        context.showCommandLine("/");
      }
    },
    description: "Search forward",
  },
  {
    key: "?",
    mode: "normal",
    execute: context => {
      if (context.showCommandLine) {
        context.showCommandLine("?");
      }
    },
    description: "Search backward",
  },

  // Escape commands
  {
    key: "Escape",
    mode: ["insert", "visual", "visual-line", "command"],
    execute: context => {
      context.setState({ mode: "normal", visualStart: undefined });
      if ("selectionStart" in context.textarea && "selectionEnd" in context.textarea) {
        if (context.textarea.selectionStart !== context.textarea.selectionEnd) {
          if ("setSelectionRange" in context.textarea) {
            context.textarea.setSelectionRange(context.cursorPosition, context.cursorPosition);
          }
        }
      }
    },
    description: "Return to normal mode",
  },

  // Visual mode operations
  {
    key: "d",
    mode: ["visual", "visual-line"],
    execute: context => {
      let start = 0;
      let end = 0;
      if ("selectionStart" in context.textarea && "selectionEnd" in context.textarea) {
        start = Math.min(context.textarea.selectionStart, context.textarea.selectionEnd);
        end = Math.max(context.textarea.selectionStart, context.textarea.selectionEnd);
      }
      const deletedText = context.content.slice(start, end);
      const newContent = context.content.slice(0, start) + context.content.slice(end);
      context.updateContent(newContent);
      context.setState({ register: deletedText, mode: "normal", visualStart: undefined });
      context.setCursorPosition(start);
    },
    description: "Delete selection",
  },
  {
    key: "y",
    mode: ["visual", "visual-line"],
    execute: context => {
      let start = 0;
      let end = 0;
      if ("selectionStart" in context.textarea && "selectionEnd" in context.textarea) {
        start = Math.min(context.textarea.selectionStart, context.textarea.selectionEnd);
        end = Math.max(context.textarea.selectionStart, context.textarea.selectionEnd);
      }
      const yankedText = context.content.slice(start, end);
      context.setState({ register: yankedText, mode: "normal", visualStart: undefined });
      context.setCursorPosition(start);
    },
    description: "Yank selection",
  },
  {
    key: "c",
    mode: ["visual", "visual-line"],
    execute: context => {
      let start = 0;
      let end = 0;
      if ("selectionStart" in context.textarea && "selectionEnd" in context.textarea) {
        start = Math.min(context.textarea.selectionStart, context.textarea.selectionEnd);
        end = Math.max(context.textarea.selectionStart, context.textarea.selectionEnd);
      }
      const deletedText = context.content.slice(start, end);
      const newContent = context.content.slice(0, start) + context.content.slice(end);
      context.updateContent(newContent);
      context.setState({ register: deletedText, mode: "insert", visualStart: undefined });
      context.setCursorPosition(start);
    },
    description: "Change selection",
  },
];
