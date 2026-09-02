/**
 * Editor Layout Hook - Provides dynamic layout values for positioning calculations
 */

import { useMemo } from "react";
import { useEditorSettingsStore } from "@/features/editor/stores/settings.store";
import { useEditorViewStore } from "@/features/editor/stores/view.store";
import { calculateTotalGutterWidth } from "@/features/editor/utils/gutter";
import { useZoomStore } from "@/features/window/stores/zoom.store";

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
 * Dynamic layout hook that returns actual calculated values
 * Used for accurate positioning in hover, go-to-definition, completions, etc.
 */
export function useEditorLayout() {
  const baseFontSize = useEditorSettingsStore.use.fontSize();
  const lineHeightMultiplier = useEditorSettingsStore.use.lineHeight();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const lineCount = useEditorViewStore.use.lineCount();
  const zoomLevel = useZoomStore.use.editorZoomLevel();
  const fontSize = baseFontSize * zoomLevel;

  const charWidth = useMemo(() => measureCharWidth(fontSize, fontFamily), [fontFamily, fontSize]);

  const gutterWidth = useMemo(() => {
    const totalLines = lineCount || 100;
    return calculateTotalGutterWidth(totalLines);
  }, [lineCount]);

  const lineHeight = useMemo(() => {
    return Math.ceil(fontSize * lineHeightMultiplier);
  }, [fontSize, lineHeightMultiplier]);

  return {
    gutterWidth,
    charWidth,
    lineHeight,
    fontSize,
    fontFamily,
  };
}
