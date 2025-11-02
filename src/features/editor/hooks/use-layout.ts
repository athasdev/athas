import { useEffect, useMemo, useState } from "react";
import { EDITOR_CONSTANTS } from "../config/constants";
import { useEditorSettingsStore } from "../stores/settings-store";
import { useEditorViewStore } from "../stores/view-store";
import { clearCharWidthCache, getCharWidth, getLineHeight } from "../utils/position";

export function useEditorLayout() {
  const fontSize = useEditorSettingsStore.use.fontSize();
  const fontFamilySetting = useEditorSettingsStore.use.fontFamily();
  const lineNumbers = useEditorSettingsStore.use.lineNumbers();
  const lineCount = useEditorViewStore((state) => state.lines.length);
  const [metricsVersion, setMetricsVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const scheduleRecalculation = () => {
      if (cancelled) return;
      clearCharWidthCache();
      setMetricsVersion((version) => version + 1);
    };

    scheduleRecalculation();

    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.ready.then(scheduleRecalculation).catch(() => {});
      document.fonts.addEventListener?.("loadingdone", scheduleRecalculation);

      return () => {
        cancelled = true;
        document.fonts.removeEventListener?.("loadingdone", scheduleRecalculation);
      };
    }

    return () => {
      cancelled = true;
    };
  }, [fontSize, fontFamilySetting]);

  return useMemo(() => {
    const effectiveFontFamily = fontFamilySetting
      ? `${fontFamilySetting}, JetBrains Mono, monospace`
      : "JetBrains Mono, monospace";

    const lineHeight = getLineHeight(fontSize);
    const charWidth = getCharWidth(fontSize, effectiveFontFamily);
    const gutterWidth = lineNumbers
      ? Math.max(
          EDITOR_CONSTANTS.MIN_GUTTER_WIDTH,
          EDITOR_CONSTANTS.FIXED_GUTTER_DIGITS * EDITOR_CONSTANTS.GUTTER_CHAR_WIDTH +
            EDITOR_CONSTANTS.GUTTER_PADDING +
            EDITOR_CONSTANTS.GIT_INDICATOR_WIDTH,
        )
      : EDITOR_CONSTANTS.GIT_INDICATOR_WIDTH + 16; // Always reserve space for git indicators even without line numbers

    return {
      lineHeight,
      charWidth,
      gutterWidth,
    };
  }, [fontSize, fontFamilySetting, lineNumbers, lineCount, metricsVersion]);
}
