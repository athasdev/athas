import { useCallback, useEffect, useRef, useState } from "react";
import {
  getVimCommandSuggestions,
  parseAndExecuteVimCommand,
  type VimCommand,
} from "@/stores/vim-commands";
import { useVimStore } from "@/stores/vim-store";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandList,
} from "../../ui/command";

const VimCommandBar = () => {
  const isCommandMode = useVimStore.use.isCommandMode();
  const commandInput = useVimStore.use.commandInput();
  const { exitCommandMode, updateCommandInput, executeCommand } = useVimStore.use.actions();

  const [selectedIndex, setSelectedIndex] = useState(0);
  const [suggestions, setSuggestions] = useState<VimCommand[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Focus input when vim command mode becomes active
  useEffect(() => {
    if (isCommandMode && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCommandMode]);

  // Update suggestions when command input changes
  useEffect(() => {
    if (commandInput) {
      setSuggestions(getVimCommandSuggestions(commandInput));
    } else {
      setSuggestions(getVimCommandSuggestions(""));
    }
    setSelectedIndex(0);
  }, [commandInput]);

  // Handle keyboard navigation
  useEffect(() => {
    if (!isCommandMode) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        exitCommandMode();
        return;
      }

      if (e.key === "Enter") {
        e.preventDefault();

        // If there are suggestions and one is selected, use that
        if (suggestions.length > 0 && selectedIndex < suggestions.length) {
          const selectedCommand = suggestions[selectedIndex];
          const commandToExecute = selectedCommand.name;
          executeCommand(commandToExecute);
          parseAndExecuteVimCommand(commandToExecute);
        } else if (commandInput.trim()) {
          // Execute the typed command
          executeCommand(commandInput);
          parseAndExecuteVimCommand(commandInput);
        }
        return;
      }

      if (e.key === "ArrowDown" && suggestions.length > 0) {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % suggestions.length);
        return;
      }

      if (e.key === "ArrowUp" && suggestions.length > 0) {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }

      if (e.key === "Tab" && suggestions.length > 0) {
        e.preventDefault();
        const selectedCommand = suggestions[selectedIndex];
        if (selectedCommand) {
          updateCommandInput(selectedCommand.name);
        }
        return;
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    isCommandMode,
    commandInput,
    suggestions,
    selectedIndex,
    exitCommandMode,
    updateCommandInput,
    executeCommand,
  ]);

  // Auto-scroll selected item into view
  useEffect(() => {
    if (!isCommandMode || !scrollContainerRef.current) return;

    const selectedElement = scrollContainerRef.current.querySelector(
      `[data-item-index="${selectedIndex}"]`,
    ) as HTMLElement;

    if (selectedElement) {
      selectedElement.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
    }
  }, [selectedIndex, isCommandMode, suggestions]);

  const handleInputChange = useCallback(
    (value: string) => {
      updateCommandInput(value);
    },
    [updateCommandInput],
  );

  const handleItemSelect = useCallback(
    (command: VimCommand) => {
      executeCommand(command.name);
      parseAndExecuteVimCommand(command.name);
    },
    [executeCommand],
  );

  if (!isCommandMode) {
    return null;
  }

  return (
    <Command isVisible={isCommandMode} className="max-h-80">
      <CommandHeader onClose={exitCommandMode}>
        <span className="font-mono text-accent text-sm">:</span>
        <CommandInput
          ref={inputRef}
          value={commandInput}
          onChange={handleInputChange}
          placeholder="Enter vim command..."
          className="font-mono"
        />
      </CommandHeader>

      <CommandList ref={scrollContainerRef}>
        {suggestions.length === 0 ? (
          <CommandEmpty>
            <div className="font-mono">
              {commandInput ? "No matching commands" : "Type a command"}
            </div>
          </CommandEmpty>
        ) : (
          <div className="p-0">
            {suggestions.map((command, index) => {
              const isSelected = index === selectedIndex;
              const displayName = command.aliases?.length
                ? `${command.name} (${command.aliases.join(", ")})`
                : command.name;

              return (
                <CommandItem
                  key={command.name}
                  data-item-index={index}
                  onClick={() => handleItemSelect(command)}
                  isSelected={isSelected}
                  className="font-mono"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs">
                      <span className="text-accent">:</span>
                      <span className="text-text">{displayName}</span>
                    </div>
                    <div className="mt-0.5 truncate text-[10px] text-text-lighter opacity-60">
                      {command.description}
                    </div>
                  </div>
                </CommandItem>
              );
            })}
          </div>
        )}
      </CommandList>
    </Command>
  );
};

export default VimCommandBar;
