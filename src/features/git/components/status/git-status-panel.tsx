import { Archive, Check, ChevronDown, ChevronRight, FileText, Minus, Plus } from "lucide-react";
import type React from "react";
import { useMemo, useState } from "react";
import { FileExplorerIcon } from "@/features/file-explorer/components/file-explorer-icon";
import { useSettingsStore } from "@/features/settings/store";
import { useContextMenu } from "@/hooks/use-context-menu";
import { ContextMenu } from "@/ui/context-menu";
import { createStash } from "../../api/git-stash-api";
import {
  discardFileChanges,
  stageAllFiles,
  stageFile,
  unstageAllFiles,
  unstageFile,
} from "../../api/git-status-api";
import type { GitFile } from "../../types/git-types";
import { StashMessageModal } from "../stash/git-stash-modal";
import { GitFileItem } from "./git-status-file-item";

interface GitFileDiffStats {
  additions: number;
  deletions: number;
}

interface GitStatusPanelProps {
  files: GitFile[];
  fileDiffStats?: Record<string, GitFileDiffStats>;
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

const createEmptyStatusGroups = (): Record<StatusGroup, GitFile[]> => ({
  added: [],
  modified: [],
  deleted: [],
  renamed: [],
  untracked: [],
});

const groupFilesByStatus = (fileList: GitFile[]) => {
  const groups = createEmptyStatusGroups();

  for (const file of fileList) {
    groups[file.status].push(file);
  }

  return groups;
};

interface GitFolderNode {
  name: string;
  fullPath: string;
  folders: Map<string, GitFolderNode>;
  files: GitFile[];
}

const createFolderNode = (name: string, fullPath: string): GitFolderNode => ({
  name,
  fullPath,
  folders: new Map<string, GitFolderNode>(),
  files: [],
});

const normalizePathSegments = (path: string): string[] =>
  path
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

const buildGitFolderTree = (fileList: GitFile[]): GitFolderNode => {
  const root = createFolderNode("", "");

  for (const file of fileList) {
    const segments = normalizePathSegments(file.path);
    if (segments.length === 0) continue;

    let currentNode = root;
    let currentPath = "";
    const directorySegments = segments.slice(0, -1);
    for (const segment of directorySegments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      if (!currentNode.folders.has(segment)) {
        currentNode.folders.set(segment, createFolderNode(segment, currentPath));
      }
      currentNode = currentNode.folders.get(segment)!;
    }

    currentNode.files.push(file);
  }

  return root;
};

const sortFoldersByName = (folders: Iterable<GitFolderNode>) =>
  Array.from(folders).sort((a, b) => a.name.localeCompare(b.name));

const sortFilesByPath = (fileList: GitFile[]) =>
  [...fileList].sort((a, b) => a.path.localeCompare(b.path));

const GitStatusPanel = ({
  files,
  fileDiffStats,
  onFileSelect,
  onOpenFile,
  onRefresh,
  repoPath,
}: GitStatusPanelProps) => {
  const gitChangesFolderView = useSettingsStore((state) => state.settings.gitChangesFolderView);
  const confirmBeforeDiscard = useSettingsStore((state) => state.settings.confirmBeforeDiscard);
  const showStagedFirst = useSettingsStore((state) => state.settings.showStagedFirst);
  const collapseEmptyGitSections = useSettingsStore(
    (state) => state.settings.collapseEmptyGitSections,
  );
  const contextMenu = useContextMenu<ContextMenuState>();
  const [isLoading, setIsLoading] = useState(false);
  const [isStagedCollapsed, setIsStagedCollapsed] = useState(true);
  const [isChangesCollapsed, setIsChangesCollapsed] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());

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
  const groupedStagedFiles = useMemo(() => groupFilesByStatus(stagedFiles), [stagedFiles]);
  const groupedUnstagedFiles = useMemo(() => groupFilesByStatus(unstagedFiles), [unstagedFiles]);
  const getDiffStats = (file: GitFile) =>
    fileDiffStats?.[`${file.staged ? "staged" : "unstaged"}:${file.path}`];

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
    if (
      confirmBeforeDiscard &&
      !window.confirm(`Discard changes for "${filePath}"? This cannot be undone.`)
    ) {
      return;
    }
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
    contextMenu.open(e, {
      x: e.clientX,
      y: e.clientY,
      filePath,
      isStaged,
    });
  };

  const toggleFolderCollapsed = (section: "changes", folderPath: string) => {
    const key = `${section}:${folderPath}`;
    setCollapsedFolders((previous) => {
      const next = new Set(previous);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const renderFlatFileList = (groupedFiles: Record<StatusGroup, GitFile[]>) => {
    return STATUS_ORDER.map((status) => {
      const statusFiles = groupedFiles[status];
      if (statusFiles.length === 0) return null;

      return (
        <div key={status}>
          {statusFiles.map((file, index) => (
            <GitFileItem
              key={`${file.path}-${index}`}
              file={file}
              diffStats={getDiffStats(file)}
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

  const renderFolderTree = (fileList: GitFile[], section: "changes") => {
    const rootNode = buildGitFolderTree(fileList);

    const renderNode = (node: GitFolderNode, depth: number): React.ReactNode => {
      const folderRows = sortFoldersByName(node.folders.values()).map((folderNode) => {
        const collapseKey = `${section}:${folderNode.fullPath}`;
        const isCollapsed = collapsedFolders.has(collapseKey);
        const paddingLeft = 8 + depth * 14;

        return (
          <div key={folderNode.fullPath}>
            <button
              type="button"
              onClick={() => toggleFolderCollapsed(section, folderNode.fullPath)}
              className="ui-font mx-1 mb-1 flex w-[calc(100%-8px)] items-center gap-1.5 rounded-lg py-1 text-left text-text text-xs hover:bg-hover"
              style={{ paddingLeft: `${paddingLeft}px`, paddingRight: "8px" }}
            >
              {isCollapsed ? (
                <ChevronRight size={10} className="shrink-0 text-text-lighter" />
              ) : (
                <ChevronDown size={10} className="shrink-0 text-text-lighter" />
              )}
              <FileExplorerIcon
                fileName={folderNode.name}
                isDir
                isExpanded={!isCollapsed}
                className="shrink-0 text-text-lighter"
                size={12}
              />
              <span className="truncate">{folderNode.name}</span>
            </button>
            {!isCollapsed && renderNode(folderNode, depth + 1)}
          </div>
        );
      });

      const fileRows = sortFilesByPath(node.files).map((file) => (
        <GitFileItem
          key={file.path}
          file={file}
          diffStats={getDiffStats(file)}
          onClick={() => onFileSelect?.(file.path, file.staged)}
          onContextMenu={(e) => handleContextMenu(e, file.path, file.staged)}
          onStage={() => handleStageFile(file.path)}
          onUnstage={() => handleUnstageFile(file.path)}
          onDiscard={() => handleDiscardFile(file.path)}
          onStash={() => handleStashFile(file.path)}
          disabled={isLoading}
          showDirectory={false}
          showFileIcon
          indentLevel={depth}
        />
      ));

      return (
        <>
          {folderRows}
          {fileRows}
        </>
      );
    };

    return renderNode(rootNode, 0);
  };

  const hasVisibleStagedFiles = stagedFiles.length > 0;
  const hasVisibleUnstagedFiles = unstagedFiles.length > 0;
  const shouldShowStagedSection = showStagedFirst
    ? hasVisibleStagedFiles || !collapseEmptyGitSections
    : hasVisibleStagedFiles;
  const shouldShowChangesSection = hasVisibleUnstagedFiles || !collapseEmptyGitSections;

  const renderStagedSection = (className?: string) => {
    if (!shouldShowStagedSection) return null;

    return (
      <div
        className={
          className ?? "overflow-hidden rounded-lg border border-border/60 bg-primary-bg/55"
        }
      >
        <div
          className="sticky top-0 z-20 flex cursor-pointer items-center gap-1 border-border/50 border-b bg-secondary-bg/90 px-2.5 py-1.5 text-text-lighter backdrop-blur-sm hover:bg-hover"
          onClick={() => setIsStagedCollapsed(!isStagedCollapsed)}
        >
          {isStagedCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
          <span className="font-bold text-[10px] uppercase tracking-wide">Staged Changes</span>
          <div className="flex-1" />
          <div className="flex items-center gap-1">
            {hasVisibleStagedFiles && (
              <span className="rounded-full bg-primary-bg px-1.5 text-[9px]">
                {stagedFiles.length}
              </span>
            )}
            {hasVisibleStagedFiles && (
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
            )}
          </div>
        </div>

        {!isStagedCollapsed && (
          <div className="bg-primary-bg/70 p-1">
            {hasVisibleStagedFiles ? (
              renderFlatFileList(groupedStagedFiles)
            ) : (
              <div className="flex items-center gap-2 px-2.5 py-2 text-[10px] text-text-lighter">
                <Check size={10} className="text-success" />
                <span className="italic">No staged changes</span>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="select-none p-1">
      {showStagedFirst &&
        renderStagedSection(
          "mb-2 overflow-hidden rounded-lg border border-border/60 bg-primary-bg/55",
        )}

      {shouldShowChangesSection && (
        <div className="overflow-hidden rounded-lg border border-border/60 bg-primary-bg/55">
          <div
            className="sticky top-0 z-20 flex cursor-pointer items-center gap-1 border-border/50 border-b bg-secondary-bg/90 px-2.5 py-1.5 text-text-lighter backdrop-blur-sm hover:bg-hover"
            onClick={() => setIsChangesCollapsed(!isChangesCollapsed)}
          >
            {isChangesCollapsed ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
            <span className="font-bold text-[10px] uppercase tracking-wide">Changes</span>
            <div className="flex-1" />
            <div className="flex items-center gap-1">
              {hasVisibleUnstagedFiles && (
                <span className="rounded-full bg-primary-bg px-1.5 text-[9px]">
                  {unstagedFiles.length}
                </span>
              )}
              {hasVisibleUnstagedFiles && (
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
            <div className="bg-primary-bg/70 p-1">
              {hasVisibleUnstagedFiles ? (
                gitChangesFolderView ? (
                  renderFolderTree(unstagedFiles, "changes")
                ) : (
                  renderFlatFileList(groupedUnstagedFiles)
                )
              ) : (
                <div className="flex items-center gap-2 px-2.5 py-2 text-[10px] text-text-lighter">
                  <Check size={10} className="text-success" />
                  <span className="italic">No changes</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!showStagedFirst &&
        renderStagedSection(
          "mt-2 overflow-hidden rounded-lg border border-border/60 bg-primary-bg/55",
        )}

      {collapseEmptyGitSections && !hasVisibleStagedFiles && !hasVisibleUnstagedFiles && (
        <div className="flex items-center gap-2 rounded-lg border border-border/60 bg-primary-bg/55 px-3 py-2 text-[10px] text-text-lighter">
          <Check size={10} className="text-success" />
          <span className="italic">Working tree clean</span>
        </div>
      )}

      {onOpenFile && (
        <ContextMenu
          isOpen={contextMenu.isOpen}
          position={contextMenu.position}
          items={
            contextMenu.data
              ? [
                  {
                    id: "open-file",
                    label: "Open File",
                    icon: <FileText size={12} />,
                    onClick: () => onOpenFile(contextMenu.data!.filePath),
                  },
                ]
              : []
          }
          onClose={contextMenu.close}
        />
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
