import { memo, useMemo } from "react";
import { useEditorStateStore } from "../../stores/state-store";
import { calculateLineNumberWidth } from "../../utils/gutter";

interface LineMapping {
  virtualToActual: Map<number, number>;
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
}

const GUTTER_PADDING = 8;

function LineNumbersComponent({
  totalLines,
  lineHeight,
  fontSize,
  fontFamily,
  onLineClick,
  foldMapping,
  startLine,
  endLine,
}: LineNumbersProps) {
  const activeLine = useEditorStateStore.use.cursorPosition().line;
  const lineNumberWidth = calculateLineNumberWidth(totalLines);

  const lineNumbers = useMemo(() => {
    const result = [];
    for (let i = startLine; i < endLine; i++) {
      const actualLineNumber = foldMapping?.virtualToActual.get(i) ?? i;
      const isActive = actualLineNumber === activeLine;

      result.push(
        <div
          key={i}
          style={{
            position: "absolute",
            top: `${i * lineHeight + GUTTER_PADDING}px`,
            left: 0,
            right: 0,
            height: `${lineHeight}px`,
            lineHeight: `${lineHeight}px`,
            textAlign: "right",
            paddingRight: "12px",
            color: isActive
              ? "var(--text, #d4d4d4)"
              : "var(--text-light, rgba(255, 255, 255, 0.5))",
            opacity: isActive ? 1 : 0.5,
            fontWeight: isActive ? 500 : 400,
            cursor: "pointer",
            userSelect: "none",
          }}
          onClick={() => onLineClick?.(i)}
          title={`Line ${actualLineNumber + 1}`}
        >
          {actualLineNumber + 1}
        </div>,
      );
    }
    return result;
  }, [startLine, endLine, activeLine, lineHeight, onLineClick, foldMapping]);

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
