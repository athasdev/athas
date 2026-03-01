import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Columns2,
  FileText,
  Rows3,
  Trash2,
  X,
} from "lucide-react";
import { memo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { cn } from "@/utils/cn";
import type { DiffHeaderProps } from "../../types/diff";
import { getFileStatus } from "../../utils/diff-helpers";

const DiffHeader = memo(
  ({
    fileName,
    diff,
    viewMode,
    onViewModeChange,
    commitHash,
    totalFiles,
    onExpandAll,
    onCollapseAll,
    showWhitespace,
    onShowWhitespaceChange,
    onClose,
  }: DiffHeaderProps) => {
    const { closeBuffer } = useBufferStore.use.actions();
    const activeBufferId = useBufferStore.use.activeBufferId();

    const handleClose = () => {
      if (onClose) {
        onClose();
      } else if (activeBufferId) {
        closeBuffer(activeBufferId);
      }
    };

    const renderStats = () => {
      if (!diff) return null;

      let additions = 0;
      let deletions = 0;
      for (const l of diff.lines) {
        if (l.line_type === "added") additions++;
        else if (l.line_type === "removed") deletions++;
      }

      return (
        <>
          {additions > 0 && <span className="text-git-added">+{additions}</span>}
          {deletions > 0 && <span className="text-git-deleted">-{deletions}</span>}
        </>
      );
    };

    const renderFileStatus = () => {
      if (!diff) return null;

      const status = getFileStatus(diff);
      const statusColors: Record<string, string> = {
        added: "bg-git-added/20 text-git-added",
        deleted: "bg-git-deleted/20 text-git-deleted",
        modified: "bg-git-modified/20 text-git-modified",
        renamed: "bg-git-renamed/20 text-git-renamed",
      };

      return (
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] capitalize", statusColors[status])}>
          {status}
        </span>
      );
    };

    const renderFileBreadcrumb = () => {
      const fullPath = diff?.file_path || fileName || "";
      if (!fullPath) return null;

      const pathSegments = fullPath.split("/").filter(Boolean);
      const visibleSegments =
        pathSegments.length > 4 ? ["...", ...pathSegments.slice(-4)] : pathSegments;

      return (
        <div
          className="flex min-w-0 items-center gap-1.5 rounded-lg border border-border/70 bg-primary-bg/75 px-2.5 py-1"
          title={fullPath}
        >
          <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-secondary-bg/80 text-text-lighter">
            <FileText size={10} />
          </span>
          {visibleSegments.map((segment, index) => {
            const isLast = index === visibleSegments.length - 1;

            return (
              <div
                key={`${segment}-${index}`}
                className="flex min-w-0 items-center gap-1 text-[11px]"
              >
                {index > 0 && <ChevronRight size={11} className="shrink-0 text-text-lighter/70" />}
                <span
                  className={cn(
                    "truncate",
                    isLast ? "font-medium text-text" : "text-text-lighter/85",
                  )}
                >
                  {segment}
                </span>
              </div>
            );
          })}
        </div>
      );
    };

    const isMultiFileView = !!commitHash && !!totalFiles;

    return (
      <div
        className={cn(
          "ui-font sticky top-0 z-10 flex items-center justify-between border-border border-b",
          "bg-secondary-bg/95 px-3 py-1.5 text-text text-xs backdrop-blur-sm",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 leading-4">
          {isMultiFileView ? (
            <>
              <span className="rounded-md border border-border bg-primary-bg/70 px-1.5 py-0.5 font-mono text-[11px] text-text">
                {commitHash?.substring(0, 7)}
              </span>
              <span className="text-text-lighter">
                {totalFiles} file{totalFiles !== 1 ? "s" : ""}
              </span>
            </>
          ) : (
            <>
              {renderFileBreadcrumb()}
              {renderFileStatus()}
              <div className="flex items-center gap-2 text-[10px]">{renderStats()}</div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 leading-none">
          {isMultiFileView && (
            <>
              <button
                onClick={onExpandAll}
                className="rounded-md border border-transparent p-1 text-text-lighter hover:border-border hover:bg-hover hover:text-text"
                title="Expand all"
                aria-label="Expand all files"
              >
                <ChevronDown size={14} />
              </button>
              <button
                onClick={onCollapseAll}
                className="rounded-md border border-transparent p-1 text-text-lighter hover:border-border hover:bg-hover hover:text-text"
                title="Collapse all"
                aria-label="Collapse all files"
              >
                <ChevronUp size={14} />
              </button>
              <div className="mx-1 h-4 w-px bg-border" />
            </>
          )}

          <button
            onClick={() => onShowWhitespaceChange?.(!showWhitespace)}
            className={cn(
              "flex items-center gap-1 rounded-md border p-1",
              showWhitespace ? "border-accent/40 bg-accent/10 text-text" : "border-transparent",
              showWhitespace ? "text-text" : "text-text-lighter",
              "hover:border-border hover:bg-hover",
            )}
            title={showWhitespace ? "Hide whitespace" : "Show whitespace"}
            aria-label={showWhitespace ? "Hide whitespace" : "Show whitespace"}
          >
            <Trash2 size={12} />
            {showWhitespace && <Check size={10} />}
          </button>

          {onViewModeChange && (
            <div className="flex rounded-md border border-border bg-primary-bg/60">
              <button
                onClick={() => onViewModeChange("unified")}
                className={cn(
                  "rounded-l-md px-1.5 py-0.5 text-[10px]",
                  viewMode === "unified"
                    ? "bg-accent text-white"
                    : "text-text-lighter hover:bg-hover",
                )}
                title="Unified view"
                aria-label="Unified diff view"
              >
                <Rows3 size={12} />
              </button>
              <button
                onClick={() => onViewModeChange("split")}
                className={cn(
                  "rounded-r-md px-1.5 py-0.5 text-[10px]",
                  viewMode === "split"
                    ? "bg-accent text-white"
                    : "text-text-lighter hover:bg-hover",
                )}
                title="Split view"
                aria-label="Split diff view"
              >
                <Columns2 size={12} />
              </button>
            </div>
          )}

          <div className="mx-1 h-4 w-px bg-border" />

          <button
            onClick={handleClose}
            className="rounded-md border border-transparent p-1 text-text-lighter hover:border-border hover:bg-hover hover:text-text"
            title="Close"
            aria-label="Close diff view"
          >
            <X size={14} />
          </button>
        </div>
      </div>
    );
  },
);

DiffHeader.displayName = "DiffHeader";

export default DiffHeader;
