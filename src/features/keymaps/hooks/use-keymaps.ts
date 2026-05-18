/**
 * Unified keyboard handler hook
 * Handles all keyboard shortcuts through the keymaps system
 *
 * This is the SINGLE source of truth for all keyboard handling.
 */

import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { logger } from "@/features/editor/utils/logger";
import { useSettingsStore } from "@/features/settings/store";
import { resolveEscapeGuard } from "@/utils/keyboard/escape-guard";
import { useUIState } from "@/features/window/stores/ui-state-store";
import { IS_LINUX } from "@/utils/platform";
import { useKeymapStore } from "../stores/store";
import { getEffectiveKeybindings } from "../utils/effective-keymaps";
import { isEditorKeyboardTarget } from "../utils/editor-keyboard-target";
import { evaluateWhenClause } from "../utils/context";
import { eventToKey, keysMatch, matchKeybinding } from "../utils/matcher";
import { isNativeMenuAccelerator } from "../utils/native-menu-accelerators";
import { parseKeybinding } from "../utils/parser";
import type { ParsedKey } from "../utils/parser";
import { keymapRegistry } from "../utils/registry";

const CHORD_TIMEOUT = 1000; // 1 second to complete chord
const CLOSE_TAB_CLOSE_REQUEST_WINDOW_MS = 1000;
const closeTabShortcut = parseKeybinding("cmd+w").parts[0];

function isCloseTabShortcut(event: KeyboardEvent) {
  return keysMatch(eventToKey(event), closeTabShortcut);
}

export function useKeymaps() {
  const contexts = useKeymapStore.use.contexts();
  const [chordState, setChordState] = useState<ParsedKey[]>([]);
  const chordTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastCloseTabShortcutAtRef = useRef(0);

  useEffect(() => {
    if (!IS_LINUX || typeof window === "undefined") return;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    const setupCloseRequestGuard = async () => {
      try {
        const removeListener = await getCurrentWindow().onCloseRequested((event) => {
          const elapsed = Date.now() - lastCloseTabShortcutAtRef.current;

          if (elapsed <= CLOSE_TAB_CLOSE_REQUEST_WINDOW_MS) {
            event.preventDefault();
            lastCloseTabShortcutAtRef.current = 0;
          }
        });

        if (disposed) {
          removeListener();
          return;
        }

        unlisten = removeListener;
      } catch (error) {
        logger.debug("Keymaps", `Failed to register close request guard: ${String(error)}`);
      }
    };

    void setupCloseRequestGuard();

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip all keybinding handling when recording a new keybinding
      if (contexts.isRecordingKeybinding) {
        return;
      }

      const target = e.target as HTMLElement | null;
      const isEditorTarget =
        isEditorKeyboardTarget(target) ||
        isEditorKeyboardTarget(document.activeElement as HTMLElement | null);

      // Prevent modifier-shortcut floods when key is held down (e.g. Cmd+R auto-repeat)
      if (e.repeat && (e.metaKey || e.ctrlKey || e.altKey)) {
        return;
      }

      if (isCloseTabShortcut(e)) {
        lastCloseTabShortcutAtRef.current = Date.now();
        e.preventDefault();
        e.stopPropagation();
        keymapRegistry.executeCommand(contexts.terminalFocus ? "terminal.close" : "file.close");
        return;
      }

      // When the native menu bar is active, let Tauri's menu accelerators be the only source
      // of truth for overlapping shortcuts to avoid duplicate execution.
      if (
        useSettingsStore.getState().settings.nativeMenuBar &&
        isNativeMenuAccelerator(e) &&
        !isEditorTarget
      ) {
        return;
      }

      // Escape key - global modal closing
      if (e.key === "Escape") {
        const activeElement =
          typeof document !== "undefined" ? (document.activeElement as HTMLElement | null) : null;
        const { dismissTarget, blurTarget } = resolveEscapeGuard(e.target, activeElement);

        if (dismissTarget || blurTarget) {
          return;
        }

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
      const isEditorTextarea = isEditorTarget;
      const isTerminalTextarea = target?.classList.contains("xterm-helper-textarea") ?? false;
      if (
        target?.tagName === "INPUT" ||
        (target?.tagName === "TEXTAREA" && !isEditorTextarea && !isTerminalTextarea)
      ) {
        return;
      }

      // Get keybindings from registry (defaults and extensions)
      const registryKeybindings = keymapRegistry.getAllKeybindings();

      // Get preset and user keybindings
      const userKeybindings = useKeymapStore.getState().keybindings;
      const allKeybindings = getEffectiveKeybindings({
        preset: settings.keybindingPreset,
        registryKeybindings,
        userKeybindings,
      });

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
