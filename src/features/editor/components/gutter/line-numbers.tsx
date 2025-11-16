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
}

function LineNumbersComponent({
  totalLines,
  lineHeight,
  fontSize,
  fontFamily,
  onLineClick,
  foldMapping,
}: LineNumbersProps) {
  const activeLine = useEditorStateStore.use.cursorPosition().line;
  const lineNumberWidth = calculateLineNumberWidth(totalLines);

  const lineNumbers = useMemo(() => {
    const result = [];
    for (let i = 0; i < totalLines; i++) {
      const actualLineNumber = foldMapping?.virtualToActual.get(i) ?? i;
      const isActive = actualLineNumber === activeLine;

      result.push(
        <div
          key={i}
          style={{
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
  }, [totalLines, activeLine, lineHeight, onLineClick, foldMapping]);

  return (
    <div
      style={{
        width: `${lineNumberWidth}px`,
        height: "100%",
        overflowY: "hidden",
        overflowX: "hidden",
        fontSize: `${fontSize}px`,
        fontFamily,
        lineHeight: `${lineHeight}px`,
        padding: "0.5rem 0",
      }}
    >
      {lineNumbers}
    </div>
  );
}

export const LineNumbers = memo(LineNumbersComponent);
