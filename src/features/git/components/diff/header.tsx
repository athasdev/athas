import { Check, ChevronDown, ChevronUp, Columns2, Rows3, Trash2, X } from "lucide-react";
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

    const isMultiFileView = !!commitHash && !!totalFiles;

    return (
      <div
        className={cn(
          "ui-font sticky top-0 z-10 flex items-center justify-between border-border border-b",
          "bg-secondary-bg px-3 py-1.5 text-text text-xs",
        )}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {isMultiFileView ? (
            <>
              <span className="font-medium">{commitHash?.substring(0, 7)}</span>
              <span className="text-text-lighter">
                {totalFiles} file{totalFiles !== 1 ? "s" : ""}
              </span>
            </>
          ) : (
            <>
              <span className="truncate font-medium">{fileName}</span>
              {renderFileStatus()}
              <div className="flex items-center gap-2 text-[10px]">{renderStats()}</div>
            </>
          )}
        </div>

        <div className="flex items-center gap-1">
          {isMultiFileView && (
            <>
              <button
                onClick={onExpandAll}
                className="rounded p-1 text-text-lighter hover:bg-hover hover:text-text"
                title="Expand all"
                aria-label="Expand all files"
              >
                <ChevronDown size={14} />
              </button>
              <button
                onClick={onCollapseAll}
                className="rounded p-1 text-text-lighter hover:bg-hover hover:text-text"
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
              "flex items-center gap-1 rounded p-1",
              showWhitespace ? "text-text" : "text-text-lighter",
              "hover:bg-hover",
            )}
            title={showWhitespace ? "Hide whitespace" : "Show whitespace"}
            aria-label={showWhitespace ? "Hide whitespace" : "Show whitespace"}
          >
            <Trash2 size={12} />
            {showWhitespace && <Check size={10} />}
          </button>

          {onViewModeChange && (
            <div className="flex rounded border border-border">
              <button
                onClick={() => onViewModeChange("unified")}
                className={cn(
                  "rounded-l px-1.5 py-0.5 text-[10px]",
                  viewMode === "unified" ? "bg-accent text-white" : "text-text-lighter",
                )}
                title="Unified view"
                aria-label="Unified diff view"
              >
                <Rows3 size={12} />
              </button>
              <button
                onClick={() => onViewModeChange("split")}
                className={cn(
                  "rounded-r px-1.5 py-0.5 text-[10px]",
                  viewMode === "split" ? "bg-accent text-white" : "text-text-lighter",
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
            className="rounded p-1 text-text-lighter hover:bg-hover hover:text-text"
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
