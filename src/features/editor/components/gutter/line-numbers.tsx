import { memo, useMemo } from "react";
import { EDITOR_CONSTANTS } from "../../config/constants";
import { useEditorStateStore } from "../../stores/state-store";
import { calculateLineNumberWidth } from "../../utils/gutter";

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
}: LineNumbersProps) {
  const actualCursorLine = useEditorStateStore.use.cursorPosition().line;
  const mappedLargestLine = lineNumberMap?.reduce<number>(
    (largest, lineNumber) =>
      typeof lineNumber === "number" ? Math.max(largest, lineNumber) : largest,
    0,
  );
  const lineNumberWidth = calculateLineNumberWidth(
    Math.max(lineNumberStart + totalLines - 1, mappedLargestLine ?? 0),
  );

  const visualCursorLine = useMemo(() => {
    if (foldMapping?.actualToVirtual) {
      return foldMapping.actualToVirtual.get(actualCursorLine) ?? actualCursorLine;
    }
    return actualCursorLine;
  }, [actualCursorLine, foldMapping]);

  const lineNumbers = useMemo(() => {
    const result = [];
    for (let i = startLine; i < endLine; i++) {
      const actualLineNumber = foldMapping?.virtualToActual.get(i) ?? i;
      const mappedLineNumber = lineNumberMap?.[actualLineNumber];
      const displayedLineNumber = mappedLineNumber ?? lineNumberStart + actualLineNumber;
      const hasDisplayedLineNumber = mappedLineNumber !== null;
      const isActive = i === visualCursorLine;

      result.push(
        <div
          key={i}
          style={{
            position: "absolute",
            top: `${i * lineHeight + EDITOR_CONSTANTS.GUTTER_PADDING}px`,
            left: 0,
            right: 0,
            height: `${lineHeight}px`,
            lineHeight: `${lineHeight}px`,
            textAlign: "right",
            paddingRight: "12px",
            visibility: hiddenLines?.has(i) || !hasDisplayedLineNumber ? "hidden" : "visible",
            color: isActive
              ? "var(--text, #d4d4d4)"
              : "var(--text-light, rgba(255, 255, 255, 0.5))",
            opacity: isActive ? 1 : 0.5,
            fontWeight: isActive ? 500 : 400,
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
    </div>
  );
}

export const LineNumbers = memo(LineNumbersComponent);
