import { FileIcon } from "lucide-react";
import { memo } from "react";
import { cn } from "../../utils/cn";
import { DiffHunkHeader } from "./diff-hunk-header";
import { DiffLine } from "./diff-line";
import { useDiffViewState } from "./hooks/useDiffViewState";
import { groupLinesIntoHunks } from "./utils/diff-helpers";
import type { TextDiffViewerProps } from "./utils/types";

export const TextDiffViewer = memo(function TextDiffViewer({
  diff,
  isStaged,
  onStageHunk,
  onUnstageHunk,
  viewMode,
  showWhitespace,
}: TextDiffViewerProps) {
  const { isHunkCollapsed, toggleHunkCollapse } = useDiffViewState();

  const hunks = groupLinesIntoHunks(diff.lines);
  const contextLines = diff.lines.filter((line) => line.line_type === "context").length;
  const addedLines = diff.lines.filter((line) => line.line_type === "added").length;
  const removedLines = diff.lines.filter((line) => line.line_type === "removed").length;

  if (hunks.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <FileIcon size={48} className="mx-auto mb-4 text-text-lighter opacity-50" />
          <p className="text-sm text-text-lighter">No changes to display</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* File path info for renames */}
      {diff.is_renamed && diff.old_path && diff.new_path && (
        <div className="border-border border-b bg-blue-500/10 px-4 py-2">
          <p className="text-blue-400 text-xs">
            Renamed from <span className="font-mono">{diff.old_path}</span> to{" "}
            <span className="font-mono">{diff.new_path}</span>
          </p>
        </div>
      )}

      {/* Diff Content */}
      <div className="custom-scrollbar flex-1 overflow-y-auto">
        <div className="font-mono">
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
              />
              {!isHunkCollapsed(hunk.id) && (
                <div className="bg-primary-bg">
                  {hunk.lines.map((line, index) => (
                    <DiffLine
                      key={`${hunk.id}-${index}`}
                      line={line}
                      index={index}
                      hunkId={hunk.id}
                      viewMode={viewMode}
                      showWhitespace={showWhitespace}
                    />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Summary Footer */}
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
    </>
  );
});
