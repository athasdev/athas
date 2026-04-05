import type { MouseEvent } from "react";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import { useSettingsStore } from "@/features/settings/store";
import Checkbox from "@/ui/checkbox";
import { cn } from "@/utils/cn";
import type { GitFile } from "../../types/git-types";

interface GitFileItemProps {
  file: GitFile;
  diffStats?: {
    additions: number;
    deletions: number;
  };
  onClick?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  onStage?: () => void;
  onUnstage?: () => void;
  disabled?: boolean;
  showDirectory?: boolean;
  showFileIcon?: boolean;
  indentLevel?: number;
  className?: string;
}

export const GitFileItem = ({
  file,
  diffStats,
  onClick,
  onContextMenu,
  onStage,
  onUnstage,
  disabled,
  showDirectory = true,
  showFileIcon = false,
  indentLevel = 0,
  className,
}: GitFileItemProps) => {
  const compactGitStatusBadges = useSettingsStore((state) => state.settings.compactGitStatusBadges);
  const pathParts = file.path.split("/");
  const fileName = pathParts.pop() || file.path;
  const directory = pathParts.join("/");
  const indentPx = 14 + indentLevel * 12;
  const hasDiffStats = !!diffStats && (diffStats.additions > 0 || diffStats.deletions > 0);

  return (
    <div
      className={cn(
        "ui-text-sm group relative mx-1 flex min-h-[22px] cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-hover",
        className,
      )}
      style={{ paddingLeft: `${indentPx}px`, paddingRight: "8px" }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {showFileIcon && (
        <FileExplorerIcon
          fileName={fileName}
          isDir={false}
          className="shrink-0 text-text-lighter"
          size={12}
        />
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden" title={file.path}>
        <span
          className={cn(
            "min-w-0 truncate leading-none",
            showDirectory ? "max-w-[55%]" : "flex-1",
            "text-text",
          )}
        >
          {fileName}
        </span>
        {showDirectory && directory && (
          <span className="ui-text-sm min-w-0 flex-1 truncate leading-none text-text-lighter/80">
            {directory}
          </span>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1.5">
        {hasDiffStats && (
          <div
            className={cn(
              "flex items-center leading-none",
              compactGitStatusBadges ? "ui-text-sm gap-0.5" : "ui-text-sm gap-1",
            )}
          >
            {diffStats.additions > 0 && (
              <span className="text-git-added">+{diffStats.additions}</span>
            )}
            {diffStats.deletions > 0 && (
              <span className="text-git-deleted">-{diffStats.deletions}</span>
            )}
          </div>
        )}
        <div
          className="shrink-0"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.stopPropagation()}
        >
          <Checkbox
            checked={file.staged}
            onChange={(checked) => {
              if (checked) {
                onStage?.();
                return;
              }
              onUnstage?.();
            }}
            disabled={disabled}
            ariaLabel={file.staged ? `Unstage ${fileName}` : `Stage ${fileName}`}
          />
        </div>
      </div>
    </div>
  );
};
