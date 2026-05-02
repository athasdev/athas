import { memo, useCallback, useMemo } from "react";
import { CaretDown as ChevronDown, CaretRight as ChevronRight } from "@phosphor-icons/react";
import { useDebuggerStore } from "@/features/debugger/stores/debugger-store";
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
  lineNumberStart?: number;
  lineNumberMap?: Array<number | null>;
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
  lineNumberStart = 1,
  lineNumberMap,
}: FlowLineNumbersProps) {
  const actualCursorLine = useEditorStateStore.use.cursorPosition().line;
  const breakpoints = useDebuggerStore.use.breakpoints();
  const debuggerActions = useDebuggerStore.use.actions();
  const foldsByFile = useFoldStore((state) => state.foldsByFile);
  const foldActions = useFoldStore.use.actions();
  const isDiffAccordionBuffer = filePath?.startsWith("diff-editor://") ?? false;
  const mappedLargestLine = lineNumberMap?.reduce<number>(
    (largest, lineNumber) =>
      typeof lineNumber === "number" ? Math.max(largest, lineNumber) : largest,
    0,
  );
  const lineNumberWidth = calculateLineNumberWidth(
    Math.max(lineNumberStart + lines.length - 1, mappedLargestLine ?? 0),
  );
  const lineNumberOffset =
    GUTTER_CONFIG.DEBUG_LANE_WIDTH +
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
  const breakpointsByLine = useMemo(() => {
    const result = new Map<number, boolean>();
    if (!filePath) return result;

    for (const breakpoint of breakpoints) {
      if (breakpoint.filePath === filePath) {
        result.set(breakpoint.line, breakpoint.enabled);
      }
    }

    return result;
  }, [breakpoints, filePath]);

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
        const mappedLineNumber = lineNumberMap?.[actualLineNumber];
        const displayedLineNumber = mappedLineNumber ?? lineNumberStart + actualLineNumber;
        const hasDisplayedLineNumber = mappedLineNumber !== null;
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
            title={hasDisplayedLineNumber ? `Line ${displayedLineNumber}` : undefined}
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
                    width: `${GUTTER_CONFIG.DEBUG_LANE_WIDTH}px`,
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {(() => {
                    const enabled = breakpointsByLine.get(actualLineNumber);
                    const hasBreakpoint = typeof enabled === "boolean";
                    return (
                      <button
                        type="button"
                        aria-label={`${hasBreakpoint ? "Remove" : "Add"} breakpoint on line ${
                          actualLineNumber + 1
                        }`}
                        className="group flex size-full items-center justify-center"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (filePath)
                            debuggerActions.toggleBreakpoint(filePath, actualLineNumber);
                        }}
                      >
                        <span
                          className={
                            hasBreakpoint
                              ? enabled
                                ? "size-2.5 rounded-full bg-error"
                                : "size-2.5 rounded-full border border-error"
                              : "size-2.5 rounded-full bg-text-lighter/0 transition-colors group-hover:bg-text-lighter/30"
                          }
                        />
                      </button>
                    );
                  })()}
                </div>
              )}
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
                visibility: isAccordionLine || !hasDisplayedLineNumber ? "hidden" : "visible",
                color: isActive
                  ? "var(--text, #d4d4d4)"
                  : "var(--text-light, rgba(255, 255, 255, 0.5))",
                opacity: isActive ? 1 : 0.5,
                fontWeight: isActive ? 500 : 400,
              }}
            >
              {isAccordionLine ? <div className="diff-accordion-gutter-card" /> : null}
              {hasDisplayedLineNumber ? displayedLineNumber : ""}
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
