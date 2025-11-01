import { useEffect, useMemo, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { editorAPI } from "@/features/editor/extensions/api";
import { extensionManager } from "@/features/editor/extensions/manager";
import { useEditorLayout } from "@/features/editor/hooks/use-layout";
import { useEditorDecorationsStore } from "@/features/editor/stores/decorations-store";
import { useEditorSettingsStore } from "@/features/editor/stores/settings-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorViewStore } from "@/features/editor/stores/view-store";
import type { Decoration, Position } from "@/features/editor/types/editor";
import { getAccurateCursorX } from "@/features/editor/utils/position";

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
  const selection = useEditorStateStore((state) => state.selection);
  const { lineHeight, charWidth, gutterWidth } = useEditorLayout();
  const fontSize = useEditorSettingsStore.use.fontSize();
  const fontFamily = useEditorSettingsStore.use.fontFamily();
  const tabSize = useEditorSettingsStore.use.tabSize();
  const lines = useEditorViewStore.use.lines();

  // Track viewport scroll position
  const [scrollOffset, setScrollOffset] = useState({ top: 0, left: 0 });

  // Listen to viewport scroll events
  useEffect(() => {
    let rafId: number | null = null;
    let viewport: HTMLElement | null = null;
    let scrollHandler: (() => void) | null = null;
    let rafPending = false;

    const setupScrollListener = () => {
      viewport = editorAPI.getViewportRef();

      if (!viewport) {
        rafId = requestAnimationFrame(setupScrollListener);
        return;
      }

      scrollHandler = () => {
        if (!viewport) return;
        if (rafPending) return;
        rafPending = true;
        requestAnimationFrame(() => {
          if (!viewport) return;
          setScrollOffset({
            top: viewport.scrollTop,
            left: viewport.scrollLeft,
          });
          rafPending = false;
        });
      };

      // Set initial scroll position
      scrollHandler();

      viewport.addEventListener("scroll", scrollHandler);
    };

    setupScrollListener();

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      if (viewport && scrollHandler) {
        viewport.removeEventListener("scroll", scrollHandler);
      }
    };
  }, []);

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

    decorations.forEach((decoration, index) => {
      const { range, className = "", type } = decoration;

      // Skip overlay decorations - they're handled by the overlay layer
      if (type === "overlay") return;

      // Ensure start is before end
      const start = isPositionBefore(range.start, range.end) ? range.start : range.end;
      const end = isPositionBefore(range.start, range.end) ? range.end : range.start;

      if (type === "inline") {
        // Inline decorations span within text - use accurate positioning
        if (start.line === end.line) {
          // Single line decoration
          const lineContent = lines[start.line] || "";
          const startX = getAccurateCursorX(
            lineContent,
            start.column,
            fontSize,
            fontFamily,
            tabSize,
          );
          const endX = getAccurateCursorX(lineContent, end.column, fontSize, fontFamily, tabSize);

          const x = gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN + startX - scrollOffset.left;
          const y = start.line * lineHeight - scrollOffset.top;
          const width = endX - startX;

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
          const firstLineContent = lines[start.line] || "";
          const firstLineStartX = getAccurateCursorX(
            firstLineContent,
            start.column,
            fontSize,
            fontFamily,
            tabSize,
          );
          const firstLineEndX = getAccurateCursorX(
            firstLineContent,
            firstLineContent.length,
            fontSize,
            fontFamily,
            tabSize,
          );

          const firstLineX =
            gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN + firstLineStartX - scrollOffset.left;
          const firstLineY = start.line * lineHeight - scrollOffset.top;
          const firstLineWidth = firstLineEndX - firstLineStartX;

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
            const lineContent = lines[line] || "";
            const lineWidth = getAccurateCursorX(
              lineContent,
              lineContent.length,
              fontSize,
              fontFamily,
              tabSize,
            );

            const x = gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN - scrollOffset.left;
            const y = line * lineHeight - scrollOffset.top;

            rendered.push({
              key: `inline-${index}-${line}`,
              x,
              y,
              width: lineWidth,
              height: lineHeight,
              className,
              type,
            });
          }

          // Last line
          const lastLineContent = lines[end.line] || "";
          const lastLineWidth = getAccurateCursorX(
            lastLineContent,
            end.column,
            fontSize,
            fontFamily,
            tabSize,
          );

          const lastLineX = gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN - scrollOffset.left;
          const lastLineY = end.line * lineHeight - scrollOffset.top;

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
          const x = gutterWidth + EDITOR_CONSTANTS.GUTTER_MARGIN - scrollOffset.left;
          const y = line * lineHeight - scrollOffset.top;

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
  }, [
    decorations,
    lineHeight,
    charWidth,
    gutterWidth,
    fontSize,
    fontFamily,
    tabSize,
    scrollOffset,
    lines,
  ]);

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
