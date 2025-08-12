import { useMemo } from "react";
import { EDITOR_CONSTANTS } from "../constants/editor-constants";
import { useEditorSettingsStore } from "../stores/editor-settings-store";
import { useEditorViewStore } from "../stores/editor-view-store";
import { getCharWidth, getLineHeight } from "../utils/editor-position";

export function useEditorLayout() {
  const fontSize = useEditorSettingsStore.use.fontSize();
  const lineNumbers = useEditorSettingsStore.use.lineNumbers();
  const lineCount = useEditorViewStore((state) => state.lines.length);

  return useMemo(() => {
    const lineHeight = getLineHeight(fontSize);
    const charWidth = getCharWidth(fontSize, "JetBrains Mono, monospace");
    const gutterWidth = lineNumbers
      ? Math.max(
          EDITOR_CONSTANTS.MIN_GUTTER_WIDTH,
          String(lineCount).length * EDITOR_CONSTANTS.GUTTER_CHAR_WIDTH +
            EDITOR_CONSTANTS.GUTTER_PADDING +
            EDITOR_CONSTANTS.GIT_INDICATOR_WIDTH,
        )
      : EDITOR_CONSTANTS.GIT_INDICATOR_WIDTH + 16; // Always reserve space for git indicators even without line numbers

    return {
      lineHeight,
      charWidth,
      gutterWidth,
    };
  }, [fontSize, lineNumbers, lineCount]);
}
