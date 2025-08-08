import { Edit3, Eye, EyeOff, FileIcon, FilePlus, FileX, Hash, X } from "lucide-react";
import { memo } from "react";
import { cn } from "@/utils/cn";
import { getFileStatus } from "./utils/diff-helpers";
import type { DiffHeaderProps } from "./utils/types";

export const DiffHeader = memo(function DiffHeader({
  fileName,
  diff,
  viewMode,
  showWhitespace,
  onViewModeChange,
  onShowWhitespaceChange,
  onClose,
  commitHash,
  totalFiles,
  onExpandAll,
  onCollapseAll,
}: DiffHeaderProps) {
  // Determine if this is single file mode or multi-file mode
  const isMultiFileMode = Boolean(commitHash && totalFiles !== undefined);

  const getFileIcon = () => {
    if (!diff) return null;
    if (diff.is_new) return <FilePlus size={14} className="text-green-500" />;
    if (diff.is_deleted) return <FileX size={14} className="text-red-500" />;
    if (diff.is_renamed) return <Edit3 size={14} className="text-blue-500" />;
    return <FileIcon size={14} className="text-text" />;
  };

  const renderLeftContent = () => {
    if (isMultiFileMode) {
      return (
        <div className="flex items-center gap-2">
          <Hash size={16} className="text-text-lighter" />
          <span className="font-medium text-sm text-text">
            Commit {commitHash!.substring(0, 7)}
          </span>
          <span className="text-text-lighter text-xs">
            ({totalFiles} file{totalFiles !== 1 ? "s" : ""})
          </span>
        </div>
      );
    }

    // Single file mode
    if (!diff) {
      return (
        <div className="flex items-center gap-2">
          <FileIcon size={14} className="text-text" />
          <h3 className="font-medium text-sm text-text">{fileName || "Diff Viewer"}</h3>
        </div>
      );
    }

    const addedLines = diff.lines.filter((line) => line.line_type === "added").length;
    const removedLines = diff.lines.filter((line) => line.line_type === "removed").length;
    const hunks = diff.lines.filter((line) => line.line_type === "header").length;

    const displayFileName = fileName || diff.file_path.split("/").pop() || diff.file_path;
    const shouldShowPath = commitHash && diff.file_path && diff.file_path.includes("/");
    const relativePath = shouldShowPath
      ? diff.file_path.substring(0, diff.file_path.lastIndexOf("/"))
      : null;

    return (
      <div className="flex items-center gap-2">
        {getFileIcon()}
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm text-text">{displayFileName}</h3>
            {relativePath && <span className="text-text-lighter text-xs">{relativePath}</span>}
          </div>
          <div className="flex items-center gap-3 text-text-lighter text-xs">
            <span className="capitalize">{getFileStatus(diff)}</span>
            {removedLines > 0 && (
              <span className="rounded bg-red-500/10 px-2 py-0.5 text-red-400">
                -{removedLines}
              </span>
            )}
            {addedLines > 0 && (
              <span className="rounded bg-green-500/10 px-2 py-0.5 text-green-400">
                +{addedLines}
              </span>
            )}
            {hunks > 0 && (
              <span className="text-text-lighter">
                {hunks} {hunks === 1 ? "hunk" : "hunks"}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderRightContent = () => {
    return (
      <div className="flex items-center gap-2">
        {/* Whitespace toggle - common to both modes */}
        <button
          onClick={() => onShowWhitespaceChange(!showWhitespace)}
          className={cn(
            "flex items-center justify-center gap-1 rounded px-2 py-1 text-xs transition-colors",
            showWhitespace
              ? "bg-blue-500/20 text-blue-400 hover:bg-blue-500/30"
              : "bg-hover text-text hover:bg-border",
          )}
          title={showWhitespace ? "Hide whitespace" : "Show whitespace"}
        >
          <div>{showWhitespace ? <Eye size={12} /> : <EyeOff size={12} />}</div>
          <span className="ml-1">Whitespace</span>
        </button>

        {/* Multi-file specific controls */}
        {isMultiFileMode && onExpandAll && onCollapseAll && (
          <>
            <button
              onClick={onExpandAll}
              className="rounded px-2 py-1 text-text-lighter text-xs hover:bg-hover hover:text-text"
            >
              Expand All
            </button>
            <button
              onClick={onCollapseAll}
              className="rounded px-2 py-1 text-text-lighter text-xs hover:bg-hover hover:text-text"
            >
              Collapse All
            </button>
          </>
        )}

        {/* Single file specific controls */}
        {!isMultiFileMode && viewMode && onViewModeChange && (
          <button
            onClick={() => onViewModeChange(viewMode === "unified" ? "split" : "unified")}
            className={cn(
              "rounded bg-hover px-2 py-1 text-text text-xs",
              "transition-colors hover:bg-border",
            )}
            title={`Switch to ${viewMode === "unified" ? "split" : "unified"} view`}
          >
            {viewMode === "unified" ? "Split" : "Unified"}
          </button>
        )}

        {/* Close button - optional for both modes */}
        {onClose && (
          <button
            onClick={onClose}
            className={cn("rounded p-1 text-text-lighter", "hover:bg-hover hover:text-text")}
            title="Close diff viewer"
          >
            <X size={14} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div
      className={cn(
        "flex items-center justify-between border-border",
        "border-b bg-secondary-bg px-4 py-2",
      )}
    >
      {renderLeftContent()}
      {renderRightContent()}
    </div>
  );
});
