import { memo, useMemo } from "react";
import { EDITOR_CONSTANTS } from "../../config/constants";
import { calculateLineNumberWidth } from "../../utils/gutter";
import {
  getViewZoneHeightBeforeLine,
  type ResolvedEditorViewZone,
} from "../../view-model/view-layout";

interface LineMapping {
  virtualToActual: Map<number, number>;
  actualToVirtual: Map<number, number>;
}

interface LineNumbersProps {
  totalLines: number;
  lineHeight: number;
  fontSize: number;
  fontFamily: string;
  onLineClick?: (lineNumber: number) => void;
  foldMapping?: LineMapping;
  startLine: number;
  endLine: number;
  hiddenLines?: Set<number>;
  lineNumberStart?: number;
  lineNumberMap?: Array<number | null>;
  viewZones?: ResolvedEditorViewZone[];
  visualCursorLine: number;
}

function LineNumbersComponent({
  totalLines,
  lineHeight,
  fontSize,
  fontFamily,
  onLineClick,
  foldMapping,
  startLine,
  endLine,
  hiddenLines,
  lineNumberStart = 1,
  lineNumberMap,
  viewZones = [],
  visualCursorLine,
}: LineNumbersProps) {
  const mappedLargestLine = lineNumberMap?.reduce<number>(
    (largest, lineNumber) =>
      typeof lineNumber === "number" ? Math.max(largest, lineNumber) : largest,
    0,
  );
  const lineNumberWidth = calculateLineNumberWidth(
    Math.max(lineNumberStart + totalLines - 1, mappedLargestLine ?? 0),
  );

  const lineNumbers = useMemo(() => {
    const result = [];
    for (let i = startLine; i < endLine; i++) {
      const actualLineNumber = foldMapping?.virtualToActual.get(i) ?? i;
      const mappedLineNumber = lineNumberMap?.[actualLineNumber];
      const displayedLineNumber = mappedLineNumber ?? lineNumberStart + actualLineNumber;
      const hasDisplayedLineNumber = mappedLineNumber !== null;

      result.push(
        <div
          key={i}
          style={{
            position: "absolute",
            top: `${
              i * lineHeight +
              getViewZoneHeightBeforeLine(viewZones, i) +
              EDITOR_CONSTANTS.GUTTER_PADDING
            }px`,
            left: 0,
            right: 0,
            height: `${lineHeight}px`,
            lineHeight: `${lineHeight}px`,
            textAlign: "right",
            paddingRight: "8px",
            visibility: hiddenLines?.has(i) || !hasDisplayedLineNumber ? "hidden" : "visible",
            color: "var(--text-light, rgba(255, 255, 255, 0.5))",
            opacity: 0.5,
            fontWeight: 400,
            cursor: "pointer",
            userSelect: "none",
          }}
          onClick={() => onLineClick?.(i)}
          title={hasDisplayedLineNumber ? `Line ${displayedLineNumber}` : undefined}
        >
          {hasDisplayedLineNumber ? displayedLineNumber : ""}
        </div>,
      );
    }
    return result;
  }, [
    startLine,
    endLine,
    visualCursorLine,
    lineHeight,
    onLineClick,
    foldMapping,
    hiddenLines,
    lineNumberStart,
    lineNumberMap,
    viewZones,
  ]);

  const activeLineNumber = useMemo(() => {
    if (visualCursorLine < startLine || visualCursorLine >= endLine) return null;
    if (hiddenLines?.has(visualCursorLine)) return null;

    const actualLineNumber = foldMapping?.virtualToActual.get(visualCursorLine) ?? visualCursorLine;
    const mappedLineNumber = lineNumberMap?.[actualLineNumber];
    if (mappedLineNumber === null) return null;

    const displayedLineNumber = mappedLineNumber ?? lineNumberStart + actualLineNumber;

    return (
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: `${
            visualCursorLine * lineHeight +
            getViewZoneHeightBeforeLine(viewZones, visualCursorLine) +
            EDITOR_CONSTANTS.GUTTER_PADDING
          }px`,
          left: 0,
          right: 0,
          height: `${lineHeight}px`,
          lineHeight: `${lineHeight}px`,
          textAlign: "right",
          paddingRight: "8px",
          color: "var(--text, #d4d4d4)",
          opacity: 1,
          fontWeight: 500,
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        {displayedLineNumber}
      </div>
    );
  }, [
    endLine,
    foldMapping,
    hiddenLines,
    lineHeight,
    lineNumberMap,
    lineNumberStart,
    startLine,
    viewZones,
    visualCursorLine,
  ]);

  return (
    <div
      style={{
        position: "relative",
        width: `${lineNumberWidth}px`,
        fontSize: `${fontSize}px`,
        fontFamily,
      }}
    >
      {lineNumbers}
      {activeLineNumber}
    </div>
  );
}

export const LineNumbers = memo(LineNumbersComponent);
