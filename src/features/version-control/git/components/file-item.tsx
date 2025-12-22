import { Minus, Plus, Trash2 } from "lucide-react";
import type { MouseEvent } from "react";
import { cn } from "@/utils/cn";
import type { GitFile } from "../types/git";
import { GitStatusDot } from "./status-dot";

interface GitFileItemProps {
  file: GitFile;
  onClick?: () => void;
  onContextMenu?: (e: MouseEvent) => void;
  onStage?: () => void;
  onUnstage?: () => void;
  onDiscard?: () => void;
  disabled?: boolean;
}

export const GitFileItem = ({
  file,
  onClick,
  onContextMenu,
  onStage,
  onUnstage,
  onDiscard,
  disabled,
}: GitFileItemProps) => {
  const fileName = file.path.split("/").pop() || file.path;

  return (
    <div
      className={cn("group flex cursor-pointer items-center gap-2", "px-3 py-1 hover:bg-hover")}
      onClick={onClick}
      onContextMenu={onContextMenu}
    >
      <GitStatusDot status={file.status} />
      <span className="flex-1 truncate text-[10px] text-text" title={file.path}>
        {fileName}
      </span>
      {file.staged && <span className="text-[8px] text-git-added opacity-60">staged</span>}
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
