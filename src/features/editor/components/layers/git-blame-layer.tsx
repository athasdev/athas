import { forwardRef, memo, useMemo } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
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
}

const GitBlameLayerComponent = forwardRef<HTMLDivElement, GitBlameLayerProps>(
  (
    { filePath, cursorLine, visualCursorLine, visualContent, fontSize, fontFamily, lineHeight },
    ref,
  ) => {
    const { getBlameForLine } = useGitBlame(filePath);
    const blameLine = getBlameForLine(cursorLine);

    const lines = useMemo(() => splitLines(visualContent), [visualContent]);
    const currentLineContent = lines[visualCursorLine] || "";

    // Calculate pixel width of current line content for precise positioning
    const lineContentWidth = useMemo(() => {
      if (!currentLineContent) return 0;

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (context) {
        context.font = `${fontSize}px ${fontFamily}`;
        return context.measureText(currentLineContent).width;
      }

      // Fallback to approximation if canvas is not available
      return currentLineContent.length * fontSize * EDITOR_CONSTANTS.CHAR_WIDTH_MULTIPLIER;
    }, [currentLineContent, fontSize, fontFamily]);

    if (!blameLine) return null;

    return (
      <div
        className="git-blame-layer pointer-events-none absolute inset-0 overflow-hidden"
        style={{
          fontSize: `${fontSize}px`,
          fontFamily,
          lineHeight: `${lineHeight}px`,
        }}
      >
        <div
          ref={ref}
          style={{
            willChange: "transform",
            transform: "translateZ(0)",
          }}
        >
          <div
            className="pointer-events-auto absolute flex items-center"
            style={{
              top: `${visualCursorLine * lineHeight + EDITOR_CONSTANTS.EDITOR_PADDING_TOP}px`,
              left: `${lineContentWidth + EDITOR_CONSTANTS.EDITOR_PADDING_LEFT + 16}px`,
              height: `${lineHeight}px`,
            }}
          >
            <InlineGitBlame blameLine={blameLine} />
          </div>
        </div>
      </div>
    );
  },
);

GitBlameLayerComponent.displayName = "GitBlameLayer";

export const GitBlameLayer = memo(GitBlameLayerComponent);
