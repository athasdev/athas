import React, { useCallback, useEffect, useRef } from "react";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { SlashCommand } from "@/features/ai/types/acp.types";
import { useUIState } from "@/features/window/stores/ui-state.store";
import Command, {
  CommandEmpty,
  CommandHeader,
  CommandInput,
  CommandItem,
  CommandItemBadge,
  CommandItemContent,
  CommandItemDescription,
  CommandItemIcon,
  CommandItemMeta,
  CommandItemTitle,
  CommandList,
} from "@/ui/command";

interface SlashCommandDropdownProps {
  onSelect: (command: SlashCommand) => void;
  onClose?: () => void;
}

export const SlashCommandDropdown = React.memo(function SlashCommandDropdown({
  onSelect,
  onClose,
}: SlashCommandDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const slashCommandState = useAIChatStore((state) => state.slashCommandState);
  const hideSlashCommands = useAIChatStore((state) => state.hideSlashCommands);
  const updateSlashCommandSearch = useAIChatStore((state) => state.updateSlashCommandSearch);
  const selectNextSlashCommand = useAIChatStore((state) => state.selectNextSlashCommand);
  const selectPreviousSlashCommand = useAIChatStore((state) => state.selectPreviousSlashCommand);
  const setSlashCommandSelectedIndex = useAIChatStore(
    (state) => state.setSlashCommandSelectedIndex,
  );
  const availableSlashCommands = useAIChatStore((state) => state.availableSlashCommands);
  const getFilteredSlashCommands = useAIChatStore((state) => state.getFilteredSlashCommands);
  const setIsQuickOpenVisible = useUIState((state) => state.setIsQuickOpenVisible);
  const setIsCommandPaletteVisible = useUIState((state) => state.setIsCommandPaletteVisible);

  const { search, selectedIndex } = slashCommandState;
  const filteredCommands = getFilteredSlashCommands();

  const closeSlashCommands = useCallback(() => {
    hideSlashCommands();
    onClose?.();
  }, [hideSlashCommands, onClose]);

  useEffect(() => {
    const selectedItem = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    if (selectedItem) {
      selectedItem.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [selectedIndex]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isCommandModifier = event.metaKey || event.ctrlKey;
      if (isCommandModifier && event.key.toLowerCase() === "p") {
        event.preventDefault();
        event.stopPropagation();
        closeSlashCommands();
        if (event.shiftKey) {
          setIsCommandPaletteVisible(true);
        } else {
          setIsQuickOpenVisible(true);
        }
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        closeSlashCommands();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeSlashCommands, setIsCommandPaletteVisible, setIsQuickOpenVisible]);

  const handleSearchChange = (value: string) => {
    const nextSearch = value.startsWith("/") ? value.slice(1) : value;
    updateSlashCommandSearch(nextSearch.replace(/\s+/g, ""));
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    const isCommandModifier = event.metaKey || event.ctrlKey;
    if (isCommandModifier && event.key.toLowerCase() === "p") {
      event.preventDefault();
      event.stopPropagation();
      closeSlashCommands();
      if (event.shiftKey) {
        setIsCommandPaletteVisible(true);
      } else {
        setIsQuickOpenVisible(true);
      }
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      selectNextSlashCommand();
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      selectPreviousSlashCommand();
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const command = filteredCommands[selectedIndex];
      if (command) {
        onSelect(command);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeSlashCommands();
    }
  };

  return (
    <Command isVisible onClose={closeSlashCommands} title="Slash command suggestions">
      <CommandHeader onClose={closeSlashCommands}>
        <CommandInput
          value={`/${search}`}
          onChange={handleSearchChange}
          onKeyDown={handleKeyDown}
          placeholder="Search slash commands"
        />
      </CommandHeader>

      {filteredCommands.length > 0 ? (
        <CommandList ref={listRef} role="listbox" aria-label="Slash command suggestions">
          {filteredCommands.map((command, index) => (
            <CommandItem
              key={command.name}
              type="button"
              data-item-index={index}
              isSelected={index === selectedIndex}
              onClick={() => onSelect(command)}
              onMouseEnter={() => setSlashCommandSelectedIndex(index)}
              className="px-3 py-2"
              role="option"
              aria-selected={index === selectedIndex}
              tabIndex={index === selectedIndex ? 0 : -1}
            >
              <CommandItemIcon>/</CommandItemIcon>
              <CommandItemContent>
                <CommandItemTitle className="block font-medium">{command.name}</CommandItemTitle>
                <CommandItemDescription>{command.description}</CommandItemDescription>
              </CommandItemContent>
              {command.input?.hint ? (
                <CommandItemBadge>{command.input.hint}</CommandItemBadge>
              ) : index === selectedIndex ? (
                <CommandItemMeta>Enter</CommandItemMeta>
              ) : null}
            </CommandItem>
          ))}
        </CommandList>
      ) : (
        <CommandEmpty>
          {availableSlashCommands.length > 0
            ? "No matching slash commands"
            : "No slash commands available yet"}
        </CommandEmpty>
      )}
    </Command>
  );
});
