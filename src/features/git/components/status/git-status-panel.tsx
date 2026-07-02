import {
  ArchiveIcon as Archive,
  CaretDownIcon as CaretDown,
  CaretRightIcon as CaretRight,
  CheckIcon as Check,
  FileTextIcon as FileText,
  MinusIcon as Minus,
  PlusIcon as Plus,
  TrashIcon as Trash2,
} from "@phosphor-icons/react";
import type React from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { writeSidebarResourceDragData } from "@/features/sidebar-drag/utils/sidebar-resource-drag";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import Badge from "@/ui/badge";
import Checkbox from "@/ui/checkbox";
import { ContextMenu, useContextMenu } from "@/ui/context-menu";
import { Dropdown, type MenuItem } from "@/ui/dropdown";
import { showConfirmDialog } from "@/features/dialogs/services/dialog-service";
import { SidebarEmptyActionState, SidebarHeaderIconButton } from "@/ui/sidebar";
import { SidebarTreeRow } from "@/features/sidebar-tree/components/sidebar-tree";
import { SplitActionButton } from "@/ui/split-action-button";
import { cn } from "@/utils/cn";
import { createStash } from "../../api/git-stash-api";
import {
  discardFileChanges,
  stageAllFiles,
  stageFile,
  unstageAllFiles,
  unstageFile,
} from "../../api/git-status-api";
import type { GitFile } from "../../types/git.types";
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
  onViewDiff?: (scope?: GitStatusDiffScope) => void;
  onShowCommitDiffPicker?: () => void;
  onShowBranchDiffPicker?: () => void;
  onShowStashDiffPicker?: () => void;
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
type StatusSection = "tracked" | "untracked";
type GitStatusDiffScope = "all" | "unstaged" | "staged";

const STATUS_ORDER: StatusGroup[] = ["added", "modified", "deleted", "renamed", "untracked"];
const SECTION_LABELS = {
  tracked: "Tracked",
  untracked: "Untracked",
} as const;

const createEmptyStatusGroups = (): Record<StatusGroup, GitFile[]> => ({
  added: [],
  modified: [],
  deleted: [],
  renamed: [],
  untracked: [],
});

interface GitFolderNode {
  name: string;
  fullPath: string;
  folders: Map<string, GitFolderNode>;
  files: GitFile[];
  descendantFiles: GitFile[];
  sortedFolders: GitFolderNode[];
  sortedFiles: GitFile[];
  descendantFilePaths: string[];
  areAllDescendantFilesStaged: boolean;
}

const createFolderNode = (name: string, fullPath: string): GitFolderNode => ({
  name,
  fullPath,
  folders: new Map<string, GitFolderNode>(),
  files: [],
  descendantFiles: [],
  sortedFolders: [],
  sortedFiles: [],
  descendantFilePaths: [],
  areAllDescendantFilesStaged: false,
});

const normalizePathSegments = (path: string): string[] =>
  path
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

function finalizeGitFolderTree(node: GitFolderNode): void {
  node.sortedFolders = Array.from(node.folders.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  node.sortedFiles = [...node.files].sort((a, b) => a.path.localeCompare(b.path));
  node.descendantFilePaths = node.descendantFiles.map((file) => file.path);
  node.areAllDescendantFilesStaged =
    node.descendantFiles.length > 0 && node.descendantFiles.every((file) => file.staged);

  for (const folderNode of node.sortedFolders) {
    finalizeGitFolderTree(folderNode);
  }
}

const buildGitFolderTree = (fileList: GitFile[]): GitFolderNode => {
  const root = createFolderNode("", "");

  for (const file of fileList) {
    const segments = normalizePathSegments(file.path);
    if (segments.length === 0) continue;

    let currentNode = root;
    currentNode.descendantFiles.push(file);
    let currentPath = "";
    const directorySegments = segments.slice(0, -1);
    for (const segment of directorySegments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      if (!currentNode.folders.has(segment)) {
        currentNode.folders.set(segment, createFolderNode(segment, currentPath));
      }
      currentNode = currentNode.folders.get(segment)!;
      currentNode.descendantFiles.push(file);
    }

    currentNode.files.push(file);
  }

  finalizeGitFolderTree(root);
  return root;
};

const GitStatusPanel = ({
  files,
  fileDiffStats,
  onFileSelect,
  onOpenFile,
  onViewDiff,
  onShowCommitDiffPicker,
  onShowBranchDiffPicker,
  onShowStashDiffPicker,
  onRefresh,
  repoPath,
}: GitStatusPanelProps) => {
  const gitChangesFolderView = useSettingsStore((state) => state.settings.gitChangesFolderView);
  const confirmBeforeDiscard = useSettingsStore((state) => state.settings.confirmBeforeDiscard);
  const contextMenu = useContextMenu<ContextMenuState>();
  const diffMenuAnchorRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isDiffMenuOpen, setIsDiffMenuOpen] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [collapsedSections, setCollapsedSections] = useState<Set<StatusSection>>(new Set());
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

  const displayFiles = useMemo(() => {
    if (Object.keys(optimisticStageMap).length === 0) {
      return files;
    }

    return files.map((file) => ({
      ...file,
      staged: optimisticStageMap[file.path] ?? file.staged,
    }));
  }, [files, optimisticStageMap]);
  const {
    stagedFiles,
    unstagedFiles,
    hasStagedDiffableFiles,
    hasUnstagedDiffableFiles,
    visibleFiles,
    displayFileByPath,
    trackedFiles,
    untrackedFiles,
    groupedTrackedFiles,
    groupedUntrackedFiles,
  } = useMemo(() => {
    const nextStagedFiles: GitFile[] = [];
    const nextUnstagedFiles: GitFile[] = [];
    const filesByPath = new Map<string, GitFile>();
    let nextHasStagedDiffableFiles = false;
    let nextHasUnstagedDiffableFiles = false;

    for (const file of displayFiles) {
      if (file.staged) {
        nextStagedFiles.push(file);
        nextHasStagedDiffableFiles ||= file.status !== "untracked";
      } else {
        nextUnstagedFiles.push(file);
        nextHasUnstagedDiffableFiles ||= file.status !== "untracked";
      }

      const existingFile = filesByPath.get(file.path);
      if (!existingFile || (!existingFile.staged && file.staged)) {
        filesByPath.set(file.path, file);
      }
    }

    const nextVisibleFiles: GitFile[] = [];
    const nextTrackedFiles: GitFile[] = [];
    const nextUntrackedFiles: GitFile[] = [];
    const nextGroupedTrackedFiles = createEmptyStatusGroups();
    const nextGroupedUntrackedFiles = createEmptyStatusGroups();

    for (const file of filesByPath.values()) {
      nextVisibleFiles.push(file);

      if (file.status === "untracked") {
        nextUntrackedFiles.push(file);
        nextGroupedUntrackedFiles.untracked.push(file);
      } else {
        nextTrackedFiles.push(file);
        nextGroupedTrackedFiles[file.status].push(file);
      }
    }

    return {
      stagedFiles: nextStagedFiles,
      unstagedFiles: nextUnstagedFiles,
      hasStagedDiffableFiles: nextHasStagedDiffableFiles,
      hasUnstagedDiffableFiles: nextHasUnstagedDiffableFiles,
      visibleFiles: nextVisibleFiles,
      displayFileByPath: filesByPath,
      trackedFiles: nextTrackedFiles,
      untrackedFiles: nextUntrackedFiles,
      groupedTrackedFiles: nextGroupedTrackedFiles,
      groupedUntrackedFiles: nextGroupedUntrackedFiles,
    };
  }, [displayFiles]);
  const getDiffStats = useCallback(
    (file: GitFile) => {
      const primaryKey = `${file.staged ? "staged" : "unstaged"}:${file.path}`;
      const fallbackKey = `${file.staged ? "unstaged" : "staged"}:${file.path}`;

      return fileDiffStats?.[primaryKey] ?? fileDiffStats?.[fallbackKey];
    },
    [fileDiffStats],
  );
  const allDiffStats = useMemo(
    () =>
      displayFiles.reduce(
        (totals, file) => {
          const stats = getDiffStats(file);
          return {
            additions: totals.additions + (stats?.additions ?? 0),
            deletions: totals.deletions + (stats?.deletions ?? 0),
          };
        },
        { additions: 0, deletions: 0 },
      ),
    [displayFiles, getDiffStats],
  );
  const trackedFolderTree = useMemo(
    () => (gitChangesFolderView ? buildGitFolderTree(trackedFiles) : null),
    [gitChangesFolderView, trackedFiles],
  );
  const untrackedFolderTree = useMemo(
    () => (gitChangesFolderView ? buildGitFolderTree(untrackedFiles) : null),
    [gitChangesFolderView, untrackedFiles],
  );

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
      !(await showConfirmDialog(`Discard changes for "${filePath}"? This cannot be undone.`, {
        title: "Discard File Changes",
        confirmLabel: "Discard",
      }))
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

  const toggleSectionCollapsed = (section: StatusSection) => {
    setCollapsedSections((previous) => {
      const next = new Set(previous);
      if (next.has(section)) {
        next.delete(section);
      } else {
        next.add(section);
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
              repoPath={repoPath}
            />
          ))}
        </div>
      );
    });
  };

  const renderDiffStatsBadge = (stats: GitFileDiffStats, className?: string) => (
    <Badge
      variant="default"
      size="compact"
      className={cn("h-5 gap-1 border-border/50 bg-hover/60 tabular-nums", className)}
    >
      <span className="text-git-added">+{stats.additions}</span>
      <span className="text-git-deleted">-{stats.deletions}</span>
    </Badge>
  );

  const renderSectionHeader = (section: StatusSection, title: string) => (
    <button
      type="button"
      className="ui-text-sm mt-2 flex w-full min-w-0 items-center justify-between gap-2 rounded-md px-2.5 py-1 text-left text-text-lighter transition-colors hover:bg-hover"
      onClick={() => toggleSectionCollapsed(section)}
      aria-expanded={!collapsedSections.has(section)}
    >
      <span className="min-w-0 truncate">{title}</span>
      <span className="flex shrink-0 items-center gap-1.5">
        {collapsedSections.has(section) ? (
          <CaretRight className="size-3 text-text-lighter" />
        ) : (
          <CaretDown className="size-3 text-text-lighter" />
        )}
      </span>
    </button>
  );

  const renderFolderTree = (rootNode: GitFolderNode, section: "changes") => {
    const renderNode = (node: GitFolderNode, depth: number): React.ReactNode => {
      const folderRows = node.sortedFolders.map((folderNode) => {
        const collapseKey = `${section}:${folderNode.fullPath}`;
        const isCollapsed = collapsedFolders.has(collapseKey);

        return (
          <Fragment key={folderNode.fullPath}>
            <SidebarTreeRow
              depth={depth}
              onClick={() => toggleFolderCollapsed(section, folderNode.fullPath)}
              className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center overflow-hidden leading-[1.35]"
              draggable={!!repoPath}
              onDragStart={(event) => {
                if (!repoPath) return;
                writeSidebarResourceDragData(event.dataTransfer, {
                  type: "file",
                  path: `${repoPath}/${folderNode.fullPath}`,
                  name: folderNode.name,
                  isDir: true,
                });
              }}
            >
              <ThemedFileIcon
                fileName={folderNode.name}
                isDir
                isExpanded={!isCollapsed}
                className="relative z-1 shrink-0 text-text-lighter"
              />
              <span className="relative z-1 block min-w-0 truncate whitespace-nowrap leading-[1.35]">
                {folderNode.name}
              </span>
              <div className="relative z-1 ml-auto shrink-0" onClick={(e) => e.stopPropagation()}>
                <Checkbox
                  checked={folderNode.areAllDescendantFilesStaged}
                  onChange={(checked) =>
                    void handleSetFilesStaged(folderNode.descendantFilePaths, checked)
                  }
                  disabled={isLoading || folderNode.descendantFilePaths.length === 0}
                  ariaLabel={
                    folderNode.areAllDescendantFilesStaged
                      ? `Unstage folder ${folderNode.name}`
                      : `Stage folder ${folderNode.name}`
                  }
                />
              </div>
            </SidebarTreeRow>
            {!isCollapsed ? renderNode(folderNode, depth + 1) : null}
          </Fragment>
        );
      });

      const fileRows = node.sortedFiles.map((file) => (
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
          repoPath={repoPath}
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

  const hasFiles = visibleFiles.length > 0;

  const contextMenuFile = useMemo(() => {
    if (!contextMenu.data) return null;
    return displayFileByPath.get(contextMenu.data.filePath) ?? null;
  }, [contextMenu.data, displayFileByPath]);
  const contextMenuData = contextMenu.data;
  const openScopedDiff = useCallback(
    (scope: GitStatusDiffScope) => {
      setIsDiffMenuOpen(false);
      onViewDiff?.(scope);
    },
    [onViewDiff],
  );
  const openDiffPicker = useCallback((handler: (() => void) | undefined) => {
    setIsDiffMenuOpen(false);
    handler?.();
  }, []);
  const diffMenuItems = useMemo<MenuItem[]>(
    () => [
      {
        id: "unstaged",
        label: "Unstaged",
        disabled: !hasUnstagedDiffableFiles || isLoading,
        onClick: () => openScopedDiff("unstaged"),
      },
      {
        id: "staged",
        label: "Staged",
        disabled: !hasStagedDiffableFiles || isLoading,
        onClick: () => openScopedDiff("staged"),
      },
      { id: "sep-working-tree", label: "", separator: true, onClick: () => {} },
      {
        id: "commit",
        label: "Commit",
        disabled: !onShowCommitDiffPicker,
        keybinding: <CaretRight className="size-3 text-text-lighter" />,
        onClick: () => openDiffPicker(onShowCommitDiffPicker),
      },
      {
        id: "branch",
        label: "Branch",
        disabled: !onShowBranchDiffPicker,
        keybinding: <CaretRight className="size-3 text-text-lighter" />,
        onClick: () => openDiffPicker(onShowBranchDiffPicker),
      },
      {
        id: "stash",
        label: "Stash",
        disabled: !onShowStashDiffPicker,
        keybinding: <CaretRight className="size-3 text-text-lighter" />,
        onClick: () => openDiffPicker(onShowStashDiffPicker),
      },
    ],
    [
      hasStagedDiffableFiles,
      hasUnstagedDiffableFiles,
      isLoading,
      onShowBranchDiffPicker,
      onShowCommitDiffPicker,
      onShowStashDiffPicker,
      openDiffPicker,
      openScopedDiff,
    ],
  );

  return (
    <div className="flex h-full min-h-0 flex-col select-none">
      {hasFiles ? (
        <>
          <div className="flex min-h-7 shrink-0 items-center justify-between gap-1.5 bg-primary-bg px-2.5 py-1">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <SplitActionButton
                ref={diffMenuAnchorRef}
                label="View Diff"
                actionAriaLabel="View all diffs"
                menuAriaLabel="Choose diff source"
                menuIcon={<CaretDown className="size-3" />}
                onAction={() => openScopedDiff("all")}
                onMenu={() => setIsDiffMenuOpen((open) => !open)}
                disabled={!onViewDiff || isLoading}
                menuDisabled={isLoading}
                active={isDiffMenuOpen}
                expanded={isDiffMenuOpen}
              />
              <Dropdown
                isOpen={isDiffMenuOpen}
                anchorRef={diffMenuAnchorRef}
                anchorAlign="start"
                onClose={() => setIsDiffMenuOpen(false)}
                items={diffMenuItems}
                className="min-w-[150px]"
              />
              {renderDiffStatsBadge(allDiffStats, "shrink-0")}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {unstagedFiles.length > 0 && (
                <SidebarHeaderIconButton
                  onClick={handleStashAllUnstaged}
                  disabled={isLoading}
                  className="disabled:opacity-50"
                  tooltip="Stash all unstaged changes"
                  tooltipSide="bottom"
                  aria-label="Stash all unstaged changes"
                >
                  <Archive />
                </SidebarHeaderIconButton>
              )}
              {unstagedFiles.length > 0 && (
                <SidebarHeaderIconButton
                  onClick={handleStageAll}
                  disabled={isLoading}
                  className="disabled:opacity-50"
                  tooltip="Stage all changes"
                  tooltipSide="bottom"
                  aria-label="Stage all changes"
                >
                  <Plus />
                </SidebarHeaderIconButton>
              )}
              {stagedFiles.length > 0 && (
                <SidebarHeaderIconButton
                  onClick={handleUnstageAll}
                  disabled={isLoading}
                  className="disabled:opacity-50"
                  tooltip="Unstage all changes"
                  tooltipSide="bottom"
                  aria-label="Unstage all changes"
                >
                  <Minus />
                </SidebarHeaderIconButton>
              )}
            </div>
          </div>
          <div className="scrollbar-none min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
            {trackedFiles.length > 0 && (
              <>
                {renderSectionHeader("tracked", SECTION_LABELS.tracked)}
                {!collapsedSections.has("tracked") &&
                  (gitChangesFolderView
                    ? trackedFolderTree && renderFolderTree(trackedFolderTree, "changes")
                    : renderFlatFileList(groupedTrackedFiles))}
              </>
            )}
            {untrackedFiles.length > 0 && (
              <>
                {renderSectionHeader("untracked", SECTION_LABELS.untracked)}
                {!collapsedSections.has("untracked") &&
                  (gitChangesFolderView
                    ? untrackedFolderTree && renderFolderTree(untrackedFolderTree, "changes")
                    : renderFlatFileList(groupedUntrackedFiles))}
              </>
            )}
          </div>
        </>
      ) : (
        <SidebarEmptyActionState
          className="min-h-24 flex-1"
          icon={<Check />}
          message="Working tree clean"
          tone="success"
        />
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
