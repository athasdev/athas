import isEqual from "fast-deep-equal";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronDownIcon,
  DotsIcon,
  FileTextIcon,
  ListIcon,
  MinusIcon,
  PlusIcon,
  SitemapIcon,
  TrashIcon,
} from "@/ui/icons";
import type React from "react";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { fuzzyScore } from "@/features/quick-open/utils/fuzzy-search";
import { writeSidebarResourceDragData } from "@/features/sidebar/utils/sidebar-resource-drag";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { NativeScrollArea } from "@/ui/scroll-area";
import { Button } from "@/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/ui/button-group";
import { Checkbox } from "@/ui/checkbox";
import { ContextMenuPopup, createContextMenuGroups } from "@/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItems,
  DropdownMenuTrigger,
  useDropdownMenu,
  type MenuItem,
} from "@/ui/dropdown";
import { EmptyState } from "@/ui/empty";
import { showConfirmDialog } from "@/ui/dialog";
import {
  SidebarFilterBar,
  SidebarIconButton,
  SidebarSectionHeader,
  SidebarToolbar,
} from "@/ui/sidebar";
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
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const [searchQuery, setSearchQuery] = useState("");
  const contextMenu = useDropdownMenu<ContextMenuState>();
  const diffMenuAnchorRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [expandedSections, setExpandedSections] = useState<StatusSection[]>([
    "tracked",
    "untracked",
  ]);
  const [optimisticStageMap, setOptimisticStageMap] = useState<Record<string, boolean>>({});
  const [pendingStagePaths, setPendingStagePaths] = useState<Set<string>>(new Set());
  const isStageLoading = pendingStagePaths.size > 0;

  const [stashModal, setStashModal] = useState<{
    isOpen: boolean;
    type: "file" | "all";
    filePath?: string;
  }>({
    isOpen: false,
    type: "file",
  });

  useEffect(() => {
    setOptimisticStageMap((current) => (Object.keys(current).length === 0 ? current : {}));
  }, [files]);

  const trimmedQuery = searchQuery.trim();
  const filteredFiles = useMemo(() => {
    if (!trimmedQuery) return files;
    return files.filter((item) => fuzzyScore(item.path, trimmedQuery) > 0);
  }, [files, trimmedQuery]);
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
  } = useMemo(() => buildGitStatusPresentation(filteredFiles), [filteredFiles]);
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
      files.reduce(
        (totals, file) => {
          const stats = getDiffStats(file);
          return {
            additions: totals.additions + (stats?.additions ?? 0),
            deletions: totals.deletions + (stats?.deletions ?? 0),
          };
        },
        { additions: 0, deletions: 0 },
      ),
    [files, getDiffStats],
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

  const setStagePending = (filePaths: string[], pending: boolean) => {
    setPendingStagePaths((current) => {
      const next = new Set(current);
      for (const filePath of filePaths) {
        if (pending) {
          next.add(filePath);
        } else {
          next.delete(filePath);
        }
      }
      return next;
    });
  };

  const getFileStaged = (file: GitFile) => optimisticStageMap[file.path] ?? file.staged;

  const handleStageFile = async (filePath: string) => {
    if (!repoPath) return;
    setOptimisticStage([filePath], true);
    setStagePending([filePath], true);
    try {
      const success = await stageFile(repoPath, filePath);
      if (!success) {
        setOptimisticStage([filePath], false);
      }
    } finally {
      setStagePending([filePath], false);
    }
  };

  const handleUnstageFile = async (filePath: string) => {
    if (!repoPath) return;
    setOptimisticStage([filePath], false);
    setStagePending([filePath], true);
    try {
      const success = await unstageFile(repoPath, filePath);
      if (!success) {
        setOptimisticStage([filePath], true);
      }
    } finally {
      setStagePending([filePath], false);
    }
  };

  const handleSetFilesStaged = async (filePaths: string[], staged: boolean) => {
    if (!repoPath || filePaths.length === 0) return;

    setOptimisticStage(filePaths, staged);
    setStagePending(filePaths, true);
    try {
      const results = await setFilesStaged(repoPath, filePaths, staged);
      const failedPaths = filePaths.filter((filePath) => !results.get(filePath));
      if (failedPaths.length > 0) {
        setOptimisticStage(failedPaths, !staged);
      }
    } finally {
      setStagePending(filePaths, false);
    }
  };

  const handleStageAll = async () => {
    if (!repoPath) return;
    const filePaths = unstagedFiles.map((file) => file.path);
    setOptimisticStage(filePaths, true);
    setStagePending(filePaths, true);
    try {
      const success = await stageAllFiles(repoPath);
      if (!success) {
        setOptimisticStage(filePaths, false);
      }
    } finally {
      setStagePending(filePaths, false);
    }
  };

  const handleUnstageAll = async () => {
    if (!repoPath) return;
    const filePaths = stagedFiles.map((file) => file.path);
    setOptimisticStage(filePaths, false);
    setStagePending(filePaths, true);
    try {
      const success = await unstageAllFiles(repoPath);
      if (!success) {
        setOptimisticStage(filePaths, true);
      }
    } finally {
      setStagePending(filePaths, false);
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

  const renderFlatFileList = (groupedFiles: Record<GitStatusGroup, GitFile[]>) => {
    return GIT_STATUS_ORDER.flatMap((status) =>
      groupedFiles[status].map((file) => (
        <GitFileItem
          key={file.path}
          file={file}
          diffStats={getDiffStats(file)}
          onClick={() => onFileSelect?.(file.path, getFileStaged(file))}
          onContextMenu={(e) => handleContextMenu(e, file.path, getFileStaged(file))}
          onStage={() => handleStageFile(file.path)}
          onUnstage={() => handleUnstageFile(file.path)}
          staged={getFileStaged(file)}
          disabled={isLoading || pendingStagePaths.has(file.path)}
          showFileIcon
          repoPath={repoPath}
        />
      )),
    );
  };

  const renderDiffStats = (stats: GitFileDiffStats, className?: string) => (
    <span
      className={cn(
        "ui-text-chrome flex items-center gap-1 font-mono tabular-nums leading-chrome",
        className,
      )}
    >
      <span className="text-git-added">+{stats.additions}</span>
      <span className="text-git-deleted">-{stats.deletions}</span>
    </span>
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
            onClick={() => onFileSelect?.(file.path, getFileStaged(file))}
            onContextMenu={(e) => handleContextMenu(e, file.path, getFileStaged(file))}
            onStage={() => handleStageFile(file.path)}
            onUnstage={() => handleUnstageFile(file.path)}
            staged={getFileStaged(file)}
            disabled={isLoading || pendingStagePaths.has(file.path)}
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
      const isFolderStaged = folderState.descendantFilePaths.every((filePath) => {
        const file = displayFileByPath.get(filePath);
        return optimisticStageMap[filePath] ?? file?.staged ?? false;
      });
      const isFolderPending = folderState.descendantFilePaths.some((filePath) =>
        pendingStagePaths.has(filePath),
      );

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
                size="sm"
                checked={isFolderStaged}
                onCheckedChange={(checked) =>
                  void handleSetFilesStaged(folderState.descendantFilePaths, checked)
                }
                disabled={
                  isLoading || isFolderPending || folderState.descendantFilePaths.length === 0
                }
                aria-label={
                  isFolderStaged
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

  const hasFiles = files.length > 0;
  const hasVisibleFiles = visibleFiles.length > 0;
  const toggleSection = (section: StatusSection) => {
    setExpandedSections((current) =>
      current.includes(section)
        ? current.filter((item) => item !== section)
        : [...current, section],
    );
  };
  const renderSection = (
    section: StatusSection,
    sectionFiles: GitFile[],
    folderTree: GitFolderTree | null,
    groupedFiles: Record<GitStatusGroup, GitFile[]>,
  ) => {
    if (sectionFiles.length === 0) return null;
    const expanded = expandedSections.includes(section);

    return (
      <section data-slot="git-status-section" className="min-w-0">
        <SidebarSectionHeader
          expanded={expanded}
          onToggle={() => toggleSection(section)}
          action={
            <span className="pr-1.5 tabular-nums ui-text-sm text-subtle-foreground">
              {sectionFiles.length}
            </span>
          }
        >
          {SECTION_LABELS[section]}
        </SidebarSectionHeader>
        {expanded ? (
          <SidebarTree label={`${SECTION_LABELS[section]} files`}>
            {gitChangesFolderView
              ? folderTree && renderFolderTree(folderTree, "changes")
              : renderFlatFileList(groupedFiles)}
          </SidebarTree>
        ) : null}
      </section>
    );
  };

  const contextMenuFile = useMemo(() => {
    if (!contextMenu.data) return null;
    return displayFileByPath.get(contextMenu.data.filePath) ?? null;
  }, [contextMenu.data, displayFileByPath]);
  const contextMenuData = contextMenu.data;
  const openScopedDiff = useCallback(
    (scope: GitStatusDiffScope) => {
      onViewDiff?.(scope);
    },
    [onViewDiff],
  );
  const openDiffPicker = useCallback((handler: (() => void) | undefined) => {
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
      { id: "sep-working-tree", separator: true },
      {
        id: "commit",
        label: "Commit",
        disabled: !onShowCommitDiffPicker,
        trailing: "disclosure",
        onClick: () => openDiffPicker(onShowCommitDiffPicker),
      },
      {
        id: "branch",
        label: "Branch",
        disabled: !onShowBranchDiffPicker,
        trailing: "disclosure",
        onClick: () => openDiffPicker(onShowBranchDiffPicker),
      },
      {
        id: "stash",
        label: "Stash",
        disabled: !onShowStashDiffPicker,
        trailing: "disclosure",
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
          <SidebarFilterBar
            value={searchQuery}
            onChange={setSearchQuery}
            aria-label="Filter changed files"
            placeholder="Filter changes"
            actionsLabel="Changed files view"
            actions={
              <>
                <SidebarIconButton
                  active={!gitChangesFolderView}
                  onClick={() => void updateSetting("gitChangesFolderView", false)}
                  tooltip="Flat list"
                  aria-label="Flat list"
                >
                  <ListIcon />
                </SidebarIconButton>
                <SidebarIconButton
                  active={gitChangesFolderView}
                  onClick={() => void updateSetting("gitChangesFolderView", true)}
                  tooltip="File tree"
                  aria-label="File tree"
                >
                  <SitemapIcon />
                </SidebarIconButton>
              </>
            }
          />
          <NativeScrollArea
            fill="flex"
            role="region"
            aria-label="Changed files"
            className="px-chrome-inline pb-2"
          >
            {hasVisibleFiles ? (
              <div className="flex min-w-0 flex-col">
                {renderSection("tracked", trackedFiles, trackedFolderTree, groupedTrackedFiles)}
                {renderSection(
                  "untracked",
                  untrackedFiles,
                  untrackedFolderTree,
                  groupedUntrackedFiles,
                )}
              </div>
            ) : (
              <EmptyState layout="sidebar" message="No changed files match" />
            )}
          </NativeScrollArea>
          <SidebarToolbar position="bottom" className="@container/git-status-toolbar">
            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <ButtonGroup ref={diffMenuAnchorRef}>
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  onClick={() => openScopedDiff("all")}
                  disabled={!onViewDiff || isLoading}
                  aria-label="View all diffs"
                >
                  View Diff
                </Button>
                <ButtonGroupSeparator />
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        type="button"
                        variant="default"
                        size="sm"
                        iconOnly
                        disabled={isLoading}
                        aria-label="Choose diff source"
                      />
                    }
                  >
                    <ChevronDownIcon className="size-3" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    anchor={diffMenuAnchorRef}
                    side="top"
                    align="start"
                    size="compact"
                  >
                    <DropdownMenuItems items={diffMenuItems} />
                  </DropdownMenuContent>
                </DropdownMenu>
              </ButtonGroup>
              {renderDiffStats(allDiffStats, "shrink-0 @max-[230px]/git-status-toolbar:hidden")}
            </div>
            <div className="flex shrink-0 items-center gap-1 @max-[300px]/git-status-toolbar:hidden">
              {unstagedFiles.length > 0 && (
                <SidebarIconButton
                  onClick={handleStashAllUnstaged}
                  disabled={isLoading}
                  tooltip="Stash all unstaged changes"
                  aria-label="Stash all unstaged changes"
                >
                  <ArchiveIcon />
                </SidebarIconButton>
              )}
              {unstagedFiles.length > 0 && (
                <SidebarIconButton
                  onClick={handleStageAll}
                  disabled={isLoading || isStageLoading}
                  tooltip="Stage all changes"
                  aria-label="Stage all changes"
                >
                  <PlusIcon />
                </SidebarIconButton>
              )}
              {stagedFiles.length > 0 && (
                <SidebarIconButton
                  onClick={handleUnstageAll}
                  disabled={isLoading || isStageLoading}
                  tooltip="Unstage all changes"
                  aria-label="Unstage all changes"
                >
                  <MinusIcon />
                </SidebarIconButton>
              )}
            </div>
            <div className="hidden shrink-0 @max-[300px]/git-status-toolbar:block">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <SidebarIconButton tooltip="Change actions" aria-label="Change actions" />
                  }
                >
                  <DotsIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent side="top" align="end">
                  {unstagedFiles.length > 0 ? (
                    <DropdownMenuItem onClick={handleStashAllUnstaged} disabled={isLoading}>
                      <ArchiveIcon />
                      Stash all unstaged changes
                    </DropdownMenuItem>
                  ) : null}
                  {unstagedFiles.length > 0 ? (
                    <DropdownMenuItem
                      onClick={() => void handleStageAll()}
                      disabled={isLoading || isStageLoading}
                    >
                      <PlusIcon />
                      Stage all changes
                    </DropdownMenuItem>
                  ) : null}
                  {stagedFiles.length > 0 ? (
                    <DropdownMenuItem
                      onClick={() => void handleUnstageAll()}
                      disabled={isLoading || isStageLoading}
                    >
                      <MinusIcon />
                      Unstage all changes
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </SidebarToolbar>
        </>
      ) : (
        <EmptyState
          layout="sidebar"
          tone="success"
          icon={<CheckIcon />}
          title="Working tree clean"
        />
      )}

      <ContextMenuPopup
        isOpen={contextMenu.isOpen}
        point={contextMenu.position}
        groups={createContextMenuGroups(
          contextMenuData
            ? [
                ...(onOpenFile
                  ? [
                      {
                        id: "open-file",
                        label: "Open File",
                        icon: <FileTextIcon />,
                        onClick: () => onOpenFile(contextMenuData.filePath),
                      },
                    ]
                  : []),
                ...(contextMenuData.isStaged
                  ? [
                      {
                        id: "unstage-file",
                        label: "Unstage File",
                        icon: <MinusIcon />,
                        onClick: () => void handleUnstageFile(contextMenuData.filePath),
                      },
                    ]
                  : [
                      {
                        id: "stage-file",
                        label: "Stage File",
                        icon: <PlusIcon />,
                        onClick: () => void handleStageFile(contextMenuData.filePath),
                      },
                      {
                        id: "stash-file",
                        label: "Stash File",
                        icon: <ArchiveIcon />,
                        onClick: () => void handleStashFile(contextMenuData.filePath),
                      },
                    ]),
                ...(contextMenuFile && contextMenuFile.status !== "untracked"
                  ? [
                      {
                        id: "discard-file",
                        label: "Discard Changes",
                        icon: <TrashIcon />,
                        tone: "destructive" as const,
                        onClick: () => void handleDiscardFile(contextMenuData.filePath),
                      },
                    ]
                  : []),
              ]
            : [],
        )}
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

export default memo(GitStatusPanel, isEqual);
