/**
 * Definition Link Layer - Renders underline highlight for Cmd+hover symbols
 */

import type { RefObject } from "react";
import { memo, useMemo } from "react";
import { EDITOR_CONSTANTS } from "../../config/constants";
import { useEditorSettingsStore } from "../../stores/settings-store";
import { useEditorUIStore } from "../../stores/ui-store";
import { getAccurateCursorX } from "../../utils/position";

interface DefinitionLinkLayerProps {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  content: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
}

export const DefinitionLinkLayer = memo(
  ({ fontSize, fontFamily, lineHeight, content, textareaRef }: DefinitionLinkLayerProps) => {
    const definitionLinkRange = useEditorUIStore.use.definitionLinkRange();
    const tabSize = useEditorSettingsStore.use.tabSize();

    const highlightStyle = useMemo(() => {
      if (!definitionLinkRange) return null;

      const lines = content.split("\n");
      const { line, startColumn, endColumn } = definitionLinkRange;

      if (line < 0 || line >= lines.length) return null;

      const lineText = lines[line];
      if (startColumn < 0 || endColumn > lineText.length) return null;
      const startX = getAccurateCursorX(lineText, startColumn, fontSize, fontFamily, tabSize);
      const endX = getAccurateCursorX(lineText, endColumn, fontSize, fontFamily, tabSize);
      const left = startX + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT;
      const width = Math.max(endX - startX, 2);

      // Get current scroll position from textarea to position relative to viewport
      const scrollTop = textareaRef.current?.scrollTop ?? 0;
      const scrollLeft = textareaRef.current?.scrollLeft ?? 0;

      const top = line * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP - scrollTop;

      return {
        top,
        left: left - scrollLeft,
        width,
        height: lineHeight,
      };
    }, [definitionLinkRange, content, fontSize, fontFamily, lineHeight, tabSize, textareaRef]);

    if (!highlightStyle) return null;

    return (
      <div className="definition-link-layer pointer-events-none absolute inset-0 z-10">
        <div
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
      </div>
    );
  },
);
