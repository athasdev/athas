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
    const charWidth = getCharWidth(fontSize);
    const gutterWidth = lineNumbers
      ? Math.max(
          EDITOR_CONSTANTS.MIN_GUTTER_WIDTH,
          String(lineCount).length * EDITOR_CONSTANTS.GUTTER_CHAR_WIDTH +
            EDITOR_CONSTANTS.GUTTER_PADDING,
        )
      : 0;

    return {
      lineHeight,
      charWidth,
      gutterWidth,
    };
  }, [fontSize, lineNumbers, lineCount]);
}
