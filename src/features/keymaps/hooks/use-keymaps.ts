/**
 * Unified keyboard handler hook
 * Handles all keyboard shortcuts through the keymaps system
 *
 * This is the SINGLE source of truth for all keyboard handling.
 */

import { useEffect, useRef, useState } from "react";
import { logger } from "@/features/editor/utils/logger";
import { useSettingsStore } from "@/features/settings/store";
import { useUIState } from "@/stores/ui-state-store";
import { useKeymapStore } from "../stores/store";
import { evaluateWhenClause } from "../utils/context";
import { eventToKey, matchKeybinding } from "../utils/matcher";
import type { ParsedKey } from "../utils/parser";
import { keymapRegistry } from "../utils/registry";

const CHORD_TIMEOUT = 1000; // 1 second to complete chord

export function useKeymaps() {
  const contexts = useKeymapStore.use.contexts();
  const [chordState, setChordState] = useState<ParsedKey[]>([]);
  const chordTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip all keybinding handling when recording a new keybinding
      if (contexts.isRecordingKeybinding) {
        return;
      }

      // Escape key - global modal closing
      if (e.key === "Escape") {
        const { hasOpenModal, closeTopModal } = useUIState.getState();
        if (hasOpenModal()) {
          e.preventDefault();
          e.stopPropagation();
          closeTopModal();
          return;
        }
      }

      // Vim mode bypass - let vim handle keys without modifiers
      const { settings } = useSettingsStore.getState();
      const hasModifiers = e.metaKey || e.ctrlKey || e.altKey;

      if (settings.vimMode && !hasModifiers && !e.shiftKey) {
        return;
      }

      // Skip if target is an input (except our editor textarea or terminal)
      const target = e.target as HTMLElement;
      const isEditorTextarea = target.classList.contains("editor-textarea");
      const isTerminalTextarea = target.classList.contains("xterm-helper-textarea");
      if (
        target.tagName === "INPUT" ||
        (target.tagName === "TEXTAREA" && !isEditorTextarea && !isTerminalTextarea)
      ) {
        return;
      }

      // Get all keybindings from registry
      const allKeybindings = keymapRegistry.getAllKeybindings();

      // Get current event key
      const eventKey = eventToKey(e);

      // Try to match against registered keybindings
      for (const keybinding of allKeybindings) {
        if (!keybinding.enabled && keybinding.enabled !== undefined) {
          continue;
        }

        // Evaluate when clause
        if (keybinding.when && !evaluateWhenClause(keybinding.when, contexts)) {
          continue;
        }

        // Try to match this keybinding
        const matchResult = matchKeybinding(e, keybinding.key, chordState);

        if (matchResult.matched) {
          // Full match - execute command
          e.preventDefault();
          e.stopPropagation();

          // Clear chord state
          setChordState([]);
          if (chordTimeoutRef.current) {
            clearTimeout(chordTimeoutRef.current);
            chordTimeoutRef.current = null;
          }

          // Execute command
          keymapRegistry.executeCommand(keybinding.command, keybinding.args);
          logger.debug("Keymaps", `Executed: ${keybinding.key} -> ${keybinding.command}`);
          return;
        }

        if (matchResult.partialMatch) {
          // Partial chord match - wait for next key
          e.preventDefault();
          e.stopPropagation();

          const newChordState = [...chordState, eventKey];
          setChordState(newChordState);

          // Set timeout to reset chord state
          if (chordTimeoutRef.current) {
            clearTimeout(chordTimeoutRef.current);
          }

          chordTimeoutRef.current = setTimeout(() => {
            setChordState([]);
            chordTimeoutRef.current = null;
            logger.debug("Keymaps", "Chord timeout - reset");
          }, CHORD_TIMEOUT);

          logger.debug("Keymaps", `Chord partial match: ${keybinding.key} (waiting for next key)`);
          return;
        }
      }

      // No match - clear chord state if any
      if (chordState.length > 0) {
        setChordState([]);
        if (chordTimeoutRef.current) {
          clearTimeout(chordTimeoutRef.current);
          chordTimeoutRef.current = null;
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true); // Use capture phase

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      if (chordTimeoutRef.current) {
        clearTimeout(chordTimeoutRef.current);
      }
    };
  }, [contexts, chordState]);

  return {
    chordState,
    isAwaitingChord: chordState.length > 0,
  };
}
