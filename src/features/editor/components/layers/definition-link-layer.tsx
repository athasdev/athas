/**
 * Definition Link Layer - Renders underline highlight for Cmd+hover symbols
 */

import type { RefObject } from "react";
import { memo, useMemo } from "react";
import { useEditorSettingsStore } from "../../stores/settings-store";
import { useEditorUIStore } from "../../stores/ui-store";
import { getAccurateCursorX } from "../../utils/position";
import { calculateSelectionBoxes } from "../../utils/selection-boxes";
import type { EditorViewLayout } from "../../view-model/view-layout";

interface DefinitionLinkLayerProps {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  lines: string[];
  lineOffsets: number[];
  contentLength: number;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  viewLayout?: EditorViewLayout;
}

export const DefinitionLinkLayer = memo(
  ({
    fontSize,
    fontFamily,
    lineHeight,
    lines,
    lineOffsets,
    contentLength,
    textareaRef,
    viewLayout,
  }: DefinitionLinkLayerProps) => {
    const definitionLinkRange = useEditorUIStore.use.definitionLinkRange();
    const tabSize = useEditorSettingsStore.use.tabSize();

    const highlightStyles = useMemo(() => {
      if (!definitionLinkRange) return null;

      const { line, startColumn, endColumn } = definitionLinkRange;

      if (line < 0 || line >= lines.length) return null;

      const lineText = lines[line];
      if (startColumn < 0 || endColumn > lineText.length) return null;

      const scrollTop = textareaRef.current?.scrollTop ?? 0;
      const scrollLeft = textareaRef.current?.scrollLeft ?? 0;
      const lineStartOffset = lineOffsets[line] ?? 0;

      return calculateSelectionBoxes({
        selectionOffsets: {
          start: lineStartOffset + startColumn,
          end: lineStartOffset + endColumn,
        },
        lines,
        lineOffsets,
        contentLength,
        lineHeight,
        measureText: (text) => getAccurateCursorX(text, text.length, fontSize, fontFamily, tabSize),
        viewLayout,
      }).map((box) => ({
        top: box.top - scrollTop,
        left: box.left - scrollLeft,
        width: box.width,
        height: box.height,
      }));
    }, [
      definitionLinkRange,
      lines,
      lineOffsets,
      contentLength,
      fontSize,
      fontFamily,
      lineHeight,
      tabSize,
      textareaRef,
      viewLayout,
    ]);

    if (!highlightStyles?.length) return null;

    return (
      <div className="definition-link-layer pointer-events-none absolute inset-0 z-10">
        {highlightStyles.map((highlightStyle, index) => (
          <div
            key={index}
            className="definition-link-highlight"
            style={{
              position: "absolute",
              top: `${highlightStyle.top}px`,
              left: `${highlightStyle.left}px`,
              width: `${highlightStyle.width}px`,
              height: `${highlightStyle.height}px`,
              borderBottom: "1px solid var(--accent)",
              cursor: "pointer",
            }}
          />
        ))}
      </div>
    );
  },
);
