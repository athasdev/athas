import { Edit3, FileIcon, FilePlus, FileX, X } from "lucide-react";
import { cn } from "../../utils/cn";
import { getFileStatus } from "./utils/diff-helpers";
import type { DiffHeaderProps } from "./utils/types";

export const DiffHeader: React.FC<DiffHeaderProps> = ({
  fileName,
  diff,
  viewMode,
  onViewModeChange,
  onClose,
}) => {
  const getFileIcon = () => {
    if (diff.is_new) return <FilePlus size={14} className="text-green-500" />;
    if (diff.is_deleted) return <FileX size={14} className="text-red-500" />;
    if (diff.is_renamed) return <Edit3 size={14} className="text-blue-500" />;
    return <FileIcon size={14} className="text-text" />;
  };

  const addedLines = diff.lines.filter(line => line.line_type === "added").length;
  const removedLines = diff.lines.filter(line => line.line_type === "removed").length;
  const hunks = diff.lines.filter(line => line.line_type === "header").length;

  return (
    <div
      className={cn(
        "flex items-center justify-between border-border",
        "border-b bg-secondary-bg px-4 py-2",
      )}
    >
      <div className="flex items-center gap-2">
        {getFileIcon()}
        <div>
          <h3 className="font-medium text-sm text-text">{fileName || diff.file_path}</h3>
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
      <div className="flex items-center gap-2">
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
        <button
          onClick={onClose}
          className={cn("rounded p-1 text-text-lighter", "hover:bg-hover hover:text-text")}
          title="Close diff viewer"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
};
