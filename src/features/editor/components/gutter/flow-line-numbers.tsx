import { memo, useMemo } from "react";
import { parseDiffAccordionLine } from "@/features/git/utils/diff-editor-content";
import { EDITOR_CONSTANTS } from "../../config/constants";
import { useEditorStateStore } from "../../stores/state-store";
import { calculateLineNumberWidth, GUTTER_CONFIG } from "../../utils/gutter";

interface LineMapping {
  virtualToActual: Map<number, number>;
  actualToVirtual: Map<number, number>;
}

interface FlowLineNumbersProps {
  lines: string[];
  lineHeight: number;
  fontSize: number;
  fontFamily: string;
  textWidth: number;
  onLineClick?: (lineNumber: number) => void;
  foldMapping?: LineMapping;
  filePath?: string;
}

function FlowLineNumbersComponent({
  lines,
  lineHeight,
  fontSize,
  fontFamily,
  textWidth,
  onLineClick,
  foldMapping,
  filePath,
}: FlowLineNumbersProps) {
  const actualCursorLine = useEditorStateStore.use.cursorPosition().line;
  const isDiffAccordionBuffer = filePath?.startsWith("diff-editor://") ?? false;
  const lineNumberWidth = calculateLineNumberWidth(lines.length);
  const lineNumberOffset =
    GUTTER_CONFIG.GIT_LANE_WIDTH +
    GUTTER_CONFIG.DIAGNOSTIC_LANE_WIDTH +
    (isDiffAccordionBuffer ? 0 : GUTTER_CONFIG.FOLD_LANE_WIDTH);

  const visualCursorLine = useMemo(() => {
    if (foldMapping?.actualToVirtual) {
      return foldMapping.actualToVirtual.get(actualCursorLine) ?? actualCursorLine;
    }
    return actualCursorLine;
  }, [actualCursorLine, foldMapping]);

  return (
    <div
      style={{
        fontSize: `${fontSize}px`,
        fontFamily,
        paddingTop: `${EDITOR_CONSTANTS.GUTTER_PADDING}px`,
        paddingBottom: `${EDITOR_CONSTANTS.GUTTER_PADDING}px`,
      }}
    >
      {lines.map((line, i) => {
        const actualLineNumber = foldMapping?.virtualToActual.get(i) ?? i;
        const isActive = i === visualCursorLine;
        const isAccordionLine = isDiffAccordionBuffer && parseDiffAccordionLine(line) !== null;

        return (
          <div
            key={i}
            style={{
              display: "flex",
              lineHeight: `${lineHeight}px`,
              cursor: "pointer",
              userSelect: "none",
            }}
            onClick={() => onLineClick?.(i)}
            title={`Line ${actualLineNumber + 1}`}
          >
            <div
              aria-hidden
              className={isAccordionLine ? "diff-accordion-gutter-line" : undefined}
              style={{
                width: `${lineNumberOffset}px`,
                flexShrink: 0,
                position: "relative",
              }}
            >
              {isAccordionLine ? <div className="diff-accordion-gutter-card" /> : null}
            </div>

            {/* Line number — fixed width, right-aligned */}
            <div
              className={isAccordionLine ? "diff-accordion-gutter-line" : undefined}
              style={{
                width: `${lineNumberWidth}px`,
                flexShrink: 0,
                textAlign: "right",
                paddingRight: "12px",
                position: "relative",
                visibility: isAccordionLine ? "hidden" : "visible",
                color: isActive
                  ? "var(--text, #d4d4d4)"
                  : "var(--text-light, rgba(255, 255, 255, 0.5))",
                opacity: isActive ? 1 : 0.5,
                fontWeight: isActive ? 500 : 400,
              }}
            >
              {isAccordionLine ? <div className="diff-accordion-gutter-card" /> : null}
              {actualLineNumber + 1}
            </div>
            {/* Hidden mirror text — drives the row height via word wrapping */}
            <div
              aria-hidden
              style={{
                width: `${textWidth}px`,
                visibility: "hidden",
                whiteSpace: "pre-wrap",
                overflowWrap: "anywhere",
                wordBreak: "break-word",
                overflow: "hidden",
                height: "auto",
              }}
            >
              {line || "\n"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export const FlowLineNumbers = memo(FlowLineNumbersComponent);
