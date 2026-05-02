import { useCallback } from "react";
import { editorAPI } from "@/features/editor/extensions/api";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { calculateLineHeight } from "@/features/editor/utils/lines";

export const useCenterCursor = () => {
  const centerCursorInViewport = useCallback((line: number) => {
    const textarea = editorAPI.getTextareaRef();
    if (!textarea) return;

    const { fontSize, lineHeight: editorLineHeight } = useEditorSettingsStore.getState();
    const lineHeight = calculateLineHeight(fontSize, editorLineHeight);
    const viewportHeight = textarea.clientHeight;

    const targetLineTop = line * lineHeight;
    const centeredScrollTop = targetLineTop - viewportHeight / 2 + lineHeight / 2;

    textarea.scrollTop = Math.max(0, centeredScrollTop);
  }, []);

  return { centerCursorInViewport };
};
