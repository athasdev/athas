import { memo } from "react";
import { EDITOR_CONSTANTS } from "@/constants/editor-constants";
import { useEditorCursorStore } from "@/stores/editor-cursor-store";
import { useEditorDecorationsStore } from "@/stores/editor-decorations-store";
import { useEditorInstanceStore } from "@/stores/editor-instance-store";
import { useEditorSettingsStore } from "@/stores/editor-settings-store";
import { useEditorViewStore } from "@/stores/editor-view-store";
import { useGitBlameStore } from "@/stores/git-blame-store";
import type { GitDiffLine } from "@/version-control/git/models/git-types";
import { InlineGitBlame } from "@/version-control/git/views/inline-git-blame";
import { LineGutter } from "./line-gutter";
import { LineRenderer } from "./line-renderer";

interface LineWithContentProps {
  lineNumber: number;
  bufferLineIndex?: number;
  content: string;
  diffLine?: GitDiffLine;
  isDiffOnly: boolean;
  showLineNumbers: boolean;
  gutterWidth: number;
  lineHeight: number;
  isSelected: boolean;
}

export const LineWithContent = memo<LineWithContentProps>(
  ({
    lineNumber,
    bufferLineIndex,
    content,
    diffLine,
    isDiffOnly,
    showLineNumbers,
    gutterWidth,
    lineHeight,
    isSelected,
  }) => {
    const tokens = useEditorViewStore((state) =>
      bufferLineIndex !== undefined ? (state.lineTokens.get(bufferLineIndex) ?? []) : [],
    );
    const decorations = useEditorDecorationsStore((state) =>
      bufferLineIndex !== undefined ? state.getDecorationsForLine(bufferLineIndex) : [],
    );
    const showInlineDiff = useEditorSettingsStore.use.showInlineDiff();
    const { line } = useEditorCursorStore((state) => state.cursorPosition);

    // Git blame functionality
    const { filePath } = useEditorInstanceStore();
    const { getBlameForLine } = useGitBlameStore();

    const blameLine =
      filePath && bufferLineIndex !== undefined ? getBlameForLine(filePath, bufferLineIndex) : null;
    const isSelectedLine = bufferLineIndex !== undefined && line === bufferLineIndex;

    // diffLine is now passed as a prop, so we don't need to find it

    // Determine CSS class based on diff line type
    const getDiffClassName = () => {
      if (!showInlineDiff || !diffLine) return "";

      switch (diffLine.line_type) {
        case "added":
          return "git-diff-line-added";
        case "removed":
          return "git-diff-line-removed";
        case "context":
          return ""; // No special styling for context lines
        default:
          return "";
      }
    };

    // Create diff decorations for the gutter
    // Inline diff should not create separate git gutter decorations; rely on global git gutter
    const diffDecorations: typeof decorations = [];

    // Combine existing decorations with diff decorations
    const allDecorations = [...decorations, ...diffDecorations];

    // Get line numbers for display
    const displayLineNumbers = showInlineDiff
      ? {
          old: undefined,
          new: isDiffOnly
            ? undefined // deleted (diff-only) lines show no line number
            : bufferLineIndex !== undefined
              ? bufferLineIndex + 1
              : undefined,
        }
      : {
          old: undefined,
          new: bufferLineIndex !== undefined ? bufferLineIndex + 1 : undefined,
        };
    const isDeleted = diffLine?.line_type === "removed";

    return (
      <div
        className={`editor-line-wrapper ${getDiffClassName()}`}
        style={{
          position: "absolute",
          top: `${lineNumber * lineHeight}px`,
          left: 0,
          right: 0,
          height: `${lineHeight}px`,
          display: "flex",
          overflow: "hidden",
        }}
      >
        <LineGutter
          lineNumber={bufferLineIndex ?? lineNumber}
          showLineNumbers={showLineNumbers}
          gutterWidth={showLineNumbers ? gutterWidth : 16}
          decorations={allDecorations}
          isDeleted={isDeleted}
          oldLineNumber={displayLineNumbers.old}
          newLineNumber={displayLineNumbers.new}
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
            overflow: "hidden",
            display: "flex",
            alignItems: "center",
            gap: "3rem",
          }}
        >
          <LineRenderer
            lineNumber={bufferLineIndex ?? lineNumber}
            content={content}
            tokens={tokens}
            decorations={allDecorations}
            isSelected={isSelected}
          />
          {isSelectedLine && blameLine && (
            <InlineGitBlame blameLine={blameLine} className="mr-4 ml-auto opacity-60" />
          )}
        </div>
      </div>
    );
  },
);

LineWithContent.displayName = "LineWithContent";
