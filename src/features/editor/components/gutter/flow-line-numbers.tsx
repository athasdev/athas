import { memo, useCallback, useMemo } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { parseDiffAccordionLine } from "@/features/git/utils/diff-editor-content";
import { EDITOR_CONSTANTS } from "../../config/constants";
import { useEditorStateStore } from "../../stores/state-store";
import { useFoldStore } from "../../stores/fold-store";
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
  const foldsByFile = useFoldStore((state) => state.foldsByFile);
  const foldActions = useFoldStore.use.actions();
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

  const fileState = filePath ? foldsByFile.get(filePath) : undefined;

  const handleFoldClick = useCallback(
    (lineNumber: number) => {
      if (!filePath) return;
      foldActions.toggleFold(filePath, lineNumber);
    },
    [filePath, foldActions],
  );

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
                display: "flex",
              }}
            >
              {!isDiffAccordionBuffer && (
                <div
                  style={{
                    width: `${GUTTER_CONFIG.GIT_LANE_WIDTH + GUTTER_CONFIG.DIAGNOSTIC_LANE_WIDTH}px`,
                    flexShrink: 0,
                  }}
                />
              )}
              {!isDiffAccordionBuffer && (
                <div
                  style={{
                    width: `${GUTTER_CONFIG.FOLD_LANE_WIDTH}px`,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {(() => {
                    const region = fileState?.regions.find(
                      (candidate) => candidate.startLine === actualLineNumber,
                    );
                    if (!region) return null;
                    const isCollapsed = fileState?.collapsedLines.has(actualLineNumber);
                    return (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleFoldClick(actualLineNumber);
                        }}
                        aria-label={isCollapsed ? "Expand fold" : "Collapse fold"}
                        aria-expanded={!isCollapsed}
                        className="flex h-4 w-4 items-center justify-center rounded text-text-lighter transition-colors hover:bg-hover/40 hover:text-text"
                      >
                        {isCollapsed ? (
                          <ChevronRight size={14} strokeWidth={2} />
                        ) : (
                          <ChevronDown size={14} strokeWidth={2} />
                        )}
                      </button>
                    );
                  })()}
                </div>
              )}
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
