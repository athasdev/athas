import { ChevronDown, ChevronRight, Copy, Minus, Plus } from "lucide-react";
import { cn } from "@/utils/cn";
import { copyLineContent, createGitHunk } from "../controllers/diff-helpers";
import type { DiffHunkHeaderProps } from "../models/diff-types";

export function DiffHunkHeader({
  hunk,
  isCollapsed,
  onToggleCollapse,
  isStaged,
  filePath,
  onStageHunk,
  onUnstageHunk,
  isInMultiFileView = false,
}: DiffHunkHeaderProps) {
  const addedCount = hunk.lines.filter((l) => l.line_type === "added").length;
  const removedCount = hunk.lines.filter((l) => l.line_type === "removed").length;

  return (
    <div
      className={`sticky ${isInMultiFileView ? "top-8" : "top-0"} z-10 border-border border-y bg-secondary-bg`}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <div className="flex items-center gap-2">
          <button
            onClick={onToggleCollapse}
            className="text-text-lighter transition-colors hover:text-text"
          >
            {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
          </button>
          <span
            className={cn("rounded bg-blue-500/10 px-2 py-1", "font-mono text-blue-400 text-xs")}
          >
            {hunk.header.content}
          </span>
          <div className="flex items-center gap-2 text-xs">
            {removedCount > 0 && (
              <span className={cn("rounded bg-red-500/10 px-2 py-0.5", "text-red-400")}>
                -{removedCount}
              </span>
            )}
            {addedCount > 0 && (
              <span className={cn("rounded bg-green-500/10 px-2 py-0.5", "text-green-400")}>
                +{addedCount}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {(onStageHunk || onUnstageHunk) && (
            <>
              {!isStaged && onStageHunk && (
                <button
                  onClick={() => onStageHunk(createGitHunk(hunk, filePath))}
                  className={cn(
                    "flex items-center gap-1 rounded bg-green-500/20",
                    "px-2 py-1 text-green-400 text-xs transition-colors",
                    "hover:bg-green-500/30",
                  )}
                  title="Stage hunk"
                >
                  <Plus size={10} />
                  Stage
                </button>
              )}
              {isStaged && onUnstageHunk && (
                <button
                  onClick={() => onUnstageHunk(createGitHunk(hunk, filePath))}
                  className={cn(
                    "flex items-center gap-1 rounded bg-red-500/20",
                    "px-2 py-1 text-red-400 text-xs transition-colors",
                    "hover:bg-red-500/30",
                  )}
                  title="Unstage hunk"
                >
                  <Minus size={10} />
                  Unstage
                </button>
              )}
            </>
          )}
          <button
            onClick={() => copyLineContent(hunk.header.content)}
            className={cn(
              "rounded p-1 text-text-lighter transition-colors",
              "hover:bg-hover hover:text-text",
            )}
            title="Copy hunk header"
          >
            <Copy size={10} />
          </button>
        </div>
      </div>
    </div>
  );
}
