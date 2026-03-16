import {
  Check,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Columns2,
  Rows3,
  Trash2,
  X,
} from "lucide-react";
import { memo } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import { cn } from "@/utils/cn";
import type { DiffHeaderProps } from "../../types/git-diff-types";
import { getFileStatus } from "../../utils/git-diff-helpers";

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
    const iconButtonClass =
      "flex h-5 w-5 items-center justify-center rounded text-text-lighter transition-colors hover:bg-hover hover:text-text";
    const segmentedButtonClass =
      "flex h-5 w-5 items-center justify-center rounded text-text-lighter transition-colors hover:bg-hover hover:text-text";

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
        <span
          className={cn(
            "rounded px-1.5 py-0.5 font-medium text-[10px] capitalize leading-none",
            statusColors[status],
          )}
        >
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
        <div className="flex min-w-0 items-center gap-0.5 overflow-hidden" title={fullPath}>
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-text-lighter">
            <FileExplorerIcon
              fileName={pathSegments[pathSegments.length - 1] || fullPath}
              isDir={false}
              isExpanded={false}
              className="text-text-lighter"
            />
          </span>
          {visibleSegments.map((segment, index) => {
            const isLast = index === visibleSegments.length - 1;

            return (
              <div key={`${segment}-${index}`} className="flex min-w-0 items-center gap-0.5">
                {index > 0 && (
                  <ChevronRight size={10} className="mx-0.5 shrink-0 text-text-lighter" />
                )}
                <span
                  className={cn(
                    "truncate rounded px-1 py-0.5 text-xs",
                    isLast ? "font-medium text-text" : "text-text-lighter",
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
          "ui-font sticky top-0 z-10 flex min-h-7 select-none items-center justify-between border-border border-b",
          "bg-terniary-bg px-3 py-1 text-text text-xs",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-text-lighter text-xs">
          {isMultiFileView ? (
            <>
              <span className="rounded px-1.5 py-0.5 font-mono text-[11px] text-text">
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
                className={iconButtonClass}
                title="Expand all"
                aria-label="Expand all files"
              >
                <ChevronDown size={12} />
              </button>
              <button
                onClick={onCollapseAll}
                className={iconButtonClass}
                title="Collapse all"
                aria-label="Collapse all files"
              >
                <ChevronUp size={12} />
              </button>
              <div className="mx-1 h-4 w-px bg-border" />
            </>
          )}

          <button
            onClick={() => onShowWhitespaceChange?.(!showWhitespace)}
            className={cn(
              "flex h-5 items-center gap-1 rounded px-1.5 transition-colors hover:bg-hover hover:text-text",
              showWhitespace ? "bg-hover text-text" : "text-text-lighter",
            )}
            title={showWhitespace ? "Hide whitespace" : "Show whitespace"}
            aria-label={showWhitespace ? "Hide whitespace" : "Show whitespace"}
          >
            <Trash2 size={12} />
            {showWhitespace && <Check size={10} />}
          </button>

          {onViewModeChange && (
            <div className="flex items-center gap-0.5">
              <button
                onClick={() => onViewModeChange("unified")}
                className={cn(segmentedButtonClass, viewMode === "unified" && "bg-hover text-text")}
                title="Unified view"
                aria-label="Unified diff view"
              >
                <Rows3 size={12} />
              </button>
              <button
                onClick={() => onViewModeChange("split")}
                className={cn(segmentedButtonClass, viewMode === "split" && "bg-hover text-text")}
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
            className={iconButtonClass}
            title="Close"
            aria-label="Close diff view"
          >
            <X size={12} />
          </button>
        </div>
      </div>
    );
  },
);

DiffHeader.displayName = "DiffHeader";

export default DiffHeader;
