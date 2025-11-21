/**
 * Hook to track and update keymap contexts
 * Monitors editor focus, vim mode, terminal focus, etc.
 */

import { useEffect } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { useVimStore } from "@/features/vim/stores/vim-store";
import { useKeymapStore } from "../stores/store";

export function useKeymapContext() {
  const { setContext, setContexts } = useKeymapStore.use.actions();
  const vimMode = useSettingsStore((state) => state.settings.vimMode);
  const vimCurrentMode = useVimStore.use.mode();

  // Update vim mode contexts
  useEffect(() => {
    setContexts({
      vimMode,
      vimNormalMode: vimMode && vimCurrentMode === "normal",
      vimInsertMode: vimMode && vimCurrentMode === "insert",
      vimVisualMode: vimMode && vimCurrentMode === "visual",
    });
  }, [vimMode, vimCurrentMode, setContexts]);

  // Track editor focus
  useEffect(() => {
    const handleFocusIn = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      const isEditorFocus = target.classList.contains("editor-textarea");
      const isTerminalFocus = target.closest(".terminal-container") !== null;

      setContexts({
        editorFocus: isEditorFocus,
        terminalFocus: isTerminalFocus,
      });
    };

    const handleFocusOut = () => {
      // Small delay to check if focus moved to another element
      setTimeout(() => {
        const activeElement = document.activeElement as HTMLElement;
        if (!activeElement) {
          setContexts({
            editorFocus: false,
            terminalFocus: false,
          });
          return;
        }

        const isEditorFocus = activeElement.classList.contains("editor-textarea");
        const isTerminalFocus = activeElement.closest(".terminal-container") !== null;

        setContexts({
          editorFocus: isEditorFocus,
          terminalFocus: isTerminalFocus,
        });
      }, 0);
    };

    document.addEventListener("focusin", handleFocusIn);
    document.addEventListener("focusout", handleFocusOut);

    return () => {
      document.removeEventListener("focusin", handleFocusIn);
      document.removeEventListener("focusout", handleFocusOut);
    };
  }, [setContexts]);

  // Track selection
  useEffect(() => {
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      const hasSelection = selection ? selection.toString().length > 0 : false;
      setContext("hasSelection", hasSelection);
    };

    document.addEventListener("selectionchange", handleSelectionChange);

    return () => {
      document.removeEventListener("selectionchange", handleSelectionChange);
    };
  }, [setContext]);
}
