import { forwardRef, memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { splitLines } from "@/features/editor/utils/lines";
import { InlineGitBlame } from "@/features/git/components/git-inline-blame";
import { useGitBlame } from "@/features/git/hooks/use-git-blame";

interface GitBlameLayerProps {
  filePath: string;
  cursorLine: number;
  cursorColumn: number;
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
      cursorColumn,
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
    const currentColumnContent = currentLineContent.slice(0, Math.max(0, cursorColumn));

    // Reset width when file changes to prevent stale positioning during file switches
    useLayoutEffect(() => {
      setLineContentWidth(0);
    }, [filePath]);

    // Measure the actual rendered width using a hidden element
    useLayoutEffect(() => {
      if (measureRef.current) {
        setLineContentWidth(measureRef.current.offsetWidth);
      }
    }, [currentColumnContent, fontSize, fontFamily, tabSize, filePath]);

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
          {wordWrap ? currentColumnContent : currentLineContent}
        </span>

        {shouldShowBlame && (
          <div
            className="pointer-events-auto absolute flex items-center"
            style={{
              top: `${top}px`,
              height: `${lineHeight}px`,
              ...(wordWrap
                ? {
                    left: `${Math.max(
                      EDITOR_CONSTANTS.EDITOR_PADDING_LEFT,
                      lineContentWidth + EDITOR_CONSTANTS.GUTTER_MARGIN + 8,
                    )}px`,
                    maxWidth: `calc(100% - ${EDITOR_CONSTANTS.EDITOR_PADDING_LEFT + EDITOR_CONSTANTS.EDITOR_PADDING_RIGHT}px)`,
                  }
                : {
                    left: `${left}px`,
                  }),
            }}
          >
            <InlineGitBlame blameLine={blameLine} fontSize={fontSize} lineHeight={lineHeight} />
          </div>
        )}
      </div>
    );
  },
);

GitBlameLayerComponent.displayName = "GitBlameLayer";

export const GitBlameLayer = memo(GitBlameLayerComponent);
