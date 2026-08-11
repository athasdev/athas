import type { MouseEvent } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { writeSidebarResourceDragData } from "@/features/sidebar/utils/sidebar-resource-drag";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Checkbox } from "@/ui/checkbox";
import { SidebarTreeRow } from "@/features/sidebar/components/sidebar-tree";
import { cn } from "@/utils/cn";
import type { GitFile } from "../../types/git.types";

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
  reserveDisclosureSpace?: boolean;
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
  reserveDisclosureSpace = false,
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
      className={cn("group overflow-hidden", className)}
      onClick={onClick}
      onContextMenu={onContextMenu}
      reserveDisclosureSpace={reserveDisclosureSpace}
      label={fileName}
      description={showDirectory ? directory : undefined}
      leading={
        showFileIcon ? (
          <ThemedFileIcon fileName={fileName} isDir={false} className="text-subtle-foreground" />
        ) : null
      }
      trailing={
        hasDiffStats ? (
          <div
            className={cn(
              "flex max-w-19 shrink-0 items-center justify-end overflow-hidden leading-row tabular-nums",
              compactGitStatusBadges ? "ui-text-sm gap-0.5" : "ui-text-sm gap-1",
            )}
          >
            {diffStats.additions > 0 ? (
              <span className="shrink-0 text-git-added">+{diffStats.additions}</span>
            ) : null}
            {diffStats.deletions > 0 ? (
              <span className="shrink-0 text-git-deleted">-{diffStats.deletions}</span>
            ) : null}
          </div>
        ) : null
      }
      action={
        <Checkbox
          checked={file.staged}
          onCheckedChange={(checked) => {
            if (checked) {
              onStage?.();
              return;
            }
            onUnstage?.();
          }}
          disabled={disabled}
          aria-label={file.staged ? `Unstage ${fileName}` : `Stage ${fileName}`}
        />
      }
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
      title={file.path}
    />
  );
};
