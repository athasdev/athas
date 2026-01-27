import { memo, useLayoutEffect, useMemo, useRef, useState } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { splitLines } from "@/features/editor/utils/lines";
import { InlineGitBlame } from "@/features/git/components/inline-blame";
import { useGitBlame } from "@/features/git/hooks/use-blame";

interface GitBlameLayerProps {
  filePath: string;
  cursorLine: number;
  visualCursorLine: number;
  visualContent: string;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  tabSize?: number;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
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
  textareaRef,
}: GitBlameLayerProps) => {
  // Subscribe to scroll state for reactivity
  const scrollTop = useEditorStateStore.use.scrollTop();
  const scrollLeft = useEditorStateStore.use.scrollLeft();

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

  // Calculate scroll ratio to compensate for browser rendering differences
  // (same approach as gutter component)
  const textarea = textareaRef.current;
  const totalLines = lines.length;
  const totalContentHeight = totalLines * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP * 2;
  const textareaScrollHeight = textarea?.scrollHeight ?? totalContentHeight;
  const scrollRatio = textareaScrollHeight > 0 ? totalContentHeight / textareaScrollHeight : 1;

  // Apply ratio to get adjusted scroll position
  const adjustedScrollTop = scrollTop * scrollRatio;

  // Position relative to viewport (subtract adjusted scroll to get viewport-relative position)
  const top =
    visualCursorLine * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP - adjustedScrollTop;
  const left =
    lineContentWidth +
    EDITOR_CONSTANTS.EDITOR_PADDING_LEFT +
    EDITOR_CONSTANTS.GUTTER_MARGIN -
    scrollLeft;

  return (
    <div
      className="git-blame-layer pointer-events-none absolute inset-0"
      style={{
        fontSize: `${fontSize}px`,
        fontFamily,
        lineHeight: `${lineHeight}px`,
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
};

GitBlameLayerComponent.displayName = "GitBlameLayer";

export const GitBlameLayer = memo(GitBlameLayerComponent);
