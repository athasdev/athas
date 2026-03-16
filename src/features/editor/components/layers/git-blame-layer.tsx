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

    // Calculate position only when we have valid data
    const shouldShowBlame = blameLine && lineContentWidth > 0;

    // Position at absolute content coordinates (scroll handled by container transform)
    const top = visualCursorLine * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;
    const left =
      lineContentWidth + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT + EDITOR_CONSTANTS.GUTTER_MARGIN;

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
          {currentLineContent}
        </span>

        {shouldShowBlame && (
          <div
            className="pointer-events-auto absolute flex items-center"
            style={{
              top: `${top}px`,
              left: `${left}px`,
              height: `${lineHeight}px`,
            }}
          >
            <InlineGitBlame blameLine={blameLine} />
          </div>
        )}
      </div>
    );
  },
);

GitBlameLayerComponent.displayName = "GitBlameLayer";

export const GitBlameLayer = memo(GitBlameLayerComponent);
