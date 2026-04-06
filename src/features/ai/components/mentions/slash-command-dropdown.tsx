import { motion } from "framer-motion";
import { Command } from "lucide-react";
import React, { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useAIChatStore } from "@/features/ai/store/store";
import type { SlashCommand } from "@/features/ai/types/acp";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { dropdownItemClassName } from "@/ui/dropdown";
import { cn } from "@/utils/cn";

interface SlashCommandDropdownProps {
  onSelect: (command: SlashCommand) => void;
}

const ATTACHED_DROPDOWN_GAP = -1;

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
    const dropdownWidth = Math.min(Math.max(position.width, 260), window.innerWidth - 16);
    const dropdownHeight = Math.min(
      filteredCommands.length * 40 + 16,
      EDITOR_CONSTANTS.BREADCRUMB_DROPDOWN_MAX_HEIGHT,
    );
    const padding = 8;

    let { left } = position;

    if (left + dropdownWidth > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - dropdownWidth - padding);
    }
    if (left < padding) {
      left = padding;
    }

    const attachedAboveTop = position.top - dropdownHeight - ATTACHED_DROPDOWN_GAP;
    const attachedBelowTop = position.bottom + ATTACHED_DROPDOWN_GAP;
    const top =
      attachedAboveTop >= padding
        ? attachedAboveTop
        : Math.min(attachedBelowTop, window.innerHeight - dropdownHeight - padding);

    return {
      top: Math.max(padding, top),
      left: Math.max(padding, left),
      width: dropdownWidth,
    };
  }, [position.bottom, position.left, position.top, position.width, filteredCommands.length]);

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
    <motion.div
      ref={dropdownRef}
      initial={{ opacity: 0, scale: 0.95, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95, y: -4 }}
      transition={{ duration: 0.15, ease: "easeOut" }}
      className="scrollbar-hidden fixed select-none overflow-y-auto rounded-t-2xl rounded-b-xl border border-border/70 bg-primary-bg/98 p-1.5 shadow-[0_14px_32px_-26px_rgba(0,0,0,0.5)] backdrop-blur-sm"
      style={{
        zIndex: 10040,
        maxHeight: `${EDITOR_CONSTANTS.BREADCRUMB_DROPDOWN_MAX_HEIGHT}px`,
        width: `${adjustedPosition.width}px`,
        left: `${adjustedPosition.left}px`,
        top: `${adjustedPosition.top}px`,
        transformOrigin: "top left",
      }}
      role="listbox"
      aria-label="Slash command suggestions"
    >
      {filteredCommands.length > 0 ? (
        <div className="items-container space-y-1" role="listbox" aria-label="Command list">
          {filteredCommands.map((command, index) => (
            <button
              key={command.name}
              type="button"
              onClick={() => onSelect(command)}
              className={cn(
                dropdownItemClassName(),
                "w-full items-start rounded-xl px-2.5 py-2 text-left",
                "focus:outline-none focus:ring-1 focus:ring-border-strong/35",
                index === selectedIndex ? "bg-selected text-text" : "text-text hover:bg-hover",
              )}
              role="option"
              aria-selected={index === selectedIndex}
              tabIndex={index === selectedIndex ? 0 : -1}
            >
              <Command size={12} className="mt-0.5 shrink-0 text-text-lighter" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-[11px] text-text">/{command.name}</div>
                <div className="truncate pt-0.5 text-[10px] text-text-lighter">
                  {command.description}
                </div>
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
        <div className="px-2.5 py-2 text-text-lighter text-xs">
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
    </motion.div>,
    document.body,
  );
});
