import React, { useCallback, useEffect, useRef, type RefObject } from "react";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { SlashCommand } from "@/features/ai/types/acp.types";
import { useUIState } from "@/features/window/stores/ui-state.store";
import {
  CommandEmpty,
  CommandItemBadge,
  CommandItemMeta,
  CommandItemRow,
  CommandList,
} from "@/ui/command";
import { ComposerAttachedPanel } from "../input/composer-attached-panel";

interface SlashCommandDropdownProps {
  anchorRef: RefObject<HTMLElement | null>;
  onSelect: (command: SlashCommand) => void;
  onClose?: () => void;
}

export const SlashCommandDropdown = React.memo(function SlashCommandDropdown({
  anchorRef,
  onSelect,
  onClose,
}: SlashCommandDropdownProps) {
  const listRef = useRef<HTMLDivElement>(null);

  const slashCommandState = useAIChatStore((state) => state.slashCommandState);
  const hideSlashCommands = useAIChatStore((state) => state.hideSlashCommands);
  const setSlashCommandSelectedIndex = useAIChatStore(
    (state) => state.setSlashCommandSelectedIndex,
  );
  const availableSlashCommands = useAIChatStore((state) => state.availableSlashCommands);
  const getFilteredSlashCommands = useAIChatStore((state) => state.getFilteredSlashCommands);
  const setIsQuickOpenVisible = useUIState((state) => state.setIsQuickOpenVisible);
  const setIsCommandPaletteVisible = useUIState((state) => state.setIsCommandPaletteVisible);

  const { selectedIndex } = slashCommandState;
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

  return (
    <ComposerAttachedPanel
      open={slashCommandState.active}
      anchorRef={anchorRef}
      onClose={closeSlashCommands}
      ariaLabel="Slash command suggestions"
      maxHeight={320}
    >
      {filteredCommands.length > 0 ? (
        <CommandList ref={listRef} role="listbox" aria-label="Slash command suggestions">
          {filteredCommands.map((command, index) => (
            <CommandItemRow
              key={command.name}
              type="button"
              data-item-index={index}
              isSelected={index === selectedIndex}
              onClick={() => onSelect(command)}
              onMouseEnter={() => setSlashCommandSelectedIndex(index)}
              role="option"
              aria-selected={index === selectedIndex}
              tabIndex={index === selectedIndex ? 0 : -1}
              icon={<span>/</span>}
              title={command.name}
              description={command.description}
              contentLayout="stacked"
              accessory={
                command.input?.hint ? (
                  <CommandItemBadge>{command.input.hint}</CommandItemBadge>
                ) : index === selectedIndex ? (
                  <CommandItemMeta>Enter</CommandItemMeta>
                ) : null
              }
            />
          ))}
        </CommandList>
      ) : (
        <CommandEmpty>
          {availableSlashCommands.length > 0
            ? "No matching slash commands"
            : "No slash commands available yet"}
        </CommandEmpty>
      )}
    </ComposerAttachedPanel>
  );
});
