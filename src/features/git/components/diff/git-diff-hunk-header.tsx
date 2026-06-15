import {
  ArrowsInLineVerticalIcon as ArrowsInLineVertical,
  CaretDownIcon as ChevronDown,
  CaretRightIcon as ChevronRight,
  MinusIcon as Minus,
  PlusIcon as Plus,
} from "@phosphor-icons/react";
import { memo, useCallback } from "react";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { cn } from "@/utils/cn";
import { stageHunk, unstageHunk } from "../../api/git-status-api";
import type { DiffHunkHeaderProps } from "../../types/git-diff.types";
import { createGitHunk, parseDiffHunkRange } from "../../utils/git-diff-helpers";

const DiffHunkHeader = memo(
  ({
    hunk,
    hiddenLineCount,
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

    const headerInfo = parseDiffHunkRange(hunk.header.content);

    const canStage = !isInMultiFileView && rootFolderPath && filePath;
    const hiddenLabel =
      typeof hiddenLineCount === "number"
        ? `${hiddenLineCount} unchanged line${hiddenLineCount === 1 ? "" : "s"}`
        : "Changed lines";

    return (
      <div
        className={cn(
          "group grid cursor-pointer grid-cols-[5.5rem_minmax(0,1fr)] items-center",
          "border-border/70 border-b bg-primary-bg ui-text-sm leading-5 text-text-lighter",
        )}
        onClick={onToggleCollapse}
      >
        <div className="flex min-h-8 items-center justify-center text-text-lighter">
          <ArrowsInLineVertical size={18} />
        </div>

        <div className="flex min-w-0 items-center gap-3 pr-3">
          <div className="h-px flex-1 bg-border/70" />

          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <span className="flex size-5 items-center justify-center text-text-lighter">
              {isCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </span>
            <span className="whitespace-nowrap font-medium text-text-light">{hiddenLabel}</span>
            {headerInfo?.context ? (
              <span className="max-w-[24rem] truncate text-text-lighter">{headerInfo.context}</span>
            ) : null}
          </div>

          <div className="h-px flex-1 bg-border/70" />

          <div className="flex shrink-0 items-center gap-2">
            <div className="ui-text-xs flex items-center gap-1">
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
                {isStaged ? <Minus /> : <Plus />}
                <span className="ui-text-xs">{isStaged ? "Unstage" : "Stage"}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  },
);

DiffHunkHeader.displayName = "DiffHunkHeader";

export default DiffHunkHeader;
