import { memo } from "react";
import { cn } from "@/utils/cn";
import { groupLinesIntoHunks } from "../controllers/diff-helpers";
import { useDiffHighlighting } from "../controllers/use-diff-highlighting";
import { useDiffViewState } from "../controllers/use-diff-view-state";
import type { TextDiffViewerProps } from "../types/diff";
import { DiffHunkHeader } from "./diff-hunk-header";
import { DiffLine } from "./diff-line";

export const TextDiffViewer = memo(function TextDiffViewer({
  diff,
  isStaged,
  onStageHunk,
  onUnstageHunk,
  viewMode,
  showWhitespace,
  isInMultiFileView = false,
}: TextDiffViewerProps) {
  const { isHunkCollapsed, toggleHunkCollapse } = useDiffViewState();
  const tokenMap = useDiffHighlighting(diff.lines, diff.file_path);

  const hunks = groupLinesIntoHunks(diff.lines);
  const contextLines = diff.lines.filter((line) => line.line_type === "context").length;
  const addedLines = diff.lines.filter((line) => line.line_type === "added").length;
  const removedLines = diff.lines.filter((line) => line.line_type === "removed").length;

  if (hunks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="py-2 text-text-lighter text-xs">No changes to display</p>
        </div>
      </div>
    );
  }

  const diffContent = (
    <>
      {/* File path info for renames */}
      {diff.is_renamed && diff.old_path && diff.new_path && (
        <div className="border-border border-b bg-blue-500/10 px-4 py-2">
          <p className="text-blue-400 text-xs">
            Renamed from <span className="ui-font">{diff.old_path}</span> to{" "}
            <span className="ui-font">{diff.new_path}</span>
          </p>
        </div>
      )}

      {/* Diff Content */}
      <div
        className={cn("font-mono", !isInMultiFileView && "custom-scrollbar flex-1 overflow-y-auto")}
      >
        <div>
          {hunks.map((hunk) => (
            <div key={hunk.id} className="border-border border-b last:border-b-0">
              <DiffHunkHeader
                hunk={hunk}
                isCollapsed={isHunkCollapsed(hunk.id)}
                onToggleCollapse={() => toggleHunkCollapse(hunk.id)}
                isStaged={isStaged}
                filePath={diff.file_path}
                onStageHunk={onStageHunk}
                onUnstageHunk={onUnstageHunk}
                isInMultiFileView={isInMultiFileView}
              />
              {!isHunkCollapsed(hunk.id) && (
                <div className="bg-primary-bg">
                  {hunk.lines.map((line, index) => {
                    const globalIndex = diff.lines.indexOf(line);
                    return (
                      <DiffLine
                        key={`${hunk.id}-${index}`}
                        line={line}
                        index={index}
                        hunkId={hunk.id}
                        viewMode={viewMode}
                        showWhitespace={showWhitespace}
                        tokens={tokenMap.get(globalIndex)}
                      />
                    );
                  })}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Summary Footer */}
      {!isInMultiFileView && (
        <div className="border-border border-t bg-secondary-bg px-4 py-2">
          <div className={cn("flex items-center gap-4 text-text-lighter text-xs")}>
            <span>Total lines: {diff.lines.length}</span>
            {addedLines > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-green-500"></span>
                {addedLines} added
              </span>
            )}
            {removedLines > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-red-500"></span>
                {removedLines} removed
              </span>
            )}
            {contextLines > 0 && (
              <span className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-gray-500"></span>
                {contextLines} unchanged
              </span>
            )}
          </div>
        </div>
      )}
    </>
  );

  return diffContent;
});
