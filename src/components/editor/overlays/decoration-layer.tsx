import { useMemo } from "react";
import { EDITOR_CONSTANTS } from "@/constants/editor-constants";
import { extensionManager } from "@/extensions/extension-manager";
import { useEditorLayout } from "@/hooks/use-editor-layout";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useEditorDecorationsStore } from "@/stores/editor-decorations-store";
import { useEditorLayoutStore } from "@/stores/editor-layout-store";
import { useEditorViewStore } from "@/stores/editor-view-store";
import type { Decoration, Position } from "@/types/editor-types";

interface RenderedDecoration {
  key: string;
  x: number;
  y: number;
  width: number;
  height: number;
  className: string;
  type: Decoration["type"];
}

function isPositionBefore(a: Position, b: Position): boolean {
  return a.line < b.line || (a.line === b.line && a.column < b.column);
}

export const DecorationLayer = () => {
  const storeDecorations = useEditorDecorationsStore((state) => state.getDecorations());
  const selection = useEditorCursorStore((state) => state.selection);
  const { scrollTop, scrollLeft } = useEditorLayoutStore();
  const { lineHeight, charWidth, gutterWidth } = useEditorLayout();

  const decorations = useMemo(() => {
    const allDecorations = [...storeDecorations];

    // Add extension decorations
    const extensionDecorations = extensionManager.getAllDecorations();
    allDecorations.push(...extensionDecorations);

    // Add selection decoration - use line type for full-width highlighting
    if (selection) {
      allDecorations.push({
        range: selection,
        type: "inline" as const,
        className: "selection",
      });
    }
    return allDecorations;
  }, [storeDecorations, selection]);

  const renderedDecorations = useMemo<RenderedDecoration[]>(() => {
    const rendered: RenderedDecoration[] = [];
    const lines = useEditorViewStore.getState().lines;

    decorations.forEach((decoration, index) => {
      const { range, className = "", type } = decoration;

      // Skip overlay decorations - they're handled by the overlay layer
      if (type === "overlay") return;

      // Ensure start is before end
      const start = isPositionBefore(range.start, range.end) ? range.start : range.end;
      const end = isPositionBefore(range.start, range.end) ? range.end : range.start;

      if (type === "inline") {
        // Inline decorations span within text
        if (start.line === end.line) {
          // Single line decoration
          const x =
            gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN + start.column * charWidth - scrollLeft;
          const y = start.line * lineHeight - scrollTop;
          const width = (end.column - start.column) * charWidth;

          rendered.push({
            key: `inline-${index}-${start.line}`,
            x,
            y,
            width,
            height: lineHeight,
            className,
            type,
          });
        } else {
          // Multi-line decoration
          // First line
          const firstLineX =
            gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN + start.column * charWidth - scrollLeft;
          const firstLineY = start.line * lineHeight - scrollTop;
          const firstLineWidth = (lines[start.line].length - start.column) * charWidth;

          rendered.push({
            key: `inline-${index}-${start.line}`,
            x: firstLineX,
            y: firstLineY,
            width: firstLineWidth,
            height: lineHeight,
            className,
            type,
          });

          // Middle lines
          for (let line = start.line + 1; line < end.line; line++) {
            const x = gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN - scrollLeft;
            const y = line * lineHeight - scrollTop;
            const width = lines[line].length * charWidth;

            rendered.push({
              key: `inline-${index}-${line}`,
              x,
              y,
              width,
              height: lineHeight,
              className,
              type,
            });
          }

          // Last line
          const lastLineX = gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN - scrollLeft;
          const lastLineY = end.line * lineHeight - scrollTop;
          const lastLineWidth = end.column * charWidth;

          rendered.push({
            key: `inline-${index}-${end.line}`,
            x: lastLineX,
            y: lastLineY,
            width: lastLineWidth,
            height: lineHeight,
            className,
            type,
          });
        }
      } else if (type === "line") {
        // Line decorations highlight entire lines, excluding gutter
        for (let line = start.line; line <= end.line; line++) {
          const x = gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN;
          const y = line * lineHeight - scrollTop;

          rendered.push({
            key: `line-${index}-${line}`,
            x,
            y,
            width: 0, // Will use CSS calc() to span remaining width
            height: lineHeight,
            className,
            type,
          });
        }
      }
    });

    return rendered;
  }, [decorations, lineHeight, charWidth, gutterWidth, scrollTop, scrollLeft]);

  return (
    <>
      {renderedDecorations.map((decoration) => (
        <div
          key={decoration.key}
          className={`editor-decoration editor-decoration-${decoration.type} ${decoration.className}`}
          style={{
            position: "absolute",
            left: `${decoration.x}px`,
            top: `${decoration.y}px`,
            width:
              decoration.type === "line" && decoration.x > 0
                ? `calc(100% - ${decoration.x}px)`
                : decoration.type === "line"
                  ? "100%"
                  : `${decoration.width}px`,
            height: `${decoration.height}px`,
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  );
};

DecorationLayer.displayName = "DecorationLayer";
