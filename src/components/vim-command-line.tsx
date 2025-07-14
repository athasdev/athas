import { Terminal, X } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";

export interface VimCommand {
  command: string;
  description: string;
  category: string;
  aliases?: string[];
}

interface VimCommandLineProps {
  isVisible: boolean;
  onClose: () => void;
  onExecuteCommand: (command: string) => void;
  initialCommand?: string;
}

export interface VimCommandLineRef {
  focus: () => void;
  setCommand: (command: string) => void;
}

// Vim ex commands
const vimCommands: VimCommand[] = [
  // File operations
  {
    command: "w",
    description: "Write (save) the current file",
    category: "File",
    aliases: ["write"],
  },
  {
    command: "w!",
    description: "Force write (save) the current file",
    category: "File",
  },
  {
    command: "q",
    description: "Quit the current buffer",
    category: "File",
    aliases: ["quit"],
  },
  {
    command: "q!",
    description: "Force quit without saving",
    category: "File",
  },
  {
    command: "wq",
    description: "Write and quit",
    category: "File",
  },
  {
    command: "x",
    description: "Write (if changed) and quit",
    category: "File",
  },
  {
    command: "wa",
    description: "Write all modified buffers",
    category: "File",
  },
  {
    command: "qa",
    description: "Quit all buffers",
    category: "File",
  },
  {
    command: "wqa",
    description: "Write all and quit all",
    category: "File",
  },

  // Search and replace
  {
    command: "/pattern",
    description: "Search forward for pattern",
    category: "Search",
  },
  {
    command: "?pattern",
    description: "Search backward for pattern",
    category: "Search",
  },
  {
    command: "s/old/new/",
    description: "Substitute first occurrence in line",
    category: "Search",
  },
  {
    command: "s/old/new/g",
    description: "Substitute all occurrences in line",
    category: "Search",
  },
  {
    command: "%s/old/new/g",
    description: "Substitute all occurrences in file",
    category: "Search",
  },
  {
    command: "%s/old/new/gc",
    description: "Substitute all with confirmation",
    category: "Search",
  },

  // Navigation
  {
    command: "123",
    description: "Go to line 123",
    category: "Navigation",
  },
  {
    command: "$",
    description: "Go to last line",
    category: "Navigation",
  },
  {
    command: "0",
    description: "Go to first line",
    category: "Navigation",
  },

  // Editing
  {
    command: "d",
    description: "Delete current line",
    category: "Edit",
  },
  {
    command: "1,5d",
    description: "Delete lines 1 to 5",
    category: "Edit",
  },
  {
    command: "y",
    description: "Yank (copy) current line",
    category: "Edit",
  },
  {
    command: "p",
    description: "Put (paste) after current line",
    category: "Edit",
  },

  // Settings
  {
    command: "set number",
    description: "Show line numbers",
    category: "Settings",
    aliases: ["set nu"],
  },
  {
    command: "set nonumber",
    description: "Hide line numbers",
    category: "Settings",
    aliases: ["set nonu"],
  },
  {
    command: "set wrap",
    description: "Enable line wrapping",
    category: "Settings",
  },
  {
    command: "set nowrap",
    description: "Disable line wrapping",
    category: "Settings",
  },
  {
    command: "set tabstop=4",
    description: "Set tab width to 4 spaces",
    category: "Settings",
  },

  // Help
  {
    command: "help",
    description: "Show help documentation",
    category: "Help",
    aliases: ["h"],
  },
  {
    command: "help motion",
    description: "Help on motion commands",
    category: "Help",
  },
  {
    command: "help editing",
    description: "Help on editing commands",
    category: "Help",
  },
];

const VimCommandLine = forwardRef<VimCommandLineRef, VimCommandLineProps>(
  ({ isVisible, onClose, onExecuteCommand, initialCommand = "" }, ref) => {
    const [command, setCommand] = useState(initialCommand);
    const [filteredCommands, setFilteredCommands] = useState<VimCommand[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
    const suggestionsRef = useRef<HTMLDivElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => {
        if (inputRef.current) {
          inputRef.current.focus();
        }
      },
      setCommand: (cmd: string) => {
        setCommand(cmd);
      },
    }));

    // Filter commands based on input
    useEffect(() => {
      if (command.trim()) {
        const cleanCommand = command.startsWith(":") ? command.slice(1) : command;
        const filtered = vimCommands.filter(cmd => {
          const mainMatch = cmd.command.toLowerCase().includes(cleanCommand.toLowerCase());
          const aliasMatch = cmd.aliases?.some(alias =>
            alias.toLowerCase().includes(cleanCommand.toLowerCase()),
          );
          const descMatch = cmd.description.toLowerCase().includes(cleanCommand.toLowerCase());
          return mainMatch || aliasMatch || descMatch;
        });
        setFilteredCommands(filtered);
        setShowSuggestions(filtered.length > 0 && cleanCommand.length > 0);
        setSelectedIndex(0);
      } else {
        setFilteredCommands([]);
        setShowSuggestions(false);
      }
    }, [command]);

    // Handle keyboard navigation
    useEffect(() => {
      if (!isVisible) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        if (showSuggestions && filteredCommands.length > 0) {
          switch (e.key) {
            case "ArrowDown":
              e.preventDefault();
              setSelectedIndex(prev => (prev < filteredCommands.length - 1 ? prev + 1 : prev));
              break;
            case "ArrowUp":
              e.preventDefault();
              setSelectedIndex(prev => (prev > 0 ? prev - 1 : prev));
              break;
            case "Tab":
              e.preventDefault();
              if (filteredCommands[selectedIndex]) {
                const selectedCmd = filteredCommands[selectedIndex];
                setCommand(`:${selectedCmd.command}`);
                setShowSuggestions(false);
              }
              break;
          }
        }

        switch (e.key) {
          case "Enter":
            e.preventDefault();
            if (command.trim()) {
              const cleanCommand = command.startsWith(":") ? command.slice(1) : command;
              onExecuteCommand(cleanCommand);
              setCommand("");
              onClose();
            }
            break;
          case "Escape":
            e.preventDefault();
            setCommand("");
            onClose();
            break;
        }
      };

      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }, [
      isVisible,
      command,
      showSuggestions,
      filteredCommands,
      selectedIndex,
      onExecuteCommand,
      onClose,
    ]);

    // Reset state when visibility changes
    useEffect(() => {
      if (isVisible) {
        setCommand(initialCommand.startsWith(":") ? initialCommand : `:${initialCommand}`);
        setSelectedIndex(0);
        setShowSuggestions(false);
        requestAnimationFrame(() => {
          if (inputRef.current) {
            inputRef.current.focus();
            inputRef.current.setSelectionRange(
              inputRef.current.value.length,
              inputRef.current.value.length,
            );
          }
        });
      }
    }, [isVisible, initialCommand]);

    // Scroll selected item into view
    useEffect(() => {
      if (suggestionsRef.current && filteredCommands.length > 0) {
        const selectedElement = suggestionsRef.current.children[selectedIndex] as HTMLElement;
        if (selectedElement) {
          selectedElement.scrollIntoView({
            block: "nearest",
            behavior: "smooth",
          });
        }
      }
    }, [selectedIndex, filteredCommands.length]);

    if (!isVisible) return null;

    return (
      <>
        {/* Backdrop */}
        <div className="fixed inset-0 z-[9998] bg-black/20" onClick={onClose} />

        {/* Command line */}
        <div className="fixed right-0 bottom-0 left-0 z-[9999] border-border border-t bg-primary-bg">
          <div className="flex items-center gap-2 px-4 py-2">
            <Terminal size={16} className="text-text-lighter" />
            <input
              ref={inputRef}
              type="text"
              value={command}
              onChange={e => setCommand(e.target.value)}
              placeholder=":command"
              className="flex-1 border-none bg-transparent text-sm text-text placeholder-text-lighter outline-none focus:border-none focus:shadow-none focus:outline-none focus:ring-0"
              style={{
                outline: "none !important",
                boxShadow: "none !important",
                border: "none !important",
                WebkitAppearance: "none",
              }}
            />
            <button onClick={onClose} className="rounded p-1 transition-colors hover:bg-hover">
              <X size={14} className="text-text-lighter" />
            </button>
          </div>

          {/* Command suggestions */}
          {showSuggestions && filteredCommands.length > 0 && (
            <div
              ref={suggestionsRef}
              className="max-h-60 overflow-y-auto border-border border-t bg-secondary-bg"
            >
              <div className="p-2 font-medium text-text-lighter text-xs">
                Vim Commands ({filteredCommands.length})
              </div>
              {filteredCommands.map((cmd, index) => (
                <div
                  key={`${cmd.command}-${index}`}
                  onClick={() => {
                    setCommand(`:${cmd.command}`);
                    setShowSuggestions(false);
                    if (inputRef.current) {
                      inputRef.current.focus();
                    }
                  }}
                  className={`flex cursor-pointer items-center justify-between px-4 py-2 transition-colors ${
                    index === selectedIndex ? "bg-selected text-text" : "text-text hover:bg-hover"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <code className="rounded bg-primary-bg px-1 py-0.5 font-mono text-xs">
                        :{cmd.command}
                      </code>
                      <span className="text-text-lighter text-xs">{cmd.category}</span>
                    </div>
                    <div className="mt-1 text-text-lighter text-xs">{cmd.description}</div>
                    {cmd.aliases && cmd.aliases.length > 0 && (
                      <div className="mt-1 text-text-lighter text-xs">
                        Aliases: {cmd.aliases.map(alias => `:${alias}`).join(", ")}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Help text */}
          <div className="border-border border-t bg-secondary-bg px-4 py-1 text-text-lighter text-xs">
            <span className="mr-4">↑↓ Navigate</span>
            <span className="mr-4">Tab Complete</span>
            <span className="mr-4">Enter Execute</span>
            <span>Esc Cancel</span>
          </div>
        </div>
      </>
    );
  },
);

VimCommandLine.displayName = "VimCommandLine";

export default VimCommandLine;
