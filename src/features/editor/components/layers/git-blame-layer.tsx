import { forwardRef, memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { splitLines } from "@/features/editor/utils/lines";
import { InlineGitBlame } from "@/features/git/components/git-inline-blame";
import { useGitBlame } from "@/features/git/hooks/use-git-blame";

interface GitBlameLayerProps {
  filePath: string;
  cursorLine: number;
  visualCursorLine: number;
  visualContent: string;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize?: number;
  wordWrap?: boolean;
}

const GitBlameLayerComponent = forwardRef<HTMLDivElement, GitBlameLayerProps>(
  (
    {
      filePath,
      cursorLine,
      visualCursorLine,
      visualContent,
      fontSize,
      fontFamily,
      lineHeight,
      tabSize = 2,
      wordWrap = false,
    },
    ref,
  ) => {
    const { getBlameForLine } = useGitBlame(filePath);
    const blameLine = getBlameForLine(cursorLine);
    const measureRef = useRef<HTMLSpanElement>(null);
    const [lineContentWidth, setLineContentWidth] = useState(0);

    const lines = useMemo(() => splitLines(visualContent), [visualContent]);
    const currentLineContent = lines[visualCursorLine] || "";

    // Reset width when file changes to prevent stale positioning during file switches
    useLayoutEffect(() => {
      setLineContentWidth(0);
    }, [filePath]);

    // Measure the actual rendered width using a hidden element
    useLayoutEffect(() => {
      if (measureRef.current) {
        setLineContentWidth(measureRef.current.offsetWidth);
      }
    }, [currentLineContent, fontSize, fontFamily, tabSize, filePath]);

    const shouldShowBlame = !!blameLine && (wordWrap || lineContentWidth > 0);

    // Position at absolute content coordinates (scroll handled by container transform)
    const top = visualCursorLine * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;
    const left = lineContentWidth + EDITOR_CONSTANTS.GUTTER_MARGIN + 8;

    return (
      <div
        ref={ref}
        className="git-blame-layer pointer-events-none absolute inset-0"
        style={{
          fontSize: `${fontSize}px`,
          fontFamily,
          lineHeight: `${lineHeight}px`,
          willChange: "transform",
        }}
      >
        {wordWrap ? (
          <div
            style={{
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              tabSize,
            }}
          >
            {lines.slice(0, Math.max(0, visualCursorLine)).map((line, index) => (
              <div
                key={index}
                className="highlight-layer-line"
                style={{
                  lineHeight: `${lineHeight}px`,
                  visibility: "hidden",
                }}
              >
                {line || "\u00A0"}
              </div>
            ))}
            {blameLine && (
              <div className="highlight-layer-line" style={{ lineHeight: `${lineHeight}px` }}>
                <span aria-hidden="true" style={{ visibility: "hidden" }}>
                  {currentLineContent}
                </span>
                <span
                  style={{
                    display: "inline-block",
                    position: "relative",
                    width: 0,
                    height: 0,
                    verticalAlign: "top",
                  }}
                >
                  <span
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      height: `${lineHeight}px`,
                      pointerEvents: "auto",
                    }}
                  >
                    <InlineGitBlame
                      blameLine={blameLine}
                      containerClassName="pointer-events-auto"
                      fontSize={fontSize}
                      lineHeight={lineHeight}
                    />
                  </span>
                </span>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Hidden element to measure actual text width - always rendered */}
            <span
              ref={measureRef}
              aria-hidden="true"
              style={{
                position: "absolute",
                visibility: "hidden",
                whiteSpace: "pre",
                tabSize,
              }}
            >
              {currentLineContent}
            </span>

            {shouldShowBlame && (
              <div
                className="pointer-events-auto absolute flex items-center"
                style={{
                  top: `${top}px`,
                  height: `${lineHeight}px`,
                  left: `${left}px`,
                }}
              >
                <InlineGitBlame blameLine={blameLine} fontSize={fontSize} lineHeight={lineHeight} />
              </div>
            )}
          </>
        )}
      </div>
    );
  },
);

GitBlameLayerComponent.displayName = "GitBlameLayer";

export const GitBlameLayer = memo(GitBlameLayerComponent);
