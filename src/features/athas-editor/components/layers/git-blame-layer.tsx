import { forwardRef, memo } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { measureTextWidth } from "@/features/athas-editor/utils/position";
import type { ViewPosition } from "@/features/athas-editor/view-model/view-layout";
import { InlineGitBlame } from "@/features/git/components/git-inline-blame";
import { useGitBlame } from "@/features/git/hooks/use-git-blame";

interface GitBlameLayerProps {
  filePath: string;
  cursorLine: number;
  visualCursorLine: number;
  lines: string[];
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize?: number;
  wordWrap?: boolean;
  cursorViewPosition?: ViewPosition;
}

const GitBlameLayerComponent = forwardRef<HTMLDivElement, GitBlameLayerProps>(
  (
    {
      filePath,
      cursorLine,
      visualCursorLine,
      lines,
      fontSize,
      fontFamily,
      lineHeight,
      tabSize = 2,
      wordWrap = false,
      cursorViewPosition,
    },
    ref,
  ) => {
    const { getBlameForLine } = useGitBlame(filePath);
    const blameLine = getBlameForLine(cursorLine);

    const currentLineContent = lines[visualCursorLine] || "";
    const lineContentWidth = measureTextWidth(currentLineContent, fontSize, fontFamily, tabSize);

    const shouldShowBlame = !!blameLine && (wordWrap || lineContentWidth > 0);

    // Position at absolute content coordinates (scroll handled by container transform)
    const top =
      cursorViewPosition?.top ??
      visualCursorLine * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;
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
