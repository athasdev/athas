import { memo } from "react";
import { EDITOR_CONSTANTS } from "@/constants/editor-constants";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useEditorDecorationsStore } from "@/stores/editor-decorations-store";
import { useEditorInstanceStore } from "@/stores/editor-instance-store";
import { useEditorViewStore } from "@/stores/editor-view-store";
import { useGitBlameStore } from "@/stores/git-blame-store";
import { useVimStore } from "@/stores/vim-store";
import { InlineGitBlame } from "@/version-control/git/views/inline-git-blame";
import { LineGutter } from "./line-gutter";
import { LineRenderer } from "./line-renderer";

interface LineWithContentProps {
  lineNumber: number;
  showLineNumbers: boolean;
  gutterWidth: number;
  lineHeight: number;
  isSelected: boolean;
}

export const LineWithContent = memo<LineWithContentProps>(
  ({ lineNumber, showLineNumbers, gutterWidth, lineHeight, isSelected }) => {
    const content = useEditorViewStore((state) => state.lines[lineNumber]);
    const tokens = useEditorViewStore((state) => state.lineTokens.get(lineNumber)) ?? [];
    const decorations = useEditorDecorationsStore((state) =>
      state.getDecorationsForLine(lineNumber),
    );
    const cursorLine = useEditorCursorStore((state) => state.cursorPosition.line);
    const relativeLineNumbers = useVimStore.use.relativeLineNumbers();

    // Git blame functionality - only subscribe when this is the selected line
    const { filePath } = useEditorInstanceStore();
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
            isSelected={isSelected}
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
      prev.isSelected === next.isSelected
    );
  },
);

LineWithContent.displayName = "LineWithContent";
