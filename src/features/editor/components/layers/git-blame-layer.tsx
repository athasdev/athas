import { forwardRef, memo, useMemo } from "react";
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
              top: `${visualCursorLine * lineHeight + lineHeight / 3}px`,
              left: `${currentLineContent.length}ch`,
              height: `${lineHeight}px`,
              paddingLeft: "2rem",
              transform: "translateY(1px)",
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
