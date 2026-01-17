import { Archive, Check, ChevronDown, ChevronRight, FileText, Minus, Plus } from "lucide-react";
import type React from "react";
import { type RefObject, useMemo, useRef, useState } from "react";
import { useOnClickOutside } from "usehooks-ts";
import {
  createStash,
  discardFileChanges,
  stageAllFiles,
  stageFile,
  unstageAllFiles,
  unstageFile,
} from "@/features/version-control/git/controllers/git";
import type { GitFile } from "../types/git";
import { GitFileItem } from "./file-item";
import { StashMessageModal } from "./stash-message-modal";

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

const _STATUS_LABELS: Record<StatusGroup, string> = {
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
  const [isStagedCollapsed, setIsStagedCollapsed] = useState(false);
  const [isChangesCollapsed, setIsChangesCollapsed] = useState(false);

  // Stash modal state
  const [stashModal, setStashModal] = useState<{
    isOpen: boolean;
    type: "file" | "all";
    filePath?: string;
  }>({
    isOpen: false,
    type: "file",
  });

  const stagedFiles = useMemo(() => files.filter((f) => f.staged), [files]);
  const unstagedFiles = useMemo(() => files.filter((f) => !f.staged), [files]);

  // Group files by status
  const groupFiles = (files: GitFile[]) => {
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
  };

  const groupedStagedFiles = useMemo(() => groupFiles(stagedFiles), [stagedFiles]);
  const groupedUnstagedFiles = useMemo(() => groupFiles(unstagedFiles), [unstagedFiles]);

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

  const handleUnstageAll = async () => {
    if (!repoPath) return;
    setIsLoading(true);
    try {
      await unstageAllFiles(repoPath);
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

  const handleStashFile = async (filePath: string) => {
    setStashModal({
      isOpen: true,
      type: "file",
      filePath,
    });
  };

  const handleStashAllUnstaged = async () => {
    setStashModal({
      isOpen: true,
      type: "all",
    });
  };

  const handleConfirmStash = async (message: string) => {
    if (!repoPath) return;

    if (stashModal.type === "file" && stashModal.filePath) {
      await createStash(repoPath, message || `Stash ${stashModal.filePath}`, false, [
        stashModal.filePath,
      ]);
    } else if (stashModal.type === "all") {
      const paths = unstagedFiles.map((f) => f.path);
      if (paths.length === 0) return;

      await createStash(repoPath, message || "Stash all unstaged changes", false, paths);
    }

    onRefresh?.();
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

  const renderFileList = (groupedFiles: Record<StatusGroup, GitFile[]>) => {
    return STATUS_ORDER.map((status) => {
      const statusFiles = groupedFiles[status];
      if (statusFiles.length === 0) return null;

      return (
        <div key={status}>
          {statusFiles.map((file, index) => (
            <GitFileItem
              key={`${file.path}-${index}`}
              file={file}
              onClick={() => onFileSelect?.(file.path, file.staged)}
              onContextMenu={(e) => handleContextMenu(e, file.path, file.staged)}
              onStage={() => handleStageFile(file.path)}
              onUnstage={() => handleUnstageFile(file.path)}
              onDiscard={() => handleDiscardFile(file.path)}
              onStash={() => handleStashFile(file.path)}
              disabled={isLoading}
            />
          ))}
        </div>
      );
    });
  };

  return (
    <div className="select-none">
      {stagedFiles.length > 0 && (
        <div className="border-border border-b">
          <div
            className="flex cursor-pointer items-center gap-1 bg-secondary-bg px-3 py-1 text-text-lighter hover:bg-hover"
            onClick={() => setIsStagedCollapsed(!isStagedCollapsed)}
          >
            {isStagedCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
            <span className="font-bold text-[10px] uppercase tracking-wide">Staged Changes</span>
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              <span className="rounded-full bg-primary-bg px-1.5 text-[9px]">
                {stagedFiles.length}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleUnstageAll();
                }}
                disabled={isLoading}
                className="rounded p-0.5 text-text-lighter transition-colors hover:bg-primary-bg hover:text-text disabled:opacity-50"
                title="Unstage all"
                aria-label="Unstage all changes"
              >
                <Minus size={10} />
              </button>
            </div>
          </div>

          {!isStagedCollapsed && (
            <div className="bg-primary-bg">{renderFileList(groupedStagedFiles)}</div>
          )}
        </div>
      )}

      <div className="border-border border-b">
        <div
          className="flex cursor-pointer items-center gap-1 bg-secondary-bg px-3 py-1 text-text-lighter hover:bg-hover"
          onClick={() => setIsChangesCollapsed(!isChangesCollapsed)}
        >
          {isChangesCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          <span className="font-bold text-[10px] uppercase tracking-wide">Changes</span>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            {unstagedFiles.length > 0 && (
              <span className="rounded-full bg-primary-bg px-1.5 text-[9px]">
                {unstagedFiles.length}
              </span>
            )}
            {unstagedFiles.length > 0 && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStashAllUnstaged();
                  }}
                  disabled={isLoading}
                  className="rounded p-0.5 text-text-lighter transition-colors hover:bg-primary-bg hover:text-text disabled:opacity-50"
                  title="Stash all changes"
                  aria-label="Stash all unstaged changes"
                >
                  <Archive size={10} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleStageAll();
                  }}
                  disabled={isLoading}
                  className="rounded p-0.5 text-text-lighter transition-colors hover:bg-primary-bg hover:text-text disabled:opacity-50"
                  title="Stage all"
                  aria-label="Stage all changes"
                >
                  <Plus size={10} />
                </button>
              </>
            )}
          </div>
        </div>

        {!isChangesCollapsed && (
          <div className="bg-primary-bg">
            {unstagedFiles.length === 0
              ? stagedFiles.length === 0 && (
                  <div className="flex items-center gap-2 px-3 py-2 text-[10px] text-text-lighter">
                    <Check size={10} className="text-success" />
                    <span className="italic">No changes</span>
                  </div>
                )
              : renderFileList(groupedUnstagedFiles)}
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

      <StashMessageModal
        isOpen={stashModal.isOpen}
        onClose={() => setStashModal((prev) => ({ ...prev, isOpen: false }))}
        onConfirm={handleConfirmStash}
        title={stashModal.type === "file" ? "Stash File" : "Stash All Unstaged"}
        placeholder={
          stashModal.type === "file"
            ? `Message (default: Stash ${stashModal.filePath?.split("/").pop()})`
            : "Message (default: Stash all unstaged changes)"
        }
      />
    </div>
  );
};

export default GitStatusPanel;
