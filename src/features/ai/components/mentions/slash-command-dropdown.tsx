import { motion } from "framer-motion";
import React, { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { SlashCommand } from "@/features/ai/types/acp.types";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { dropdownItemClassName } from "@/ui/dropdown";
import { cn } from "@/utils/cn";
import {
  chatComposerDropdownClassName,
  chatComposerDropdownItemClassName,
} from "../input/chat-composer-control-styles";

interface SlashCommandDropdownProps {
  onSelect: (command: SlashCommand) => void;
}

const ATTACHED_DROPDOWN_GAP = -1;
const SLASH_COMMAND_DROPDOWN_MAX_HEIGHT = 300;

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
    const activeElement = document.activeElement as HTMLElement | null;
    const activeRect =
      activeElement?.isContentEditable || activeElement?.tagName === "INPUT"
        ? activeElement.getBoundingClientRect()
        : null;
    const basePosition =
      position.bottom > 0
        ? position
        : activeRect && activeRect.width > 0 && activeRect.bottom > 0
          ? {
              top: Math.max(activeRect.top, activeRect.bottom - 24),
              bottom: activeRect.bottom,
              left: activeRect.left + 12,
              width: Math.min(320, Math.max(180, activeRect.width - 24)),
            }
          : position;
    const dropdownWidth = Math.min(Math.max(basePosition.width, 180), window.innerWidth - 16);
    const dropdownHeight = Math.min(
      filteredCommands.length * 44 + 12,
      SLASH_COMMAND_DROPDOWN_MAX_HEIGHT,
      EDITOR_CONSTANTS.BREADCRUMB_DROPDOWN_MAX_HEIGHT,
    );
    const padding = 8;

    let { left } = basePosition;

    if (left + dropdownWidth > window.innerWidth - padding) {
      left = Math.max(padding, window.innerWidth - dropdownWidth - padding);
    }
    if (left < padding) {
      left = padding;
    }

    const attachedAboveTop = basePosition.top - dropdownHeight - ATTACHED_DROPDOWN_GAP;
    const attachedBelowTop = basePosition.bottom + ATTACHED_DROPDOWN_GAP;
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
      initial={false}
      animate={{ opacity: 1 }}
      transition={{ duration: 0 }}
      className={chatComposerDropdownClassName(
        "scrollbar-hidden fixed select-none overflow-y-auto p-1.5",
      )}
      style={{
        zIndex: 10040,
        maxHeight: `${SLASH_COMMAND_DROPDOWN_MAX_HEIGHT}px`,
        width: `${adjustedPosition.width}px`,
        left: `${adjustedPosition.left}px`,
        top: `${adjustedPosition.top}px`,
        transformOrigin: "top left",
      }}
      role="listbox"
      aria-label="Slash command suggestions"
    >
      {filteredCommands.length > 0 ? (
        <div className="items-container space-y-1" role="presentation">
          {filteredCommands.map((command, index) => (
            <button
              key={command.name}
              type="button"
              data-item-index={index}
              onClick={() => onSelect(command)}
              className={cn(
                dropdownItemClassName(),
                chatComposerDropdownItemClassName(
                  "grid w-full grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2 py-1.5 pr-2",
                ),
                index === selectedIndex
                  ? "bg-selected text-text shadow-[inset_0_0_0_1px_var(--color-border)]"
                  : "text-text hover:bg-hover",
              )}
              role="option"
              aria-selected={index === selectedIndex}
              tabIndex={index === selectedIndex ? 0 : -1}
            >
              <span className="ui-text-xs flex size-5 items-center justify-center rounded-md border border-border/70 bg-primary-bg/60 font-medium leading-none text-text-lighter">
                /
              </span>
              <div className="min-w-0">
                <div className="ui-text-xs truncate font-medium leading-[1.35] text-text">
                  {command.name}
                </div>
                <div className="ui-text-xs truncate pt-0.5 text-text-lighter">
                  {command.description}
                </div>
              </div>
              <div className="min-w-0 justify-self-end">
                {command.input?.hint ? (
                  <span className="ui-text-xs block max-w-24 truncate rounded border border-border/60 bg-primary-bg/45 px-1.5 py-0.5 leading-[1.35] text-text-lighter">
                    {command.input.hint}
                  </span>
                ) : index === selectedIndex ? (
                  <span className="ui-text-xs rounded border border-border/60 px-1.5 py-0.5 leading-none text-text-lighter">
                    Enter
                  </span>
                ) : null}
              </div>
            </button>
          ))}
        </div>
      ) : (
        <div className="ui-text-xs px-2.5 py-2 text-text-lighter">
          {availableSlashCommands.length > 0 ? (
            <>
              <div className="font-medium text-text">No matching slash commands</div>
              <div className="ui-text-xs mt-0.5 opacity-75">Try a different search after `/`.</div>
            </>
          ) : (
            <>
              <div className="font-medium text-text">No slash commands available yet</div>
              <div className="ui-text-xs mt-0.5 opacity-75">
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
