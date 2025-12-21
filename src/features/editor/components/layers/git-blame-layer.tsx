import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { splitLines } from "@/features/editor/utils/lines";
import { InlineGitBlame } from "@/features/version-control/git/components/inline-git-blame";
import { useGitBlame } from "@/features/version-control/git/controllers/use-git-blame";

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

const GitBlameLayerComponent = ({
  filePath,
  cursorLine,
  visualCursorLine,
  visualContent,
  fontSize,
  fontFamily,
  lineHeight,
  tabSize = 2,
}: GitBlameLayerProps) => {
  const scrollTop = useEditorStateStore.use.scrollTop();
  const scrollLeft = useEditorStateStore.use.scrollLeft();
  const { getBlameForLine } = useGitBlame(filePath);
  const blameLine = getBlameForLine(cursorLine);
  const measureRef = useRef<HTMLSpanElement>(null);
  const [lineContentWidth, setLineContentWidth] = useState(0);

  const lines = useMemo(() => splitLines(visualContent), [visualContent]);
  const currentLineContent = lines[visualCursorLine] || "";

  // Measure the actual rendered width using a hidden element
  useLayoutEffect(() => {
    if (measureRef.current) {
      setLineContentWidth(measureRef.current.offsetWidth);
    }
  }, [currentLineContent, fontSize, fontFamily, tabSize]);

  if (!blameLine) return null;

  // Position relative to content (same pattern as multi-cursor-layer)
  const top = visualCursorLine * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP;
  const left =
    lineContentWidth + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT + EDITOR_CONSTANTS.GUTTER_MARGIN;

  return (
    <div
      className="git-blame-layer pointer-events-none absolute inset-0 overflow-hidden"
      style={{
        fontSize: `${fontSize}px`,
        fontFamily,
        lineHeight: `${lineHeight}px`,
        // Use transform for scroll sync (same pattern as gutter and other layers)
        transform: `translate(${-scrollLeft}px, ${-scrollTop}px)`,
        willChange: "transform",
      }}
    >
      {/* Hidden element to measure actual text width */}
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
    </div>
  );
};

GitBlameLayerComponent.displayName = "GitBlameLayer";

export const GitBlameLayer = memo(GitBlameLayerComponent);
