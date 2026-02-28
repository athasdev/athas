import { Archive, Minus, Plus, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";
import { cn } from "@/utils/cn";
import type { GitFile } from "../../types/git";
import { GitStatusDot } from "./dot";

interface GitFileItemProps {
  file: GitFile;
  onClick?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  onStage?: () => void;
  onUnstage?: () => void;
  onDiscard?: () => void;
  onStash?: () => void;
  disabled?: boolean;
}

export const GitFileItem = ({
  file,
  onClick,
  onContextMenu,
  onStage,
  onUnstage,
  onDiscard,
  onStash,
  disabled,
}: GitFileItemProps) => {
  const pathParts = file.path.split("/");
  const fileName = pathParts.pop() || file.path;
  const directory = pathParts.join("/");

  return (
    <div
      className={cn(
        "group mx-1 mb-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-hover",
      )}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <GitStatusDot status={file.status} />
      <div className="flex min-w-0 flex-1 items-center gap-1.5" title={file.path}>
        <span className="shrink-0 text-[10px] text-text">{fileName}</span>
        {directory && <span className="truncate text-[9px] text-text-lighter">{directory}</span>}
      </div>
      {file.staged && <span className="shrink-0 text-[8px] text-git-added opacity-60">staged</span>}
      <div className="flex gap-0.5 opacity-0 group-hover:opacity-100">
        {file.staged ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onUnstage?.();
            }}
            disabled={disabled}
            className="p-0.5 text-text-lighter hover:text-text disabled:opacity-50"
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
              className="p-0.5 text-text-lighter hover:text-text disabled:opacity-50"
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
              className="p-0.5 text-text-lighter hover:text-text disabled:opacity-50"
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
                className="p-0.5 text-git-deleted hover:opacity-80 disabled:opacity-50"
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
