import { ChevronDown, ChevronRight, Minus, Plus } from "lucide-react";
import { memo, useCallback } from "react";
import { useFileSystemStore } from "@/features/file-system/controllers/store";
import { cn } from "@/utils/cn";
import { stageHunk, unstageHunk } from "../../api/status";
import type { DiffHunkHeaderProps } from "../../types/diff";
import { createGitHunk } from "../../utils/diff-helpers";

const DiffHunkHeader = memo(
  ({
    hunk,
    isCollapsed,
    onToggleCollapse,
    isStaged,
    filePath,
    onStageHunk,
    onUnstageHunk,
    isInMultiFileView = false,
  }: DiffHunkHeaderProps) => {
    const { rootFolderPath } = useFileSystemStore();

    const handleStageHunk = useCallback(
      async (e: React.MouseEvent) => {
        e.stopPropagation();
        if (!rootFolderPath || !filePath) return;

        const gitHunk = createGitHunk(hunk, filePath);

        if (isStaged) {
          const success = await unstageHunk(rootFolderPath, gitHunk);
          if (success) {
            window.dispatchEvent(new CustomEvent("git-status-changed"));
            onUnstageHunk?.(gitHunk);
          }
        } else {
          const success = await stageHunk(rootFolderPath, gitHunk);
          if (success) {
            window.dispatchEvent(new CustomEvent("git-status-changed"));
            onStageHunk?.(gitHunk);
          }
        }
      },
      [rootFolderPath, filePath, hunk, isStaged, onStageHunk, onUnstageHunk],
    );

    let additions = 0;
    let deletions = 0;
    for (const l of hunk.lines) {
      if (l.line_type === "added") additions++;
      else if (l.line_type === "removed") deletions++;
    }

    const parseHunkHeader = (content: string) => {
      const match = content.match(/@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)/);
      if (!match) return { context: content };
      return {
        oldStart: match[1],
        oldCount: match[2] || "1",
        newStart: match[3],
        newCount: match[4] || "1",
        context: match[5]?.trim() || "",
      };
    };

    const headerInfo = parseHunkHeader(hunk.header.content);

    const canStage = !isInMultiFileView && rootFolderPath && filePath;

    return (
      <div
        className={cn(
          "group flex cursor-pointer items-center justify-between border-border border-b",
          "bg-primary-bg px-3 py-0.5 text-[11px] leading-4 hover:bg-hover",
        )}
        onClick={onToggleCollapse}
      >
        <div className="flex items-center gap-2">
          {isCollapsed ? (
            <ChevronRight size={12} className="text-text-lighter" />
          ) : (
            <ChevronDown size={12} className="text-text-lighter" />
          )}

          <span className="ui-font text-text-lighter">
            @@ -{headerInfo.oldStart},{headerInfo.oldCount} +{headerInfo.newStart},
            {headerInfo.newCount} @@
          </span>

          {headerInfo.context && (
            <span className="truncate text-text-light">{headerInfo.context}</span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 text-[10px]">
            {additions > 0 && <span className="text-git-added">+{additions}</span>}
            {deletions > 0 && <span className="text-git-deleted">-{deletions}</span>}
          </div>

          {canStage && (
            <button
              onClick={handleStageHunk}
              className={cn(
                "flex items-center gap-1 rounded px-1.5 py-0.5 opacity-0 group-hover:opacity-100",
                isStaged
                  ? "bg-git-deleted/20 text-git-deleted hover:bg-git-deleted/30"
                  : "bg-git-added/20 text-git-added hover:bg-git-added/30",
              )}
              title={isStaged ? "Unstage hunk" : "Stage hunk"}
              aria-label={isStaged ? "Unstage hunk" : "Stage hunk"}
            >
              {isStaged ? <Minus size={10} /> : <Plus size={10} />}
              <span className="text-[10px]">{isStaged ? "Unstage" : "Stage"}</span>
            </button>
          )}
        </div>
      </div>
    );
  },
);

DiffHunkHeader.displayName = "DiffHunkHeader";

export default DiffHunkHeader;
