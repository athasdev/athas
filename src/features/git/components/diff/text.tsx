import { memo, useMemo } from "react";
import { useDiffHighlighting } from "../../hooks/use-diff-highlight";
import type { TextDiffViewerProps } from "../../types/diff";
import { groupLinesIntoHunks } from "../../utils/diff-helpers";
import DiffHunkHeader from "./hunk-header";
import DiffLine from "./line";

const TextDiffViewer = memo(
  ({
    diff,
    isStaged,
    viewMode,
    showWhitespace,
    onStageHunk,
    onUnstageHunk,
    isInMultiFileView = false,
  }: TextDiffViewerProps) => {
    const hunks = useMemo(() => groupLinesIntoHunks(diff.lines), [diff.lines]);
    const tokenMap = useDiffHighlighting(diff.lines, diff.file_path);

    if (diff.lines.length === 0) {
      return (
        <div className="flex items-center justify-center py-8 text-text-lighter text-xs">
          No changes in this file
        </div>
      );
    }

    return (
      <div className="editor-font text-xs">
        {hunks.map((hunk) => (
          <div key={hunk.id}>
            <DiffHunkHeader
              hunk={hunk}
              isCollapsed={false}
              onToggleCollapse={() => {}}
              isStaged={isStaged}
              filePath={diff.file_path}
              onStageHunk={onStageHunk}
              onUnstageHunk={onUnstageHunk}
              isInMultiFileView={isInMultiFileView}
            />
            {hunk.lines.map((line, lineIndex) => (
              <DiffLine
                key={`${hunk.id}-${lineIndex}`}
                line={line}
                viewMode={viewMode}
                showWhitespace={showWhitespace}
                tokens={tokenMap.get(line.diffIndex)}
              />
            ))}
          </div>
        ))}
      </div>
    );
  },
);

TextDiffViewer.displayName = "TextDiffViewer";

export default TextDiffViewer;
