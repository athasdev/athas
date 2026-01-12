import { useCallback } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { editorAPI } from "@/features/editor/extensions/api";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";

export const useCenterCursor = () => {
  const centerCursorInViewport = useCallback((line: number) => {
    const textarea = editorAPI.getTextareaRef();
    if (!textarea) return;

    const fontSize = useEditorSettingsStore.getState().fontSize;
    const lineHeight = Math.ceil(EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER * fontSize);
    const viewportHeight = textarea.clientHeight;

    const targetLineTop = line * lineHeight;
    const centeredScrollTop = targetLineTop - viewportHeight / 2 + lineHeight / 2;

    textarea.scrollTop = Math.max(0, centeredScrollTop);
  }, []);

  return { centerCursorInViewport };
};
