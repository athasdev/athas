/**
 * Editor Layout Hook - Provides dynamic layout values for positioning calculations
 */

import { useMemo, useRef } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorViewStore } from "@/features/editor/stores/view-store";
import { calculateTotalGutterWidth } from "@/features/editor/utils/gutter";

/**
 * Measure character width using Canvas API for accurate positioning
 */
function measureCharWidth(fontSize: number, fontFamily: string): number {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (context) {
    context.font = `${fontSize}px ${fontFamily}`;
    // Measure a representative character (monospace fonts have uniform width)
    return context.measureText("M").width;
  }
  // Fallback: approximate monospace character width
  return fontSize * 0.6;
}

/**
 * @deprecated Use useEditorLayout instead
 */
export function useLayout() {
  return useEditorLayout();
}

/**
 * Dynamic layout hook that returns actual calculated values
 * Used for accurate positioning in hover, go-to-definition, completions, etc.
 */
export function useEditorLayout() {
  const fontSize = useEditorSettingsStore.use.fontSize();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const lines = useEditorViewStore.use.lines();

  // Cache the canvas measurement to avoid recalculating on every render
  const charWidthCacheRef = useRef<{ fontSize: number; fontFamily: string; width: number } | null>(
    null,
  );

  const charWidth = useMemo(() => {
    const cache = charWidthCacheRef.current;
    if (cache && cache.fontSize === fontSize && cache.fontFamily === fontFamily) {
      return cache.width;
    }
    const width = measureCharWidth(fontSize, fontFamily);
    charWidthCacheRef.current = { fontSize, fontFamily, width };
    return width;
  }, [fontSize, fontFamily]);

  const gutterWidth = useMemo(() => {
    const totalLines = lines.length || 100;
    return calculateTotalGutterWidth(totalLines);
  }, [lines.length]);

  const lineHeight = useMemo(() => {
    return fontSize * EDITOR_CONSTANTS.LINE_HEIGHT_MULTIPLIER;
  }, [fontSize]);

  return {
    gutterWidth,
    charWidth,
    lineHeight,
    fontSize,
    fontFamily,
  };
}
