import type { VimContext } from "./vim-types";

export interface VimExCommand {
  command: string | RegExp;
  execute: (context: VimContext, args: string[], fullCommand: string) => void;
  description: string;
}

// Helper functions
const getCurrentLineNumber = (content: string, cursorPos: number): number => {
  return content.substring(0, cursorPos).split("\n").length;
};

const getLineRange = (
  content: string,
  start: number,
  end?: number,
): { startPos: number; endPos: number } => {
  const lines = content.split("\n");
  const startLine = Math.max(1, Math.min(start, lines.length)) - 1;
  const endLine = end ? Math.max(1, Math.min(end, lines.length)) - 1 : startLine;

  let startPos = 0;
  let endPos = content.length;

  // Calculate start position
  for (let i = 0; i < startLine; i++) {
    startPos += lines[i].length + 1; // +1 for newline
  }

  // Calculate end position
  if (endLine < lines.length - 1) {
    endPos = startPos;
    for (let i = startLine; i <= endLine; i++) {
      endPos += lines[i].length + 1;
    }
    endPos -= 1; // Remove last newline
  }

  return { startPos, endPos };
};

export const exCommands: VimExCommand[] = [
  // Write (save) commands
  {
    command: "w",
    execute: _context => {
      // Trigger save - this would need to be connected to the app's save functionality
      console.log("Save file");
    },
    description: "Write (save) file",
  },
  {
    command: "w!",
    execute: _context => {
      console.log("Force save file");
    },
    description: "Force write file",
  },
  {
    command: "wa",
    execute: _context => {
      console.log("Save all files");
    },
    description: "Write all files",
  },

  // Quit commands
  {
    command: "q",
    execute: _context => {
      console.log("Quit buffer");
    },
    description: "Quit current buffer",
  },
  {
    command: "q!",
    execute: _context => {
      console.log("Force quit buffer");
    },
    description: "Force quit without saving",
  },
  {
    command: "qa",
    execute: _context => {
      console.log("Quit all buffers");
    },
    description: "Quit all buffers",
  },

  // Combined commands
  {
    command: "wq",
    execute: _context => {
      console.log("Save and quit");
    },
    description: "Write and quit",
  },
  {
    command: "x",
    execute: _context => {
      console.log("Save (if modified) and quit");
    },
    description: "Save if modified and quit",
  },
  {
    command: "wqa",
    execute: _context => {
      console.log("Save all and quit all");
    },
    description: "Write all and quit all",
  },

  // Line navigation
  {
    command: /^(\d+)$/,
    execute: (context, _args, fullCommand) => {
      const lineNumber = parseInt(fullCommand);
      if (!Number.isNaN(lineNumber)) {
        const lines = context.content.split("\n");
        const targetLine = Math.max(1, Math.min(lineNumber, lines.length)) - 1;

        let position = 0;
        for (let i = 0; i < targetLine; i++) {
          position += lines[i].length + 1;
        }

        context.setCursorPosition(position);
      }
    },
    description: "Go to line number",
  },

  // Search and replace
  {
    command: /^s\/(.+?)\/(.*)\/([gi]*)$/,
    execute: (context, _args, fullCommand) => {
      const match = fullCommand.match(/^s\/(.+?)\/(.*)\/([gi]*)$/);
      if (match) {
        const [, searchPattern, replacement, flags] = match;
        const isGlobal = flags.includes("g");
        const isCaseInsensitive = flags.includes("i");

        const currentLine = getCurrentLineNumber(context.content, context.cursorPosition);
        const { startPos, endPos } = getLineRange(context.content, currentLine);

        const lineContent = context.content.substring(startPos, endPos);
        const regex = new RegExp(searchPattern, isCaseInsensitive ? "i" : "");

        let newLineContent: string;
        if (isGlobal) {
          const globalRegex = new RegExp(searchPattern, `g${isCaseInsensitive ? "i" : ""}`);
          newLineContent = lineContent.replace(globalRegex, replacement);
        } else {
          newLineContent = lineContent.replace(regex, replacement);
        }

        const newContent =
          context.content.substring(0, startPos) +
          newLineContent +
          context.content.substring(endPos);
        context.updateContent(newContent);
      }
    },
    description: "Substitute in current line",
  },

  // Global search and replace
  {
    command: /^%s\/(.+?)\/(.*)\/([gi]*)$/,
    execute: (context, _args, fullCommand) => {
      const match = fullCommand.match(/^%s\/(.+?)\/(.*)\/([gi]*)$/);
      if (match) {
        const [, searchPattern, replacement, flags] = match;
        const isGlobal = flags.includes("g");
        const isCaseInsensitive = flags.includes("i");

        const regexFlags = `${isGlobal ? "g" : ""}${isCaseInsensitive ? "i" : ""}`;
        const regex = new RegExp(searchPattern, regexFlags || undefined);

        const newContent = context.content.replace(regex, replacement);
        context.updateContent(newContent);
      }
    },
    description: "Substitute in entire file",
  },

  // Delete lines
  {
    command: /^(\d+)?d$/,
    execute: (context, _args, fullCommand) => {
      const match = fullCommand.match(/^(\d+)?d$/);
      const lineNumber = match?.[1]
        ? parseInt(match[1])
        : getCurrentLineNumber(context.content, context.cursorPosition);

      const { startPos, endPos } = getLineRange(context.content, lineNumber);
      const lines = context.content.split("\n");

      // Include the newline character if not the last line
      const deleteEnd = lineNumber < lines.length ? endPos + 1 : endPos;

      const newContent =
        context.content.substring(0, startPos) + context.content.substring(deleteEnd);
      context.updateContent(newContent);
      context.setCursorPosition(Math.min(startPos, newContent.length));
    },
    description: "Delete line(s)",
  },

  // Delete range
  {
    command: /^(\d+),(\d+)d$/,
    execute: (context, _args, fullCommand) => {
      const match = fullCommand.match(/^(\d+),(\d+)d$/);
      if (match) {
        const startLine = parseInt(match[1]);
        const endLine = parseInt(match[2]);

        const { startPos } = getLineRange(context.content, startLine);
        const { endPos } = getLineRange(context.content, endLine);
        const lines = context.content.split("\n");

        // Include the newline character if not the last line
        const deleteEnd = endLine < lines.length ? endPos + 1 : endPos;

        const newContent =
          context.content.substring(0, startPos) + context.content.substring(deleteEnd);
        context.updateContent(newContent);
        context.setCursorPosition(Math.min(startPos, newContent.length));
      }
    },
    description: "Delete line range",
  },

  // Yank (copy) lines
  {
    command: /^(\d+)?y$/,
    execute: (context, _args, fullCommand) => {
      const match = fullCommand.match(/^(\d+)?y$/);
      const lineNumber = match?.[1]
        ? parseInt(match[1])
        : getCurrentLineNumber(context.content, context.cursorPosition);

      const { startPos, endPos } = getLineRange(context.content, lineNumber);
      const yankedText = context.content.substring(startPos, endPos + 1);
      context.setState({ register: yankedText });
    },
    description: "Yank (copy) line(s)",
  },

  // Put (paste) after current line
  {
    command: "p",
    execute: context => {
      if (context.state.register) {
        const currentLine = getCurrentLineNumber(context.content, context.cursorPosition);
        const { endPos } = getLineRange(context.content, currentLine);

        const newContent = `${context.content.substring(0, endPos)}\n${context.state.register}${context.content.substring(endPos)}`;
        context.updateContent(newContent);
        context.setCursorPosition(endPos + 1);
      }
    },
    description: "Put (paste) after current line",
  },

  // Settings
  {
    command: "set number",
    execute: _context => {
      console.log("Enable line numbers");
      // This would need to be connected to the editor settings
    },
    description: "Show line numbers",
  },
  {
    command: "set nonumber",
    execute: _context => {
      console.log("Disable line numbers");
    },
    description: "Hide line numbers",
  },
  {
    command: "set wrap",
    execute: _context => {
      console.log("Enable line wrapping");
    },
    description: "Enable line wrapping",
  },
  {
    command: "set nowrap",
    execute: _context => {
      console.log("Disable line wrapping");
    },
    description: "Disable line wrapping",
  },
  {
    command: /^set tabstop=(\d+)$/,
    execute: (_context, _args, fullCommand) => {
      const match = fullCommand.match(/^set tabstop=(\d+)$/);
      if (match) {
        const tabSize = parseInt(match[1]);
        console.log(`Set tab size to ${tabSize}`);
      }
    },
    description: "Set tab width",
  },

  // Help
  {
    command: "help",
    execute: _context => {
      console.log("Show help");
    },
    description: "Show help",
  },
  {
    command: /^h(elp)?\s+(.+)$/,
    execute: (_context, _args, fullCommand) => {
      const match = fullCommand.match(/^h(elp)?\s+(.+)$/);
      if (match) {
        const topic = match[2];
        console.log(`Show help for: ${topic}`);
      }
    },
    description: "Show help for topic",
  },
];

export const executeExCommand = (command: string, context: VimContext): boolean => {
  const trimmedCommand = command.trim();

  for (const exCmd of exCommands) {
    if (typeof exCmd.command === "string") {
      if (trimmedCommand === exCmd.command) {
        exCmd.execute(context, [], trimmedCommand);
        return true;
      }
    } else {
      // RegExp command
      const match = trimmedCommand.match(exCmd.command);
      if (match) {
        exCmd.execute(context, match.slice(1), trimmedCommand);
        return true;
      }
    }
  }

  console.warn(`Unknown command: ${trimmedCommand}`);
  return false;
};
