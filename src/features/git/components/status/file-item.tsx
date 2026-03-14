import { Archive, Minus, Plus, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";
import { FileIcon } from "@/features/file-explorer/components/file-icon";
import { useSettingsStore } from "@/features/settings/store";
import { cn } from "@/utils/cn";
import type { GitFile } from "../../types/git";

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
  onDiscard?: () => void;
  onStash?: () => void;
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
  onDiscard,
  onStash,
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
  const indentPx = 8 + indentLevel * 14;
  const fileNameTextClass = showDirectory ? "text-[10px]" : "text-xs";
  const hasDiffStats = !!diffStats && (diffStats.additions > 0 || diffStats.deletions > 0);
  const fileStatusTextClass =
    file.status === "modified"
      ? file.staged
        ? "text-git-modified-staged"
        : "text-git-modified"
      : file.status === "added"
        ? "text-git-added"
        : file.status === "deleted"
          ? "text-git-deleted"
          : file.status === "untracked"
            ? "text-git-untracked"
            : "text-git-renamed";

  return (
    <div
      className={cn(
        "group relative mx-1 mb-1 flex cursor-pointer items-center gap-2 rounded-lg py-1.5 hover:bg-hover",
        className,
      )}
      style={{ paddingLeft: `${indentPx}px`, paddingRight: "8px" }}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      {showFileIcon && (
        <FileIcon
          fileName={fileName}
          isDir={false}
          className="shrink-0 text-text-lighter"
          size={12}
        />
      )}
      <div className="flex min-w-0 flex-1 items-center gap-1.5" title={file.path}>
        <span className={cn("shrink-0", fileNameTextClass, fileStatusTextClass)}>{fileName}</span>
        {showDirectory && directory && (
          <span className="truncate text-[9px] text-text-lighter">{directory}</span>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {hasDiffStats && (
          <div
            className={cn(
              "hidden items-center leading-none sm:flex",
              compactGitStatusBadges ? "gap-0.5 text-[8px]" : "gap-1 text-[9px]",
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
        {file.staged && !compactGitStatusBadges && (
          <span className="hidden shrink-0 text-[8px] text-git-added opacity-60 md:inline">
            staged
          </span>
        )}
      </div>
      <div
        className={cn(
          "absolute top-1.5 right-1 z-10 flex gap-0.5 rounded-md border border-border/70 bg-secondary-bg/95 p-0.5 shadow-[0_8px_18px_-14px_rgba(0,0,0,0.65)] backdrop-blur-sm",
          "opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
        )}
      >
        {file.staged ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUnstage?.();
            }}
            disabled={disabled}
            className="rounded bg-primary-bg/70 p-0.5 text-text-lighter hover:bg-primary-bg hover:text-text disabled:opacity-50"
            title="Unstage"
            aria-label="Unstage file"
          >
            <Minus size={10} />
          </button>
        ) : (
          <>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStage?.();
              }}
              disabled={disabled}
              className="rounded bg-primary-bg/70 p-0.5 text-text-lighter hover:bg-primary-bg hover:text-text disabled:opacity-50"
              title="Stage"
              aria-label="Stage file"
            >
              <Plus size={10} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onStash?.();
              }}
              disabled={disabled}
              className="rounded bg-primary-bg/70 p-0.5 text-text-lighter hover:bg-primary-bg hover:text-text disabled:opacity-50"
              title="Stash file"
              aria-label="Stash file"
            >
              <Archive size={10} />
            </button>
            {file.status !== "untracked" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onDiscard?.();
                }}
                disabled={disabled}
                className="rounded bg-primary-bg/70 p-0.5 text-git-deleted hover:bg-git-deleted/10 hover:opacity-80 disabled:opacity-50"
                title="Discard changes"
                aria-label="Discard changes"
              >
                <Trash2 size={10} />
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
