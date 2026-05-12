import { forwardRef, memo, useMemo } from "react";
import { EDITOR_CONSTANTS } from "../../config/constants";
import { getIndentGuidesForLine } from "../../utils/indent-guides";
import { getAccurateCursorX } from "../../utils/position";
import type { EditorViewLayout } from "../../view-model/view-layout";

interface IndentGuideLayerProps {
  enabled: boolean;
  lines: string[];
  lineCount: number;
  lineHeight: number;
  fontSize: number;
  fontFamily: string;
  tabSize: number;
  activeLine: number;
  activeColumn: number;
  lineTextResolver?: (lineIndex: number) => string;
  viewportRange?: { startLine: number; endLine: number };
  viewLayout?: EditorViewLayout;
}

interface RenderedIndentGuide {
  lineIndex: number;
  column: number;
  active: boolean;
  top: number;
  left: number;
  height: number;
}

const IndentGuideLayerComponent = forwardRef<HTMLDivElement, IndentGuideLayerProps>(
  (
    {
      enabled,
      lines,
      lineCount,
      lineHeight,
      fontSize,
      fontFamily,
      tabSize,
      activeLine,
      activeColumn,
      lineTextResolver,
      viewportRange,
      viewLayout,
    },
    ref,
  ) => {
    const guides = useMemo<RenderedIndentGuide[]>(() => {
      if (!enabled || lineCount <= 0) return [];

      const startLine = Math.max(0, Math.min(viewportRange?.startLine ?? 0, lineCount));
      const endLine = Math.max(startLine, Math.min(viewportRange?.endLine ?? lineCount, lineCount));
      const result: RenderedIndentGuide[] = [];
      const spaceWidth = getAccurateCursorX(" ", 1, fontSize, fontFamily, tabSize);

      for (let lineIndex = startLine; lineIndex < endLine; lineIndex++) {
        const lineText = lineTextResolver?.(lineIndex) ?? lines[lineIndex] ?? "";
        const lineGuides = getIndentGuidesForLine(
          lineText,
          tabSize,
          lineIndex === activeLine ? activeColumn : undefined,
        );

        if (lineGuides.length === 0) continue;

        const firstSegment = viewLayout?.getSegmentForModelPosition(lineIndex, 0);
        const viewLineCount = viewLayout?.getModelLineViewLineCount(lineIndex) ?? 1;
        const top =
          firstSegment?.top ?? lineIndex * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;
        const height = Math.max(lineHeight, viewLineCount * lineHeight);

        for (const guide of lineGuides) {
          result.push({
            lineIndex,
            column: guide.column,
            active: guide.active,
            top,
            height,
            left: EDITOR_CONSTANTS.EDITOR_PADDING_LEFT + guide.column * spaceWidth,
          });
        }
      }

      return result;
    }, [
      activeColumn,
      activeLine,
      enabled,
      fontFamily,
      fontSize,
      lineCount,
      lineHeight,
      lineTextResolver,
      lines,
      tabSize,
      viewLayout,
      viewportRange,
    ]);

    if (guides.length === 0) return null;

    return (
      <div
        ref={ref}
        className="indent-guide-layer pointer-events-none absolute inset-0 z-[1]"
        style={{ willChange: "transform" }}
      >
        {guides.map((guide) => (
          <div
            key={`${guide.lineIndex}-${guide.column}`}
            className={`editor-indent-guide${guide.active ? " editor-indent-guide-active" : ""}`}
            style={{
              top: `${guide.top}px`,
              left: `${guide.left}px`,
              height: `${guide.height}px`,
            }}
          />
        ))}
      </div>
    );
  },
);

IndentGuideLayerComponent.displayName = "IndentGuideLayer";

export const IndentGuideLayer = memo(IndentGuideLayerComponent, (prev, next) => {
  return (
    prev.enabled === next.enabled &&
    prev.lines === next.lines &&
    prev.lineCount === next.lineCount &&
    prev.lineHeight === next.lineHeight &&
    prev.fontSize === next.fontSize &&
    prev.fontFamily === next.fontFamily &&
    prev.tabSize === next.tabSize &&
    prev.activeLine === next.activeLine &&
    prev.activeColumn === next.activeColumn &&
    prev.lineTextResolver === next.lineTextResolver &&
    prev.viewportRange?.startLine === next.viewportRange?.startLine &&
    prev.viewportRange?.endLine === next.viewportRange?.endLine &&
    prev.viewLayout === next.viewLayout
  );
});
