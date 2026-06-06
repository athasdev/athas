import type { MouseEvent } from "react";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import { writeSidebarResourceDragData } from "@/features/sidebar-drag/sidebar-resource-drag";
import { useSettingsStore } from "@/features/settings/store";
import Checkbox from "@/ui/checkbox";
import {
  SIDEBAR_TREE_ICON_SIZE,
  SidebarTreeRow,
} from "@/features/sidebar-tree/components/sidebar-tree";
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
  repoPath?: string;
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
  repoPath,
}: GitFileItemProps) => {
  const compactGitStatusBadges = useSettingsStore((state) => state.settings.compactGitStatusBadges);
  const pathParts = file.path.split("/");
  const fileName = pathParts.pop() || file.path;
  const directory = pathParts.join("/");
  const hasDiffStats = !!diffStats && (diffStats.additions > 0 || diffStats.deletions > 0);

  return (
    <SidebarTreeRow
      depth={indentLevel}
      className={cn("group min-w-0 leading-[1.35]", className)}
      onClick={onClick}
      onContextMenu={onContextMenu}
      draggable={!!repoPath}
      onDragStart={(event) => {
        if (!repoPath) return;
        writeSidebarResourceDragData(event.dataTransfer, {
          type: "git-file-diff",
          repoPath,
          filePath: file.path,
          staged: file.staged,
          status: file.status,
          name: fileName,
        });
      }}
    >
      {showFileIcon && (
        <FileExplorerIcon
          fileName={fileName}
          isDir={false}
          className="relative z-1 shrink-0 text-text-lighter"
          size={SIDEBAR_TREE_ICON_SIZE}
        />
      )}
      <div
        className="relative z-1 flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
        title={file.path}
      >
        <span
          className={cn(
            "min-w-0 truncate leading-[1.35]",
            showDirectory ? "shrink-0 basis-auto max-w-[45%]" : "flex-1",
            "text-text",
          )}
        >
          {fileName}
        </span>
        {showDirectory && directory && (
          <span className="ui-text-sm min-w-0 flex-1 truncate leading-[1.35] text-text-lighter/80">
            {directory}
          </span>
        )}
      </div>
      <div className="relative z-1 ml-auto flex shrink-0 items-center gap-1.5">
        {hasDiffStats && (
          <div
            className={cn(
              "flex items-center leading-[1.35]",
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
    </SidebarTreeRow>
  );
};
