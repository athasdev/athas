import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Minus,
  Plus,
  Trash2,
} from "lucide-react";
import type React from "react";
import { useEffect, useMemo, useState } from "react";
import { useSettingsStore } from "@/features/settings/store";
import { Button } from "@/ui/button";
import Checkbox from "@/ui/checkbox";
import { ContextMenu, useContextMenu } from "@/ui/context-menu";
import { createStash } from "../../api/git-stash-api";
import {
  discardFileChanges,
  stageAllFiles,
  stageFile,
  unstageAllFiles,
  unstageFile,
} from "../../api/git-status-api";
import type { GitFile } from "../../types/git-types";
import GitSidebarSectionHeader, {
  gitSidebarSectionActionButtonClassName,
} from "../git-sidebar-section-header";
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

const collectNodeFiles = (node: GitFolderNode): GitFile[] => [
  ...node.files,
  ...Array.from(node.folders.values()).flatMap((child) => collectNodeFiles(child)),
];

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
  const collapseEmptyGitSections = useSettingsStore(
    (state) => state.settings.collapseEmptyGitSections,
  );
  const contextMenu = useContextMenu<ContextMenuState>();
  const [isLoading, setIsLoading] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [optimisticStageMap, setOptimisticStageMap] = useState<Record<string, boolean>>({});

  const [stashModal, setStashModal] = useState<{
    isOpen: boolean;
    type: "file" | "all";
    filePath?: string;
  }>({
    isOpen: false,
    type: "file",
  });

  useEffect(() => {
    setOptimisticStageMap({});
  }, [files]);

  const displayFiles = useMemo(
    () =>
      files.map((file) => ({
        ...file,
        staged: optimisticStageMap[file.path] ?? file.staged,
      })),
    [files, optimisticStageMap],
  );
  const stagedFiles = useMemo(() => displayFiles.filter((f) => f.staged), [displayFiles]);
  const unstagedFiles = useMemo(() => displayFiles.filter((f) => !f.staged), [displayFiles]);
  const groupedAllFiles = useMemo(() => groupFilesByStatus(displayFiles), [displayFiles]);
  const getDiffStats = (file: GitFile) =>
    fileDiffStats?.[`staged:${file.path}`] ?? fileDiffStats?.[`unstaged:${file.path}`];

  const setOptimisticStage = (filePaths: string[], staged: boolean) => {
    setOptimisticStageMap((current) => {
      const next = { ...current };
      for (const filePath of filePaths) {
        next[filePath] = staged;
      }
      return next;
    });
  };

  const handleStageFile = async (filePath: string) => {
    if (!repoPath) return;
    setOptimisticStage([filePath], true);
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
    setOptimisticStage([filePath], false);
    setIsLoading(true);
    try {
      await unstageFile(repoPath, filePath);
      onRefresh?.();
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetFilesStaged = async (filePaths: string[], staged: boolean) => {
    if (!repoPath || filePaths.length === 0) return;

    setOptimisticStage(filePaths, staged);
    setIsLoading(true);
    try {
      await Promise.all(
        filePaths.map((filePath) =>
          staged ? stageFile(repoPath, filePath) : unstageFile(repoPath, filePath),
        ),
      );
      onRefresh?.();
    } finally {
      setIsLoading(false);
    }
  };

  const handleStageAll = async () => {
    if (!repoPath) return;
    setOptimisticStage(
      unstagedFiles.map((file) => file.path),
      true,
    );
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
    setOptimisticStage(
      stagedFiles.map((file) => file.path),
      false,
    );
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
              key={`${status}:${file.path}:${file.staged ? "staged" : "unstaged"}:${index}`}
              file={file}
              diffStats={getDiffStats(file)}
              onClick={() => onFileSelect?.(file.path, file.staged)}
              onContextMenu={(e) => handleContextMenu(e, file.path, file.staged)}
              onStage={() => handleStageFile(file.path)}
              onUnstage={() => handleUnstageFile(file.path)}
              disabled={isLoading}
              showFileIcon
            />
          ))}
        </div>
      );
    });
  };

  const renderSectionHeader = (title: string) => (
    <div className="ui-text-sm mx-1 mb-1 mt-2 flex items-center gap-2 px-2.5 py-1 text-text-lighter">
      <span>{title}</span>
    </div>
  );

  const renderFolderTree = (fileList: GitFile[], section: "changes") => {
    const rootNode = buildGitFolderTree(fileList);

    const renderNode = (node: GitFolderNode, depth: number): React.ReactNode => {
      const folderRows = sortFoldersByName(node.folders.values()).map((folderNode) => {
        const collapseKey = `${section}:${folderNode.fullPath}`;
        const isCollapsed = collapsedFolders.has(collapseKey);
        const paddingLeft = 14 + depth * 12;
        const folderFiles = collectNodeFiles(folderNode);
        const areAllFolderFilesStaged =
          folderFiles.length > 0 && folderFiles.every((file) => file.staged);

        return (
          <div key={folderNode.fullPath}>
            <Button
              type="button"
              onClick={() => toggleFolderCollapsed(section, folderNode.fullPath)}
              variant="ghost"
              className="ui-font ui-text-sm mx-1 flex min-h-[22px] h-auto w-[calc(100%-8px)] justify-start gap-1.5 rounded-md px-1.5 py-0.5 text-left text-text hover:bg-hover"
              style={{ paddingLeft: `${paddingLeft}px`, paddingRight: "8px" }}
            >
              {isCollapsed ? (
                <ChevronRight size={12} className="shrink-0 text-text-lighter" />
              ) : (
                <ChevronDown size={12} className="shrink-0 text-text-lighter" />
              )}
              <span className="truncate leading-none">{folderNode.name}</span>
              <div className="ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={areAllFolderFilesStaged}
                  onChange={(checked) =>
                    void handleSetFilesStaged(
                      folderFiles.map((file) => file.path),
                      checked,
                    )
                  }
                  disabled={isLoading || folderFiles.length === 0}
                  ariaLabel={
                    areAllFolderFilesStaged
                      ? `Unstage folder ${folderNode.name}`
                      : `Stage folder ${folderNode.name}`
                  }
                />
              </div>
            </Button>
            {!isCollapsed && renderNode(folderNode, depth + 1)}
          </div>
        );
      });

      const fileRows = sortFilesByPath(node.files).map((file) => (
        <GitFileItem
          key={`${section}:${file.path}:${file.staged ? "staged" : "unstaged"}:${file.status}`}
          file={file}
          diffStats={getDiffStats(file)}
          onClick={() => onFileSelect?.(file.path, file.staged)}
          onContextMenu={(e) => handleContextMenu(e, file.path, file.staged)}
          onStage={() => handleStageFile(file.path)}
          onUnstage={() => handleUnstageFile(file.path)}
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

  const hasFiles = files.length > 0;
  const trackedFiles = useMemo(
    () => displayFiles.filter((file) => file.status !== "untracked"),
    [displayFiles],
  );
  const untrackedFiles = useMemo(
    () => displayFiles.filter((file) => file.status === "untracked"),
    [displayFiles],
  );
  const groupedTrackedFiles = useMemo(
    () => ({
      ...createEmptyStatusGroups(),
      added: groupedAllFiles.added,
      modified: groupedAllFiles.modified,
      deleted: groupedAllFiles.deleted,
      renamed: groupedAllFiles.renamed,
    }),
    [groupedAllFiles],
  );
  const groupedUntrackedFiles = useMemo(
    () => ({
      ...createEmptyStatusGroups(),
      untracked: groupedAllFiles.untracked,
    }),
    [groupedAllFiles],
  );

  const contextMenuFile = useMemo(() => {
    if (!contextMenu.data) return null;
    return displayFiles.find((file) => file.path === contextMenu.data?.filePath) ?? null;
  }, [contextMenu.data, displayFiles]);
  const contextMenuData = contextMenu.data;

  return (
    <div className="flex h-full min-h-0 flex-col select-none">
      <div className="shrink-0 px-1 pb-1">
        <GitSidebarSectionHeader
          title="Changes"
          actions={
            <>
              {unstagedFiles.length > 0 && (
                <Button
                  onClick={handleStashAllUnstaged}
                  disabled={isLoading}
                  variant="ghost"
                  size="icon-sm"
                  className={gitSidebarSectionActionButtonClassName("disabled:opacity-50")}
                  tooltip="Stash all unstaged changes"
                  tooltipSide="bottom"
                  aria-label="Stash all unstaged changes"
                >
                  <Archive />
                </Button>
              )}
              {unstagedFiles.length > 0 && (
                <Button
                  onClick={handleStageAll}
                  disabled={isLoading}
                  variant="ghost"
                  size="icon-sm"
                  className={gitSidebarSectionActionButtonClassName("disabled:opacity-50")}
                  tooltip="Stage all changes"
                  tooltipSide="bottom"
                  aria-label="Stage all changes"
                >
                  <Plus />
                </Button>
              )}
              {stagedFiles.length > 0 && (
                <Button
                  onClick={handleUnstageAll}
                  disabled={isLoading}
                  variant="ghost"
                  size="icon-sm"
                  className={gitSidebarSectionActionButtonClassName("disabled:opacity-50")}
                  tooltip="Unstage all changes"
                  tooltipSide="bottom"
                  aria-label="Unstage all changes"
                >
                  <Minus />
                </Button>
              )}
            </>
          }
        />
      </div>

      {hasFiles ? (
        <div className="scrollbar-none min-h-0 flex-1 overflow-y-auto px-1 pb-1">
          {trackedFiles.length > 0 && (
            <>
              {renderSectionHeader("Tracked")}
              {gitChangesFolderView
                ? renderFolderTree(trackedFiles, "changes")
                : renderFlatFileList(groupedTrackedFiles)}
            </>
          )}
          {untrackedFiles.length > 0 && (
            <>
              {renderSectionHeader("Untracked")}
              {gitChangesFolderView
                ? renderFolderTree(untrackedFiles, "changes")
                : renderFlatFileList(groupedUntrackedFiles)}
            </>
          )}
        </div>
      ) : null}

      {collapseEmptyGitSections && !hasFiles && (
        <div className="ui-text-sm mx-1 flex items-center gap-2 rounded-lg border border-border/60 bg-primary-bg/55 px-3 py-2 text-text-lighter">
          <Check className="text-success" />
          <span className="italic">Working tree clean</span>
        </div>
      )}

      <ContextMenu
        isOpen={contextMenu.isOpen}
        position={contextMenu.position}
        items={
          contextMenuData
            ? [
                ...(onOpenFile
                  ? [
                      {
                        id: "open-file",
                        label: "Open File",
                        icon: <FileText />,
                        onClick: () => onOpenFile(contextMenuData.filePath),
                      },
                    ]
                  : []),
                ...(contextMenuData.isStaged
                  ? [
                      {
                        id: "unstage-file",
                        label: "Unstage File",
                        icon: <Minus />,
                        onClick: () => void handleUnstageFile(contextMenuData.filePath),
                      },
                    ]
                  : [
                      {
                        id: "stage-file",
                        label: "Stage File",
                        icon: <Plus />,
                        onClick: () => void handleStageFile(contextMenuData.filePath),
                      },
                      {
                        id: "stash-file",
                        label: "Stash File",
                        icon: <Archive />,
                        onClick: () => void handleStashFile(contextMenuData.filePath),
                      },
                    ]),
                ...(contextMenuFile && contextMenuFile.status !== "untracked"
                  ? [
                      {
                        id: "discard-file",
                        label: "Discard Changes",
                        icon: <Trash2 />,
                        onClick: () => void handleDiscardFile(contextMenuData.filePath),
                      },
                    ]
                  : []),
              ]
            : []
        }
        onClose={contextMenu.close}
      />

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
