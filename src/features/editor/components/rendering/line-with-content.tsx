import { memo } from "react";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { useEditorDecorationsStore } from "@/features/editor/stores/decorations-store";
import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorViewStore } from "@/features/editor/stores/view-store";
import { InlineGitBlame } from "@/features/version-control/git/components/inline-git-blame";
import { useVimStore } from "@/features/vim/stores/vim-store";
import { useGitBlameStore } from "@/stores/git-blame-store";
import { LineGutter } from "./gutter";
import { LineRenderer } from "./line-renderer";

interface LineWithContentProps {
  lineNumber: number;
  showLineNumbers: boolean;
  gutterWidth: number;
  lineHeight: number;
  onGitIndicatorClick?: (lineNumber: number, changeType: string) => void;
}

export const LineWithContent = memo<LineWithContentProps>(
  ({ lineNumber, showLineNumbers, gutterWidth, lineHeight, onGitIndicatorClick }) => {
    const content = useEditorViewStore((state) => state.lines[lineNumber]);
    const tokens = useEditorViewStore((state) => state.lineTokens.get(lineNumber)) ?? [];
    const decorations = useEditorDecorationsStore((state) =>
      state.getDecorationsForLine(lineNumber),
    );
    const cursorLine = useEditorStateStore((state) => state.cursorPosition.line);
    const relativeLineNumbers = useVimStore.use.relativeLineNumbers();

    // Git blame functionality - only subscribe when this is the selected line
    const { filePath } = useEditorStateStore();
    const isSelectedLine = cursorLine === lineNumber;

    // Only get blame info for the current line to avoid unnecessary lookups
    const { getBlameForLine } = useGitBlameStore();
    const blameLine = isSelectedLine && filePath ? getBlameForLine(filePath, lineNumber) : null;

    return (
      <div
        className="editor-line-wrapper"
        style={{
          position: "absolute",
          top: `${lineNumber * lineHeight}px`,
          left: 0,
          height: `${lineHeight}px`,
          display: "flex",
          overflow: "visible",
          minWidth: "100%",
        }}
      >
        <LineGutter
          lineNumber={lineNumber}
          showLineNumbers={showLineNumbers}
          gutterWidth={showLineNumbers ? gutterWidth : 16}
          decorations={decorations}
          cursorLine={cursorLine}
          relativeLineNumbers={relativeLineNumbers}
          onGitIndicatorClick={onGitIndicatorClick}
        />
        <div
          className="editor-line-content-wrapper"
          style={{
            flex: 1,
            paddingLeft: showLineNumbers
              ? `${EDITOR_CONSTANTS.GUTTER_MARGIN}px`
              : `${2 * EDITOR_CONSTANTS.GUTTER_MARGIN}px`,
            lineHeight: `${lineHeight}px`,
            height: `${lineHeight}px`,
            overflow: "visible",
            display: "flex",
            alignItems: "center",
            gap: "3rem",
          }}
        >
          <LineRenderer
            lineNumber={lineNumber}
            content={content}
            tokens={tokens}
            decorations={decorations}
          />
          {isSelectedLine && blameLine && (
            <InlineGitBlame blameLine={blameLine} className="mr-4 ml-auto opacity-60" />
          )}
        </div>
      </div>
    );
  },
  (prev, next) => {
    // Custom comparison function for better memoization
    return (
      prev.lineNumber === next.lineNumber &&
      prev.showLineNumbers === next.showLineNumbers &&
      prev.gutterWidth === next.gutterWidth &&
      prev.lineHeight === next.lineHeight &&
      prev.onGitIndicatorClick === next.onGitIndicatorClick
    );
  },
);

LineWithContent.displayName = "LineWithContent";
