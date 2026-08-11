import {
  ArchiveIcon as Archive,
  CaretDownIcon as CaretDown,
  CaretRightIcon as CaretRight,
  CheckIcon as Check,
  FileTextIcon as FileText,
  MinusIcon as Minus,
  PlusIcon as Plus,
  TrashIcon as Trash2,
} from "@/ui/icons";
import type React from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { writeSidebarResourceDragData } from "@/features/sidebar/utils/sidebar-resource-drag";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import Badge from "@/ui/badge";
import { Button } from "@/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/ui/button-group";
import { Checkbox } from "@/ui/checkbox";
import { Dropdown, useDropdownMenu, type MenuItem } from "@/ui/dropdown";
import { Empty, EmptyMedia, EmptyTitle } from "@/ui/empty";
import { ScrollArea } from "@/ui/scroll-area";
import { showConfirmDialog } from "@/ui/dialog";
import { SidebarHeaderIconButton, SidebarSectionHeader, SidebarToolbar } from "@/ui/sidebar";
import { SidebarTree, SidebarTreeRow } from "@/features/sidebar/components/sidebar-tree";
import { compactPathTreeBranch, type PathTreeNode } from "@/features/sidebar/lib/path-tree";
import { cn } from "@/utils/cn";
import { createStash } from "../../api/git-stash-api";
import {
  discardFileChanges,
  setFilesStaged,
  stageAllFiles,
  stageFile,
  unstageAllFiles,
  unstageFile,
} from "../../api/git-status-api";
import type { GitFile } from "../../types/git.types";
import {
  buildGitFolderTree,
  buildGitStatusPresentation,
  GIT_STATUS_ORDER,
  type GitFolderTree,
  type GitStatusGroup,
} from "../../utils/git-status-model";
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

type StatusSection = "tracked" | "untracked";
type GitStatusDiffScope = "all" | "unstaged" | "staged";

const SECTION_LABELS = {
  tracked: "Tracked",
  untracked: "Untracked",
} as const;

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
  const contextMenu = useDropdownMenu<ContextMenuState>();
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
  } = useMemo(() => buildGitStatusPresentation(displayFiles), [displayFiles]);
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
      const success = await stageFile(repoPath, filePath);
      if (!success) {
        setOptimisticStage([filePath], false);
        return;
      }
      await onRefresh?.();
    } finally {
      setIsLoading(false);
    }
  };

  const handleUnstageFile = async (filePath: string) => {
    if (!repoPath) return;
    setOptimisticStage([filePath], false);
    setIsLoading(true);
    try {
      const success = await unstageFile(repoPath, filePath);
      if (!success) {
        setOptimisticStage([filePath], true);
        return;
      }
      await onRefresh?.();
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetFilesStaged = async (filePaths: string[], staged: boolean) => {
    if (!repoPath || filePaths.length === 0) return;

    setOptimisticStage(filePaths, staged);
    setIsLoading(true);
    try {
      const results = await setFilesStaged(repoPath, filePaths, staged);
      const failedPaths = filePaths.filter((filePath) => !results.get(filePath));
      if (failedPaths.length > 0) {
        setOptimisticStage(failedPaths, !staged);
      }
      if (Array.from(results.values()).some(Boolean)) {
        await onRefresh?.();
      }
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
      const success = await stageAllFiles(repoPath);
      if (!success) {
        setOptimisticStage(
          unstagedFiles.map((file) => file.path),
          false,
        );
        return;
      }
      await onRefresh?.();
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
      const success = await unstageAllFiles(repoPath);
      if (!success) {
        setOptimisticStage(
          stagedFiles.map((file) => file.path),
          true,
        );
        return;
      }
      await onRefresh?.();
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
      const success = await discardFileChanges(repoPath, filePath);
      if (success) {
        await onRefresh?.();
      }
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

    await onRefresh?.();
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

  const renderFlatFileList = (groupedFiles: Record<GitStatusGroup, GitFile[]>) => {
    return GIT_STATUS_ORDER.map((status) => {
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
      className={cn("h-5 gap-1 border-border/50 bg-accent/60 tabular-nums", className)}
    >
      <span className="text-git-added">+{stats.additions}</span>
      <span className="text-git-deleted">-{stats.deletions}</span>
    </Badge>
  );

  const renderSectionHeader = (section: StatusSection, title: string, count: number) => (
    <SidebarSectionHeader
      variant="surface"
      count={count}
      expanded={!collapsedSections.has(section)}
      onToggle={() => toggleSectionCollapsed(section)}
    >
      {title}
    </SidebarSectionHeader>
  );

  const renderFolderTree = (tree: GitFolderTree, section: "changes") => {
    const renderNode = (node: PathTreeNode<GitFile>, depth: number): React.ReactNode => {
      if (node.type === "leaf") {
        const file = node.item;
        return (
          <GitFileItem
            key={node.id}
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
            reserveDisclosureSpace
            repoPath={repoPath}
          />
        );
      }

      const compacted = compactPathTreeBranch(node);
      const branch = compacted.branch;
      const collapseKey = `${section}:${branch.path}`;
      const isCollapsed = collapsedFolders.has(collapseKey);
      const folderState = tree.folderStateById.get(branch.id);
      if (!folderState) return null;

      return (
        <div key={node.id}>
          <SidebarTreeRow
            depth={depth}
            expanded={!isCollapsed}
            onToggle={() => toggleFolderCollapsed(section, branch.path)}
            onClick={() => toggleFolderCollapsed(section, branch.path)}
            label={compacted.label}
            leading={
              <ThemedFileIcon
                fileName={branch.name}
                isDir
                isExpanded={!isCollapsed}
                className="shrink-0 text-subtle-foreground"
              />
            }
            action={
              <Checkbox
                checked={folderState.areAllDescendantFilesStaged}
                onCheckedChange={(checked) =>
                  void handleSetFilesStaged(folderState.descendantFilePaths, checked)
                }
                disabled={isLoading || folderState.descendantFilePaths.length === 0}
                aria-label={
                  folderState.areAllDescendantFilesStaged
                    ? `Unstage folder ${compacted.label}`
                    : `Stage folder ${compacted.label}`
                }
              />
            }
            draggable={!!repoPath}
            onDragStart={(event) => {
              if (!repoPath) return;
              writeSidebarResourceDragData(event.dataTransfer, {
                type: "file",
                path: `${repoPath}/${branch.path}`,
                name: branch.name,
                isDir: true,
              });
            }}
            title={branch.path}
          />
          {!isCollapsed ? branch.children.map((child) => renderNode(child, depth + 1)) : null}
        </div>
      );
    };

    return tree.nodes.map((node) => renderNode(node, 0));
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
        keybinding: <CaretRight className="size-3 text-subtle-foreground" />,
        onClick: () => openDiffPicker(onShowCommitDiffPicker),
      },
      {
        id: "branch",
        label: "Branch",
        disabled: !onShowBranchDiffPicker,
        keybinding: <CaretRight className="size-3 text-subtle-foreground" />,
        onClick: () => openDiffPicker(onShowBranchDiffPicker),
      },
      {
        id: "stash",
        label: "Stash",
        disabled: !onShowStashDiffPicker,
        keybinding: <CaretRight className="size-3 text-subtle-foreground" />,
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
          <SidebarToolbar>
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <ButtonGroup ref={diffMenuAnchorRef}>
                <Button
                  type="button"
                  variant="default"
                  size="xs"
                  onClick={() => openScopedDiff("all")}
                  disabled={!onViewDiff || isLoading}
                  aria-label="View all diffs"
                >
                  View Diff
                </Button>
                <ButtonGroupSeparator />
                <Button
                  type="button"
                  variant="default"
                  size="icon-xs"
                  onClick={() => setIsDiffMenuOpen((open) => !open)}
                  disabled={isLoading}
                  active={isDiffMenuOpen}
                  aria-label="Choose diff source"
                  aria-haspopup="menu"
                  aria-expanded={isDiffMenuOpen}
                >
                  <CaretDown className="size-3" />
                </Button>
              </ButtonGroup>
              <Dropdown
                isOpen={isDiffMenuOpen}
                anchorRef={diffMenuAnchorRef}
                anchorAlign="start"
                onClose={() => setIsDiffMenuOpen(false)}
                items={diffMenuItems}
                className="min-w-37.5"
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
          </SidebarToolbar>
          <ScrollArea
            className="min-h-0 flex-1"
            contentClassName="px-2 py-2"
            reserveScrollbarGutter
          >
            {trackedFiles.length > 0 && (
              <section className="space-y-0.5">
                {renderSectionHeader("tracked", SECTION_LABELS.tracked, trackedFiles.length)}
                {!collapsedSections.has("tracked") ? (
                  <SidebarTree label="Tracked files">
                    {gitChangesFolderView
                      ? trackedFolderTree && renderFolderTree(trackedFolderTree, "changes")
                      : renderFlatFileList(groupedTrackedFiles)}
                  </SidebarTree>
                ) : null}
              </section>
            )}
            {untrackedFiles.length > 0 && (
              <section className="space-y-0.5 pt-2">
                {renderSectionHeader("untracked", SECTION_LABELS.untracked, untrackedFiles.length)}
                {!collapsedSections.has("untracked") ? (
                  <SidebarTree label="Untracked files">
                    {gitChangesFolderView
                      ? untrackedFolderTree && renderFolderTree(untrackedFolderTree, "changes")
                      : renderFlatFileList(groupedUntrackedFiles)}
                  </SidebarTree>
                ) : null}
              </section>
            )}
          </ScrollArea>
        </>
      ) : (
        <Empty className="flex-1" tone="success">
          <EmptyMedia variant="icon">
            <Check />
          </EmptyMedia>
          <EmptyTitle>Working tree clean</EmptyTitle>
        </Empty>
      )}

      <Dropdown
        isOpen={contextMenu.isOpen}
        point={contextMenu.position}
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
