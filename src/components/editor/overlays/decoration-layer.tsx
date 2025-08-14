import { extensionManager } from "@/extensions/extension-manager";
import { useEditorLayout } from "@/hooks/use-editor-layout";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useEditorDecorationsStore } from "@/stores/editor-decorations-store";
import { useEditorLayoutStore } from "@/stores/editor-layout-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";
import { useEditorViewStore } from "@/stores/editor-view-store";
import type { Decoration, Position } from "@/types/editor-types";
import { useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

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
  const storeDecorations = useEditorDecorationsStore(useShallow((state) => state.getDecorations()));
  const selection = useEditorCursorStore.use.selection?.() ?? undefined;
  const { scrollTop, scrollLeft } = useEditorLayoutStore();
  const { lineHeight, charWidth, gutterWidth } = useEditorLayout();
  const showLineNumbers = useEditorSettingsStore.use.lineNumbers();

  const decorations = useMemo(() => {
    const allDecorations = [...storeDecorations];

    // Add extension decorations
    const extensionDecorations = extensionManager.getAllDecorations();
    allDecorations.push(...extensionDecorations);

    // Add selection decoration
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

    // Calculate content offset using the same logic as cursor positioning
    const contentPadding = showLineNumbers ? 0 : 16;

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
          const x = gutterWidth + contentPadding + start.column * charWidth - scrollLeft;
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
          const firstLineX = gutterWidth + contentPadding + start.column * charWidth - scrollLeft;
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
            const x = gutterWidth + contentPadding - scrollLeft;
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
          const lastLineX = gutterWidth + contentPadding - scrollLeft;
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
        // Line decorations highlight entire lines
        for (let line = start.line; line <= end.line; line++) {
          const x = 0;
          const y = line * lineHeight - scrollTop;
          // width will be set via CSS

          rendered.push({
            key: `line-${index}-${line}`,
            x,
            y,
            width: 0, // Will use CSS width: 100%
            height: lineHeight,
            className,
            type,
          });
        }
      }
    });

    return rendered;
  }, [decorations, lineHeight, charWidth, gutterWidth, scrollTop, scrollLeft, showLineNumbers]);

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
            width: decoration.type === "line" ? "100%" : `${decoration.width}px`,
            height: `${decoration.height}px`,
            pointerEvents: "none",
          }}
        />
      ))}
    </>
  );
};

DecorationLayer.displayName = "DecorationLayer";
