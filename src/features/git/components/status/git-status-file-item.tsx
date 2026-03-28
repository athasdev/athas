import { Archive, Minus, Plus, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import { useSettingsStore } from "@/features/settings/store";
import { Button } from "@/ui/button";
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
  const indentPx = 14 + indentLevel * 20;
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
              "hidden items-center leading-none sm:flex",
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
        {file.staged && !compactGitStatusBadges && (
          <span className="ui-text-sm hidden shrink-0 text-git-added opacity-60 md:inline">
            staged
          </span>
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
      <div
        className={cn(
          "absolute top-0.5 right-1 z-10 flex gap-0.5 rounded-md border border-border/70 bg-secondary-bg/95 p-0.5 shadow-[0_8px_18px_-14px_rgba(0,0,0,0.65)] backdrop-blur-sm",
          "opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100",
        )}
      >
        {file.staged ? (
          <Button
            onClick={(e) => {
              e.stopPropagation();
              onUnstage?.();
            }}
            disabled={disabled}
            variant="ghost"
            size="icon-xs"
            className="bg-primary-bg/70 text-text-lighter hover:bg-primary-bg disabled:opacity-50"
            title="Unstage"
            aria-label="Unstage file"
          >
            <Minus />
          </Button>
        ) : (
          <>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onStage?.();
              }}
              disabled={disabled}
              variant="ghost"
              size="icon-xs"
              className="bg-primary-bg/70 text-text-lighter hover:bg-primary-bg disabled:opacity-50"
              title="Stage"
              aria-label="Stage file"
            >
              <Plus />
            </Button>
            <Button
              onClick={(e) => {
                e.stopPropagation();
                onStash?.();
              }}
              disabled={disabled}
              variant="ghost"
              size="icon-xs"
              className="bg-primary-bg/70 text-text-lighter hover:bg-primary-bg disabled:opacity-50"
              title="Stash file"
              aria-label="Stash file"
            >
              <Archive />
            </Button>
            {file.status !== "untracked" && (
              <Button
                onClick={(e) => {
                  e.stopPropagation();
                  onDiscard?.();
                }}
                disabled={disabled}
                variant="ghost"
                size="icon-xs"
                className="bg-primary-bg/70 text-git-deleted hover:bg-git-deleted/10 hover:text-git-deleted disabled:opacity-50"
                title="Discard changes"
                aria-label="Discard changes"
              >
                <Trash2 />
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
