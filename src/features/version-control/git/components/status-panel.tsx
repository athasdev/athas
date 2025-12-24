import { Check, FileText, Plus } from "lucide-react";
import type React from "react";
import { type RefObject, useMemo, useRef, useState } from "react";
import { useOnClickOutside } from "usehooks-ts";
import {
  discardFileChanges,
  stageAllFiles,
  stageFile,
  unstageFile,
} from "@/features/version-control/git/controllers/git";
import type { GitFile } from "../types/git";
import { GitFileItem } from "./file-item";

interface GitStatusPanelProps {
  files: GitFile[];
  onFileSelect?: (path: string, staged: boolean) => void;
  onOpenFile?: (path: string) => void;
  onRefresh?: () => void;
  repoPath?: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  filePath: string;
  isStaged: boolean;
}

type StatusGroup = "added" | "modified" | "deleted" | "renamed" | "untracked";

const STATUS_ORDER: StatusGroup[] = ["added", "modified", "deleted", "renamed", "untracked"];

const STATUS_LABELS: Record<StatusGroup, string> = {
  added: "Added",
  modified: "Modified",
  deleted: "Deleted",
  renamed: "Renamed",
  untracked: "Untracked",
};

const GitStatusPanel = ({
  files,
  onFileSelect,
  onOpenFile,
  onRefresh,
  repoPath,
}: GitStatusPanelProps) => {
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const stagedCount = files.filter((f) => f.staged).length;
  const unstagedCount = files.filter((f) => !f.staged).length;

  // Group files by status
  const groupedFiles = useMemo(() => {
    const groups: Record<StatusGroup, GitFile[]> = {
      added: [],
      modified: [],
      deleted: [],
      renamed: [],
      untracked: [],
    };

    for (const file of files) {
      if (groups[file.status]) {
        groups[file.status].push(file);
      }
    }

    return groups;
  }, [files]);

  const handleStageFile = async (filePath: string) => {
    if (!repoPath) return;
    setIsLoading(true);
    try {
      await stageFile(repoPath, filePath);
      onRefresh?.();
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnstageFile = async (filePath: string) => {
    if (!repoPath) return;
    setIsLoading(true);
    try {
      await unstageFile(repoPath, filePath);
      onRefresh?.();
    } finally {
      setIsLoading(false);
    }
  };

  const handleStageAll = async () => {
    if (!repoPath) return;
    setIsLoading(true);
    try {
      await stageAllFiles(repoPath);
      onRefresh?.();
    } finally {
      setIsLoading(false);
    }
  };

  const handleDiscardFile = async (filePath: string) => {
    if (!repoPath) return;
    setIsLoading(true);
    try {
      await discardFileChanges(repoPath, filePath);
      onRefresh?.();
    } finally {
      setIsLoading(false);
    }
  };

  const handleContextMenu = (e: React.MouseEvent, filePath: string, isStaged: boolean) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      filePath,
      isStaged,
    });
  };

  useOnClickOutside(contextMenuRef as RefObject<HTMLElement>, () => {
    setContextMenu(null);
  });

  const hasChanges = files.length > 0;

  return (
    <div className="select-none">
      {/* Changes Section Header */}
      <div className="border-border border-b">
        <div className="flex items-center gap-2 bg-secondary-bg px-3 py-1 text-text-lighter">
          <span className="cursor-default text-[10px]">
            changes ({files.length})
            {stagedCount > 0 && <span className="ml-1 text-git-added">{stagedCount} staged</span>}
          </span>
          <div className="flex-1" />
          {unstagedCount > 0 && (
            <button
              onClick={handleStageAll}
              disabled={isLoading}
              className="text-text-lighter transition-colors hover:text-text disabled:opacity-50"
              title="Stage all"
              aria-label="Stage all changes"
            >
              <Plus size={10} />
            </button>
          )}
        </div>

        {!hasChanges ? (
          <div className="flex items-center gap-2 bg-primary-bg px-3 py-2 text-[10px] text-text-lighter">
            <Check size={10} className="text-success" />
            <span className="italic">No changes</span>
          </div>
        ) : (
          <div className="bg-primary-bg">
            {STATUS_ORDER.map((status) => {
              const statusFiles = groupedFiles[status];
              if (statusFiles.length === 0) return null;

              return (
                <div key={status}>
                  {/* Status Group Header */}
                  <div className="px-3 py-0.5 text-[9px] text-text-lighter">
                    {STATUS_LABELS[status]} ({statusFiles.length})
                  </div>

                  {/* Files in this group */}
                  {statusFiles.map((file, index) => (
                    <GitFileItem
                      key={`${file.path}-${index}`}
                      file={file}
                      onClick={() => onFileSelect?.(file.path, file.staged)}
                      onContextMenu={(e) => handleContextMenu(e, file.path, file.staged)}
                      onStage={() => handleStageFile(file.path)}
                      onUnstage={() => handleUnstageFile(file.path)}
                      onDiscard={() => handleDiscardFile(file.path)}
                      disabled={isLoading}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Context Menu */}
      {contextMenu && onOpenFile && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[120px] rounded-md border border-border bg-secondary-bg py-1 shadow-lg"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
          }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              onOpenFile(contextMenu.filePath);
              setContextMenu(null);
            }}
            className="ui-font flex w-full items-center gap-2 px-3 py-1.5 text-left text-text text-xs hover:bg-hover"
          >
            <FileText size={12} />
            Open File
          </button>
        </div>
      )}
    </div>
  );
};

export default GitStatusPanel;
