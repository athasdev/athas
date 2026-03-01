import { Command } from "lucide-react";
import React, { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useAIChatStore } from "@/features/ai/store/store";
import type { SlashCommand } from "@/features/ai/types/acp";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { cn } from "@/utils/cn";

interface SlashCommandDropdownProps {
  onSelect: (command: SlashCommand) => void;
}

export const SlashCommandDropdown = React.memo(function SlashCommandDropdown({
  onSelect,
}: SlashCommandDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null);

  const slashCommandState = useAIChatStore((state) => state.slashCommandState);
  const hideSlashCommands = useAIChatStore((state) => state.hideSlashCommands);
  const availableSlashCommands = useAIChatStore((state) => state.availableSlashCommands);
  const getFilteredSlashCommands = useAIChatStore((state) => state.getFilteredSlashCommands);

  const { position, selectedIndex } = slashCommandState;
  const filteredCommands = getFilteredSlashCommands();

  // Scroll selected item into view
  useEffect(() => {
    const itemsContainer = dropdownRef.current?.querySelector(".items-container");
    const selectedItem = itemsContainer?.children[selectedIndex] as HTMLElement;
    if (selectedItem) {
      selectedItem.scrollIntoView({
        block: "nearest",
        inline: "nearest",
      });
    }
  }, [selectedIndex]);

  // Adjust position
  const adjustedPosition = useMemo(() => {
    const dropdownWidth = Math.min(360, window.innerWidth - 16);
    const dropdownHeight = Math.min(
      filteredCommands.length * 40 + 16,
      EDITOR_CONSTANTS.BREADCRUMB_DROPDOWN_MAX_HEIGHT,
    );
    const padding = 8;

    let { top, left } = position;

    if (top < padding) {
      top = 100;
      left = Math.max(padding, left);
    }

    if (left + dropdownWidth > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - dropdownWidth - padding);
    }
    if (left < padding) {
      left = padding;
    }

    // Prefer below input; if there isn't enough room, open above it.
    if (top + dropdownHeight > window.innerHeight - padding) {
      top = Math.max(padding, top - dropdownHeight - 12);
    }
    if (top < padding) {
      top = padding;
    }

    return {
      top: Math.max(padding, top),
      left: Math.max(padding, left),
      width: dropdownWidth,
    };
  }, [position.top, position.left, filteredCommands.length]);

  // Handle outside clicks
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        hideSlashCommands();
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        hideSlashCommands();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [hideSlashCommands]);

  return createPortal(
    <div
      ref={dropdownRef}
      className="scrollbar-hidden fixed select-none overflow-y-auto rounded-md border border-border bg-secondary-bg shadow-lg"
      style={{
        zIndex: 10040,
        maxHeight: `${EDITOR_CONSTANTS.BREADCRUMB_DROPDOWN_MAX_HEIGHT}px`,
        width: `${adjustedPosition.width}px`,
        left: `${adjustedPosition.left}px`,
        top: `${adjustedPosition.top}px`,
      }}
      role="listbox"
      aria-label="Slash command suggestions"
    >
      {filteredCommands.length > 0 ? (
        <div className="items-container py-1" role="listbox" aria-label="Command list">
          {filteredCommands.map((command, index) => (
            <button
              key={command.name}
              onClick={() => onSelect(command)}
              className={cn(
                "ui-font flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors",
                "focus:outline-none focus:ring-1 focus:ring-accent/50",
                index === selectedIndex ? "bg-selected text-text" : "text-text hover:bg-hover",
              )}
              role="option"
              aria-selected={index === selectedIndex}
              tabIndex={index === selectedIndex ? 0 : -1}
            >
              <Command size={12} className="mt-0.5 shrink-0 text-text-lighter" />
              <div className="min-w-0 flex-1">
                <div className="font-medium text-text">/{command.name}</div>
                <div className="truncate text-[10px] text-text-lighter">{command.description}</div>
                {command.input?.hint && (
                  <div className="mt-0.5 truncate text-[10px] text-text-lighter opacity-60">
                    {command.input.hint}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="px-3 py-2.5 text-text-lighter text-xs">
          {availableSlashCommands.length > 0 ? (
            <>
              <div className="font-medium text-text">No matching slash commands</div>
              <div className="mt-0.5 text-[10px] opacity-75">Try a different search after `/`.</div>
            </>
          ) : (
            <>
              <div className="font-medium text-text">No slash commands available yet</div>
              <div className="mt-0.5 text-[10px] opacity-75">
                Start an ACP session to load commands for this agent.
              </div>
            </>
          )}
        </div>
      )}
    </div>,
    document.body,
  );
});
