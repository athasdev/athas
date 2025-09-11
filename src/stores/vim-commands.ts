import { useBufferStore } from "./buffer-store";
import { useUIState } from "./ui-state-store";

export interface VimCommand {
  name: string;
  aliases?: string[];
  description: string;
  execute: (args?: string[]) => Promise<void> | void;
}

// Helper to get current buffer path for file operations
const _getCurrentBufferPath = (): string | null => {
  const { buffers, activeBufferId } = useBufferStore.getState();
  const activeBuffer = buffers.find((b) => b.id === activeBufferId);
  return activeBuffer?.path || null;
};

// Save current file
const writeCommand: VimCommand = {
  name: "write",
  aliases: ["w"],
  description: "Save the current file",
  execute: async () => {
    // Trigger save event that existing save handler will catch
    window.dispatchEvent(new CustomEvent("vim-save"));
  },
};

// Save and quit
const writeQuitCommand: VimCommand = {
  name: "wq",
  aliases: ["x"],
  description: "Save and close the current file",
  execute: async () => {
    // Save first, then close
    window.dispatchEvent(new CustomEvent("vim-save"));

    // Wait a moment for save to complete, then close buffer
    setTimeout(() => {
      const { activeBufferId, actions } = useBufferStore.getState();
      if (activeBufferId) {
        actions.closeBuffer(activeBufferId);
      }
    }, 100);
  },
};

// Quit without saving
const quitCommand: VimCommand = {
  name: "quit",
  aliases: ["q"],
  description: "Close the current file",
  execute: async () => {
    const { activeBufferId, actions } = useBufferStore.getState();
    if (activeBufferId) {
      actions.closeBuffer(activeBufferId);
    }
  },
};

// Force quit without saving
const forceQuitCommand: VimCommand = {
  name: "quit!",
  aliases: ["q!"],
  description: "Force close the current file without saving",
  execute: async () => {
    const { activeBufferId, actions } = useBufferStore.getState();
    if (activeBufferId) {
      // Force close without save prompt
      actions.closeBuffer(activeBufferId);
    }
  },
};

// Open command palette
const commandCommand: VimCommand = {
  name: "command",
  aliases: ["cmd"],
  description: "Open command palette",
  execute: async () => {
    const { setIsCommandPaletteVisible } = useUIState.getState();
    setIsCommandPaletteVisible(true);
  },
};

// Open file browser
const exploreCommand: VimCommand = {
  name: "explore",
  aliases: ["e", "Ex"],
  description: "Open file browser",
  execute: async () => {
    const { setIsCommandBarVisible } = useUIState.getState();
    setIsCommandBarVisible(true);
  },
};

// Go to line number
const gotoCommand: VimCommand = {
  name: "goto",
  aliases: [],
  description: "Go to line number",
  execute: async (args?: string[]) => {
    if (args && args.length > 0) {
      const lineNumber = parseInt(args[0]);
      if (!Number.isNaN(lineNumber)) {
        // Dispatch go to line event
        window.dispatchEvent(
          new CustomEvent("vim-goto-line", {
            detail: { line: lineNumber },
          }),
        );
      }
    }
  },
};

// Toggle sidebar
const sidebarCommand: VimCommand = {
  name: "sidebar",
  aliases: ["sb"],
  description: "Toggle sidebar",
  execute: async () => {
    const { setIsSidebarVisible, isSidebarVisible } = useUIState.getState();
    setIsSidebarVisible(!isSidebarVisible);
  },
};

// Toggle terminal
const terminalCommand: VimCommand = {
  name: "terminal",
  aliases: ["term"],
  description: "Toggle terminal",
  execute: async () => {
    const {
      setIsBottomPaneVisible,
      setBottomPaneActiveTab,
      isBottomPaneVisible,
      bottomPaneActiveTab,
    } = useUIState.getState();

    if (isBottomPaneVisible && bottomPaneActiveTab === "terminal") {
      setIsBottomPaneVisible(false);
    } else {
      setBottomPaneActiveTab("terminal");
      setIsBottomPaneVisible(true);
    }
  },
};

// Available vim commands
export const vimCommands: VimCommand[] = [
  writeCommand,
  writeQuitCommand,
  quitCommand,
  forceQuitCommand,
  commandCommand,
  exploreCommand,
  gotoCommand,
  sidebarCommand,
  terminalCommand,
];

// Parse and execute vim command
export const parseAndExecuteVimCommand = async (commandInput: string): Promise<boolean> => {
  const trimmedInput = commandInput.trim();

  // Handle empty command
  if (!trimmedInput) {
    return false;
  }

  // Handle numeric commands (go to line)
  if (/^\d+$/.test(trimmedInput)) {
    await gotoCommand.execute([trimmedInput]);
    return true;
  }

  // Split command and arguments
  const parts = trimmedInput.split(/\s+/);
  const commandName = parts[0];
  const args = parts.slice(1);

  // Find matching command
  const command = vimCommands.find(
    (cmd) => cmd.name === commandName || cmd.aliases?.includes(commandName),
  );

  if (command) {
    try {
      await command.execute(args);
      return true;
    } catch (error) {
      console.error("Error executing vim command:", error);
      return false;
    }
  }

  // Command not found
  console.warn("Unknown vim command:", commandName);
  return false;
};

// Get command suggestions for autocomplete
export const getVimCommandSuggestions = (input: string): VimCommand[] => {
  if (!input.trim()) {
    return vimCommands.slice(0, 10); // Return first 10 commands
  }

  const lowerInput = input.toLowerCase();

  return vimCommands
    .filter(
      (cmd) =>
        cmd.name.toLowerCase().startsWith(lowerInput) ||
        cmd.aliases?.some((alias) => alias.toLowerCase().startsWith(lowerInput)),
    )
    .slice(0, 10); // Limit to 10 suggestions
};
