import { selectAll } from "@codemirror/commands";
import { useEffect, useMemo } from "react";
import { isEditorKeyboardTarget } from "@/features/keymaps/utils/editor-keyboard-target";
import { isNativeTextInputTarget } from "@/utils/keyboard/text-input-target";
import { fallbackCommentTokens } from "../editor-commands";
import { type CodeMirrorHost, useCodeMirrorExtension } from "../host";

function isSelectAllShortcut(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === "a"
  );
}

/**
 * Editor support the shared editor commands rely on: comment tokens for toggling comments, and
 * select all for the active editor while focus sits on something that is not a text field, as
 * Monaco did. With focus in the editor, the Athas keymap's select all handles the shortcut.
 */
export function CodeMirrorEditorCommands({ host }: { host: CodeMirrorHost }) {
  const { view, isActiveSurface, languageId } = host;
  const extension = useMemo(() => fallbackCommentTokens(languageId), [languageId]);
  useCodeMirrorExtension(view, extension);

  useEffect(() => {
    if (!isActiveSurface) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !isSelectAllShortcut(event)) return;
      const { target } = event;
      const activeElement = document.activeElement;
      if (isEditorKeyboardTarget(target) || isEditorKeyboardTarget(activeElement)) return;
      if (isNativeTextInputTarget(target, activeElement)) return;
      if (target instanceof Element && target.closest(".terminal-container")) return;

      event.preventDefault();
      event.stopPropagation();
      selectAll(view);
      view.focus();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [isActiveSurface, view]);

  return null;
}
