import { open } from "@tauri-apps/plugin-dialog";
import {
  ArchiveIcon as Archive,
  ClockCounterClockwiseIcon as ClockCounterClockwise,
  DownloadIcon as Download,
  DotsThreeIcon as MoreHorizontal,
  FolderSimpleStarIcon as FolderSimpleStar,
  GitBranchIcon as GitBranch,
  ArrowClockwiseIcon as RefreshCw,
  TrashIcon as Trash2,
  UploadIcon as Upload,
} from "@phosphor-icons/react";
import { memo, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer-store";
import { useSettingsStore } from "@/features/settings/store";
import { Button } from "@/ui/button";
import { CommandEmpty, CommandList } from "@/ui/command";
import { LoadingIndicator } from "@/ui/loading";
import { showAlertDialog } from "@/features/dialogs/dialog-service";
import {
  SidebarEmptyActionState,
  SidebarEmptyState,
  SidebarFooter,
  SidebarHeader,
  SidebarHeaderIconButton,
  SidebarPanel,
  SidebarSectionPager,
  SidebarSectionSwitcher,
} from "@/ui/sidebar";
import { toast } from "@/ui/toast";
import { formatRelativeDate } from "@/utils/date";
import { matchesSearchQuery } from "@/utils/search-match";
import { getBranches } from "../api/git-branches-api";
import { getGitLog } from "../api/git-commits-api";
import { getCommitDiff, getFileDiff, getRefDiff, getStashDiff } from "../api/git-diff-api";
import { clearRepositoryDiscoveryCache, resolveRepositoryPath } from "../api/git-repo-api";
import { applyStash, dropStash, getStashes, popStash } from "../api/git-stash-api";
import { getGitStatus, initRepository } from "../api/git-status-api";
import { useRepositoryStore } from "../stores/git-repository-store";
import { useGitStore } from "../stores/git-store";
import type { MultiFileDiff } from "../types/git-diff-types";
import type { GitFile } from "../types/git-types";
import type { GitActionsMenuAnchorRect } from "../utils/git-actions-menu-position";
import { countDiffStats } from "../utils/git-diff-helpers";
import { getStashDisplayTitle, getStashPositionLabel } from "../utils/git-stash-format";
import { buildWorkingTreeMultiDiff } from "../utils/working-tree-multi-diff";
import GitActionsMenu from "./git-actions-menu";
import GitCommitHistory from "./git-commit-history";
import GitCommitPanel from "./git-commit-panel";
import GitCommandSurface from "./git-command-surface";
import GitProjectSelector from "./git-project-selector";
import GitRemoteManager from "./git-remote-manager";
import GitTagManager from "./git-tag-manager";
import GitStatusPanel from "./status/git-status-panel";

interface GitViewProps {
  repoPath?: string;
  onFileSelect?: (path: string, isDir: boolean) => void;
  isActive?: boolean;
}

interface GitFileDiffStats {
  additions: number;
  deletions: number;
}

type GitSidebarTab = "changes" | "history";
type GitPaletteAction =
  | { type: "select-repository" }
  | { type: "show-tab"; tab: GitSidebarTab }
  | { type: "manage-remotes" }
  | { type: "manage-tags" }
  | { type: "view-stashes" }
  | { type: "refresh" };

const GitView = ({ repoPath, onFileSelect, isActive }: GitViewProps) => {
  const MAX_STATUS_DIFF_STATS_FILES = 40;
  const { gitStatus, isLoadingGitData, isRefreshing, actions } = useGitStore();
  const stashes = useGitStore((state) => state.stashes);
  const { setIsLoadingGitData, setIsRefreshing } = actions;
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const { syncWorkspaceRepositories, setManualRepository, refreshWorkspaceRepositories } =
    useRepositoryStore.use.actions();
  const [showGitActionsMenu, setShowGitActionsMenu] = useState(false);
  const [showStashList, setShowStashList] = useState(false);
  const [isSelectingRepo, setIsSelectingRepo] = useState(false);
  const [isInitializingRepo, setIsInitializingRepo] = useState(false);
  const [repoSelectionError, setRepoSelectionError] = useState<string | null>(null);
  const [gitActionsMenuAnchor, setGitActionsMenuAnchor] = useState<GitActionsMenuAnchorRect | null>(
    null,
  );

  const [showRemoteManager, setShowRemoteManager] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const settings = useSettingsStore((state) => state.settings);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const [activeTab, setActiveTab] = useState<GitSidebarTab>("changes");
  const [fileDiffStats, setFileDiffStats] = useState<Record<string, GitFileDiffStats>>({});

  const wasActiveRef = useRef(isActive);
  const [stashSearchQuery, setStashSearchQuery] = useState("");
  const [stashActionLoading, setStashActionLoading] = useState<Set<number>>(new Set());

  const visibleGitFiles = useMemo(
    () =>
      settings.showUntrackedFiles
        ? (gitStatus?.files ?? [])
        : (gitStatus?.files ?? []).filter((file) => file.status !== "untracked"),
    [gitStatus?.files, settings.showUntrackedFiles],
  );

  const handleSelectRepository = useCallback(async () => {
    setIsSelectingRepo(true);
    setRepoSelectionError(null);
    try {
      const selected = await open({
        directory: true,
        multiple: false,
      });

      if (!selected || Array.isArray(selected)) {
        return;
      }

      const resolvedRepoPath = await resolveRepositoryPath(selected);
      if (!resolvedRepoPath) {
        const message = "Selected folder is not inside a Git repository.";
        setRepoSelectionError(message);
        await showAlertDialog(message, "Select Repository");
        return;
      }

      setManualRepository(resolvedRepoPath);
    } catch (error) {
      console.error("Failed to select repository:", error);
      const message = "Failed to select repository";
      setRepoSelectionError(message);
      await showAlertDialog(`${message}:\n${error}`, "Select Repository");
    } finally {
      setIsSelectingRepo(false);
    }
  }, [setManualRepository]);

  const handleInitializeRepository = useCallback(async () => {
    const targetPath = repoPath;

    if (!targetPath) {
      toast.error("Open a folder before initializing a repository.");
      return;
    }

    setIsInitializingRepo(true);
    setRepoSelectionError(null);
    try {
      const success = await initRepository(targetPath);
      if (!success) {
        const message = "Failed to initialize repository.";
        setRepoSelectionError(message);
        toast.error(message);
        return;
      }

      clearRepositoryDiscoveryCache();
      setManualRepository(targetPath);
      await syncWorkspaceRepositories(targetPath, { force: true });
      window.dispatchEvent(new CustomEvent("git-status-changed"));
      toast.success("Repository initialized.");
    } catch (error) {
      console.error("Failed to initialize repository:", error);
      const message = error instanceof Error ? error.message : "Failed to initialize repository.";
      setRepoSelectionError(message);
      toast.error(message);
    } finally {
      setIsInitializingRepo(false);
    }
  }, [repoPath, setManualRepository, syncWorkspaceRepositories]);

  const loadInitialGitData = useCallback(async () => {
    if (!activeRepoPath) return;

    setIsLoadingGitData(true);
    try {
      const [status, commits, branches, stashes] = await Promise.all([
        getGitStatus(activeRepoPath),
        getGitLog(activeRepoPath, 50, 0),
        getBranches(activeRepoPath),
        getStashes(activeRepoPath),
      ]);

      actions.loadFreshGitData({
        gitStatus: status,
        commits,
        branches,
        stashes,
        repoPath: activeRepoPath,
      });
    } catch (error) {
      console.error("Failed to load initial git data:", error);
    } finally {
      setIsLoadingGitData(false);
    }
  }, [activeRepoPath, actions, setIsLoadingGitData]);

  const refreshGitData = useCallback(async () => {
    if (!activeRepoPath) return;

    try {
      const [status, branches, freshStashes] = await Promise.all([
        getGitStatus(activeRepoPath),
        getBranches(activeRepoPath),
        getStashes(activeRepoPath),
      ]);

      await actions.refreshGitData({
        gitStatus: status,
        branches,
        repoPath: activeRepoPath,
      });
      actions.setStashes(freshStashes);
    } catch (error) {
      console.error("Failed to refresh git data:", error);
    }
  }, [activeRepoPath, actions]);

  const handleManualRefresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        refreshGitData(),
        refreshWorkspaceRepositories(),
        new Promise((resolve) => setTimeout(resolve, 500)),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  }, [refreshGitData, refreshWorkspaceRepositories, setIsRefreshing]);

  useEffect(() => {
    void syncWorkspaceRepositories(repoPath ?? null);
  }, [repoPath, syncWorkspaceRepositories]);

  useEffect(() => {
    loadInitialGitData();
  }, [loadInitialGitData]);

  useEffect(() => {
    setRepoSelectionError(null);
  }, [repoPath]);

  useEffect(() => {
    if (settings.autoRefreshGitStatus && isActive && !wasActiveRef.current && gitStatus) {
      refreshGitData();
    }
    wasActiveRef.current = isActive;
  }, [settings.autoRefreshGitStatus, isActive, gitStatus, refreshGitData]);

  useEffect(() => {
    if (!settings.autoRefreshGitStatus) return;

    const handleGitStatusChanged = () => {
      refreshGitData();
    };

    window.addEventListener("git-status-changed", handleGitStatusChanged);
    return () => {
      window.removeEventListener("git-status-changed", handleGitStatusChanged);
    };
  }, [settings.autoRefreshGitStatus, refreshGitData]);

  useEffect(() => {
    if (!settings.autoRefreshGitStatus) return;

    let refreshTimeout: NodeJS.Timeout | null = null;
    type FileExternalChangeDetail = {
      event_type: string;
      path: string;
    };

    const handleFileChange = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;

      const { path } = event.detail as FileExternalChangeDetail;

      if (activeRepoPath && path.startsWith(activeRepoPath)) {
        if (refreshTimeout) {
          clearTimeout(refreshTimeout);
        }

        refreshTimeout = setTimeout(() => {
          refreshGitData();
        }, 300);
      }
    };

    window.addEventListener("file-external-change", handleFileChange);

    return () => {
      window.removeEventListener("file-external-change", handleFileChange);
      if (refreshTimeout) {
        clearTimeout(refreshTimeout);
      }
    };
  }, [settings.autoRefreshGitStatus, activeRepoPath, refreshGitData]);

  useEffect(() => {
    if (!settings.rememberLastGitPanelMode) return;
    setActiveTab(settings.gitLastPanelMode);
  }, [settings.rememberLastGitPanelMode, settings.gitLastPanelMode]);

  useEffect(() => {
    if (!settings.rememberLastGitPanelMode) return;
    if (settings.gitLastPanelMode !== activeTab) {
      void updateSetting("gitLastPanelMode", activeTab);
    }
  }, [activeTab, settings.rememberLastGitPanelMode, settings.gitLastPanelMode, updateSetting]);

  useEffect(() => {
    const handlePaletteAction = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;

      const detail = event.detail as GitPaletteAction;
      if (!detail) return;

      if (detail.type === "select-repository") {
        void handleSelectRepository();
        return;
      }

      if (detail.type === "show-tab") {
        setActiveTab(detail.tab);
        return;
      }

      if (detail.type === "manage-remotes") {
        setShowRemoteManager(true);
        return;
      }

      if (detail.type === "manage-tags") {
        setShowTagManager(true);
        return;
      }

      if (detail.type === "view-stashes") {
        setShowStashList(true);
        setStashSearchQuery("");
        return;
      }

      if (detail.type === "refresh") {
        void handleManualRefresh();
      }
    };

    window.addEventListener("athas:git-palette-action", handlePaletteAction);
    return () => window.removeEventListener("athas:git-palette-action", handlePaletteAction);
  }, [handleManualRefresh, handleSelectRepository]);

  useEffect(() => {
    if (!activeRepoPath || !visibleGitFiles.length) {
      setFileDiffStats({});
      return;
    }

    let isCancelled = false;

    const loadFileDiffStats = async () => {
      const uniqueFiles = Array.from(
        new Map(
          visibleGitFiles.map((file) => [
            `${file.staged ? "staged" : "unstaged"}:${file.path}`,
            file,
          ]),
        ).values(),
      );
      const filesToMeasure = uniqueFiles.slice(0, MAX_STATUS_DIFF_STATS_FILES);

      const statsEntries = await Promise.all(
        filesToMeasure.map(async (file) => {
          const diff = await getFileDiff(activeRepoPath, file.path, file.staged);
          const { additions, deletions } = diff
            ? countDiffStats([diff])
            : { additions: 0, deletions: 0 };
          return [
            `${file.staged ? "staged" : "unstaged"}:${file.path}`,
            { additions, deletions },
          ] as const;
        }),
      );

      if (!isCancelled) {
        setFileDiffStats(Object.fromEntries(statsEntries));
      }
    };

    void loadFileDiffStats();

    return () => {
      isCancelled = true;
    };
  }, [activeRepoPath, visibleGitFiles]);

  const handleOpenOriginalFile = async (filePath: string) => {
    if (!activeRepoPath || !onFileSelect) return;

    try {
      let actualFilePath = filePath;

      if (filePath.includes(" -> ")) {
        const parts = filePath.split(" -> ");
        actualFilePath = parts[1].trim();
      }

      if (actualFilePath.startsWith('"') && actualFilePath.endsWith('"')) {
        actualFilePath = actualFilePath.slice(1, -1);
      }

      const fullPath = `${activeRepoPath}/${actualFilePath}`;

      onFileSelect(fullPath, false);
    } catch (error) {
      console.error("Error opening file:", error);
      await showAlertDialog(`Failed to open file ${filePath}:\n${error}`, "Open File");
    }
  };

  const handleViewFileDiff = async (filePath: string, staged: boolean = false) => {
    if (!activeRepoPath || !onFileSelect) return;

    try {
      let actualFilePath = filePath;

      if (filePath.includes(" -> ")) {
        const parts = filePath.split(" -> ");
        if (staged) {
          actualFilePath = parts[1].trim();
        } else {
          actualFilePath = parts[0].trim();
        }
      }

      if (actualFilePath.startsWith('"') && actualFilePath.endsWith('"')) {
        actualFilePath = actualFilePath.slice(1, -1);
      }

      const file = gitStatus?.files.find((f: GitFile) => f.path === actualFilePath);

      if (file && file.status === "untracked" && !staged) {
        handleOpenOriginalFile(actualFilePath);
        return;
      }

      const diff = await getFileDiff(activeRepoPath, actualFilePath, staged);

      if (diff && (diff.lines.length > 0 || diff.is_image)) {
        const selectedFileKey = `${staged ? "staged" : "unstaged"}:${actualFilePath}`;
        const { additions, deletions } = countDiffStats([diff]);

        // Open buffer immediately with the clicked file's diff
        const initialMultiDiff: MultiFileDiff = {
          title: "Uncommitted Changes",
          repoPath: activeRepoPath,
          commitHash: "working-tree",
          files: [diff],
          totalFiles: 1,
          totalAdditions: additions,
          totalDeletions: deletions,
          fileKeys: [selectedFileKey],
          initiallyExpandedFileKey: selectedFileKey,
          isLoading: true,
        };

        const virtualPath = "diff://working-tree/all-files";
        const bufferId = useBufferStore
          .getState()
          .actions.openBuffer(
            virtualPath,
            "Uncommitted Changes",
            "",
            false,
            undefined,
            true,
            true,
            initialMultiDiff,
          );

        // Load remaining diffs in the background
        const repoPath = activeRepoPath;
        const diffableFiles = (visibleGitFiles ?? []).filter(
          (entry) => entry.status !== "untracked",
        );
        const diffEntries = Array.from(
          new Map(
            diffableFiles.map((entry) => [
              `${entry.staged ? "staged" : "unstaged"}:${entry.path}`,
              entry,
            ]),
          ).entries(),
        ).filter(([fileKey]) => fileKey !== selectedFileKey);

        if (diffEntries.length > 0) {
          void (async () => {
            const accumulatedDiffs = [{ fileKey: selectedFileKey, diff }];

            for (const [fileKey, entry] of diffEntries) {
              const nextDiff = await getFileDiff(repoPath, entry.path, entry.staged);
              if (!nextDiff || (nextDiff.lines.length === 0 && nextDiff.is_image !== true)) {
                continue;
              }

              accumulatedDiffs.push({
                fileKey,
                diff: nextDiff,
              });

              const stats = countDiffStats(accumulatedDiffs.map((item) => item.diff));
              useBufferStore.getState().actions.updateBufferContent(bufferId, "", false, {
                title: "Uncommitted Changes",
                repoPath,
                commitHash: "working-tree",
                files: accumulatedDiffs.map((item) => item.diff),
                totalFiles: accumulatedDiffs.length,
                totalAdditions: stats.additions,
                totalDeletions: stats.deletions,
                fileKeys: accumulatedDiffs.map((item) => item.fileKey),
                initiallyExpandedFileKey: selectedFileKey,
                isLoading: true,
              } satisfies MultiFileDiff);
              await Promise.resolve();
            }

            const allStats = countDiffStats(accumulatedDiffs.map((item) => item.diff));
            useBufferStore.getState().actions.updateBufferContent(bufferId, "", false, {
              title: "Uncommitted Changes",
              repoPath,
              commitHash: "working-tree",
              files: accumulatedDiffs.map((item) => item.diff),
              totalFiles: accumulatedDiffs.length,
              totalAdditions: allStats.additions,
              totalDeletions: allStats.deletions,
              fileKeys: accumulatedDiffs.map((item) => item.fileKey),
              initiallyExpandedFileKey: selectedFileKey,
              isLoading: false,
            } satisfies MultiFileDiff);
          })();
        } else {
          // No other files to load, mark as done
          useBufferStore.getState().actions.updateBufferContent(bufferId, "", false, {
            ...initialMultiDiff,
            isLoading: false,
          });
        }
      } else {
        handleOpenOriginalFile(actualFilePath);
      }
    } catch (error) {
      console.error("Error getting file diff:", error);
      await showAlertDialog(`Failed to get diff for ${filePath}:\n${error}`, "Git Diff");
    }
  };

  const handleViewWorkingTreeDiff = async () => {
    if (!activeRepoPath || !gitStatus) return;

    try {
      const multiDiff = await buildWorkingTreeMultiDiff({
        repoPath: activeRepoPath,
        status: {
          ...gitStatus,
          files: visibleGitFiles,
        },
      });

      if (multiDiff.totalFiles === 0) {
        await showAlertDialog("No diffable uncommitted changes.", "Git Diff");
        return;
      }

      const displayName = `Uncommitted Changes (${multiDiff.totalFiles} file${multiDiff.totalFiles === 1 ? "" : "s"})`;
      useBufferStore
        .getState()
        .actions.openBuffer(
          "diff://working-tree/all-files",
          displayName,
          "",
          false,
          undefined,
          true,
          true,
          multiDiff,
        );
    } catch (error) {
      console.error("Error getting working tree diff:", error);
      await showAlertDialog(`Failed to get working tree diff:\n${error}`, "Git Diff");
    }
  };

  const handleViewCommitDiff = async (commitHash: string, filePath?: string) => {
    if (!activeRepoPath || !onFileSelect) return;

    try {
      const diffs = await getCommitDiff(activeRepoPath, commitHash);
      const commit = useGitStore.getState().commits.find((entry) => entry.hash === commitHash);

      if (diffs && diffs.length > 0) {
        if (filePath) {
          const diff = diffs.find((d) => d.file_path === filePath) || diffs[0];
          const diffFileName = `${diff.file_path.split("/").pop()}.diff`;
          const virtualPath = `diff://commit/${commitHash}/${diffFileName}`;

          useBufferStore
            .getState()
            .actions.openBuffer(virtualPath, diffFileName, "", false, undefined, true, true, diff);
        } else {
          const { additions, deletions } = countDiffStats(diffs);

          const multiDiff: MultiFileDiff = {
            title: `Commit ${commitHash.substring(0, 7)}`,
            repoPath: activeRepoPath,
            commitHash,
            commitMessage: commit?.message,
            commitDescription: commit?.description,
            commitAuthor: commit?.author,
            commitDate: commit?.date,
            files: diffs,
            totalFiles: diffs.length,
            totalAdditions: additions,
            totalDeletions: deletions,
          };

          const virtualPath = `diff://commit/${commitHash}/all-files`;
          const displayName = `Commit ${commitHash.substring(0, 7)} (${diffs.length} files)`;

          useBufferStore
            .getState()
            .actions.openBuffer(
              virtualPath,
              displayName,
              "",
              false,
              undefined,
              true,
              true,
              multiDiff,
            );
        }
      } else {
        await showAlertDialog(
          `No changes in this commit${filePath ? ` for file ${filePath}` : ""}.`,
          "Git Diff",
        );
      }
    } catch (error) {
      console.error("Error getting commit diff:", error);
      await showAlertDialog(`Failed to get diff for commit ${commitHash}:\n${error}`, "Git Diff");
    }
  };

  const handleViewStashDiff = async (stashIndex: number) => {
    if (!activeRepoPath || !onFileSelect) return;

    try {
      const diffs = await getStashDiff(activeRepoPath, stashIndex);

      if (diffs && diffs.length > 0) {
        const { additions, deletions } = countDiffStats(diffs);

        const multiDiff: MultiFileDiff = {
          repoPath: activeRepoPath,
          commitHash: `stash@{${stashIndex}}`,
          files: diffs,
          totalFiles: diffs.length,
          totalAdditions: additions,
          totalDeletions: deletions,
        };

        const virtualPath = `diff://stash/${stashIndex}/all-files`;
        const displayName = `Stash @{${stashIndex}} (${diffs.length} files)`;

        useBufferStore
          .getState()
          .actions.openBuffer(
            virtualPath,
            displayName,
            "",
            false,
            undefined,
            true,
            true,
            multiDiff,
          );
      } else {
        await showAlertDialog("No changes in this stash.", "Git Diff");
      }
    } catch (error) {
      console.error("Error getting stash diff:", error);
      await showAlertDialog(`Failed to get diff for stash@{${stashIndex}}:\n${error}`, "Git Diff");
    }
  };

  const handleViewTagComparison = async (baseRef: string, targetRef: string, title: string) => {
    if (!activeRepoPath || !onFileSelect) return;

    try {
      const diffs = await getRefDiff(activeRepoPath, baseRef, targetRef);

      if (diffs && diffs.length > 0) {
        const { additions, deletions } = countDiffStats(diffs);

        const multiDiff: MultiFileDiff = {
          title,
          repoPath: activeRepoPath,
          commitHash: `${baseRef}..${targetRef}`,
          files: diffs,
          totalFiles: diffs.length,
          totalAdditions: additions,
          totalDeletions: deletions,
        };

        const encodedTitle = encodeURIComponent(title);
        useBufferStore
          .getState()
          .actions.openBuffer(
            `diff://tag/${encodedTitle}/all-files`,
            `${title} (${diffs.length} files)`,
            "",
            false,
            undefined,
            true,
            true,
            multiDiff,
          );
      } else {
        await showAlertDialog(`No changes between ${baseRef} and ${targetRef}.`, "Git Diff");
      }
    } catch (error) {
      console.error("Error getting tag comparison:", error);
      await showAlertDialog(`Failed to compare ${baseRef} and ${targetRef}:\n${error}`, "Git Diff");
    }
  };

  const handleStashListAction = async (
    action: () => Promise<boolean>,
    stashIndex: number,
    actionName: string,
  ) => {
    if (!activeRepoPath) return;

    setStashActionLoading((prev) => new Set(prev).add(stashIndex));
    try {
      const success = await action();
      if (success) {
        if (settings.autoRefreshGitStatus) {
          await handleManualRefresh();
        } else {
          actions.setStashes(await getStashes(activeRepoPath));
        }
      } else {
        console.error(`${actionName} failed`);
      }
    } catch (error) {
      console.error(`${actionName} error:`, error);
    } finally {
      setStashActionLoading((prev) => {
        const next = new Set(prev);
        next.delete(stashIndex);
        return next;
      });
    }
  };

  const renderActionsButton = () => (
    <SidebarHeaderIconButton
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setGitActionsMenuAnchor({
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        });
        setShowGitActionsMenu(!showGitActionsMenu);
        setShowStashList(false);
      }}
      tooltip="Git Actions"
    >
      <MoreHorizontal />
    </SidebarHeaderIconButton>
  );

  const renderInitializeRepositoryButton = () => {
    const canInitializeRepository = Boolean(repoPath);

    return (
      <Button
        onClick={() => void handleInitializeRepository()}
        disabled={!canInitializeRepository || isInitializingRepo}
        variant="ghost"
        compact
        className="h-6 border border-border/70 bg-secondary-bg/60 px-2 text-text-lighter ui-text-xs hover:bg-hover hover:text-text"
        tooltip={
          canInitializeRepository
            ? "Initialize Git repository"
            : "Open a folder before initializing Git"
        }
      >
        <GitBranch weight="duotone" />
        {isInitializingRepo ? "Initializing..." : "Initialize"}
      </Button>
    );
  };

  const renderRepositoryEmptyActions = () => (
    <div className="mt-1.5 flex items-center justify-center gap-1.5">
      <Button
        type="button"
        variant="ghost"
        compact
        className="h-6 border border-border/70 bg-secondary-bg/60 px-2 text-text-lighter ui-text-xs hover:bg-hover hover:text-text"
        disabled={isSelectingRepo}
        onClick={() => void handleSelectRepository()}
      >
        <FolderSimpleStar weight="duotone" />
        {isSelectingRepo ? "Selecting..." : "Browse"}
      </Button>
      {renderInitializeRepositoryButton()}
    </div>
  );

  const renderGitActionsMenu = ({
    hasGitRepo,
    onRefresh,
  }: {
    hasGitRepo: boolean;
    onRefresh?: () => void;
  }) => (
    <GitActionsMenu
      isOpen={showGitActionsMenu}
      anchorRect={gitActionsMenuAnchor}
      onClose={() => {
        setShowGitActionsMenu(false);
        setGitActionsMenuAnchor(null);
      }}
      hasGitRepo={hasGitRepo}
      repoPath={activeRepoPath ?? repoPath}
      onRefresh={onRefresh}
      onOpenRemoteManager={() => setShowRemoteManager(true)}
      onOpenTagManager={() => setShowTagManager(true)}
      onViewStashes={() => {
        setShowStashList(true);
        setStashSearchQuery("");
      }}
      onSelectRepository={handleSelectRepository}
      isSelectingRepository={isSelectingRepo}
      onInitializeRepository={handleInitializeRepository}
      isInitializingRepository={isInitializingRepo}
    />
  );

  const filteredStashes = useMemo(() => {
    const query = stashSearchQuery.trim().toLowerCase();
    if (!query) {
      return stashes;
    }

    return stashes.filter((stash) =>
      matchesSearchQuery(query, [
        getStashDisplayTitle(stash.message),
        getStashPositionLabel(stash.index),
        `stash ${stash.index + 1}`,
        `stash@{${stash.index}}`,
      ]),
    );
  }, [stashSearchQuery, stashes]);

  const gitTabOrder: GitSidebarTab[] = ["changes", "history"];
  const gitTabs: Array<{
    id: GitSidebarTab;
    label: string;
    icon: ReactNode;
  }> = [...settings.gitSidebarTabOrder]
    .filter((id): id is GitSidebarTab => id === "changes" || id === "history")
    .sort((a, b) => gitTabOrder.indexOf(a) - gitTabOrder.indexOf(b))
    .map((id) => {
      const tabMap: Record<GitSidebarTab, { id: GitSidebarTab; label: string; icon: ReactNode }> = {
        changes: {
          id: "changes",
          label: "Changes",
          icon: <FolderSimpleStar size={16} weight="duotone" />,
        },
        history: {
          id: "history",
          label: "History",
          icon: <ClockCounterClockwise size={16} weight="duotone" />,
        },
      };

      return tabMap[id];
    })
    .filter(Boolean);

  if (!activeRepoPath) {
    return (
      <>
        <SidebarPanel className="gap-2 p-2">
          <SidebarHeader className="justify-between bg-transparent px-0 py-0 backdrop-blur-none">
            <div className="flex items-center gap-2">{renderActionsButton()}</div>
          </SidebarHeader>
          <SidebarEmptyActionState className="h-full" message="No repository selected">
            {renderRepositoryEmptyActions()}
            {repoSelectionError ? (
              <span className="ui-text-sm mt-1.5 text-red-400">{repoSelectionError}</span>
            ) : null}
          </SidebarEmptyActionState>
        </SidebarPanel>
        {renderGitActionsMenu({ hasGitRepo: false, onRefresh: handleManualRefresh })}
      </>
    );
  }

  if (isLoadingGitData && !gitStatus) {
    return (
      <>
        <SidebarPanel className="gap-2 p-2">
          <SidebarHeader className="justify-between bg-transparent px-0 py-0 backdrop-blur-none">
            <div className="flex items-center gap-2">{renderActionsButton()}</div>
          </SidebarHeader>
          <SidebarEmptyState className="h-full">Loading Git status...</SidebarEmptyState>
        </SidebarPanel>
        {renderGitActionsMenu({ hasGitRepo: false, onRefresh: handleManualRefresh })}
      </>
    );
  }

  if (!gitStatus) {
    return (
      <>
        <SidebarPanel className="gap-2 p-2">
          <SidebarHeader className="justify-between bg-transparent px-0 py-0 backdrop-blur-none">
            <div className="flex items-center gap-2">{renderActionsButton()}</div>
          </SidebarHeader>
          <SidebarEmptyActionState className="h-full" message="Not a Git repository">
            {renderRepositoryEmptyActions()}
            {repoSelectionError ? (
              <span className="ui-text-sm mt-1.5 text-red-400">{repoSelectionError}</span>
            ) : null}
          </SidebarEmptyActionState>
        </SidebarPanel>
        {renderGitActionsMenu({ hasGitRepo: false, onRefresh: handleManualRefresh })}
      </>
    );
  }

  const stagedFiles = visibleGitFiles.filter((f) => f.staged);
  const refreshAfterAction = settings.autoRefreshGitStatus ? handleManualRefresh : undefined;
  const handleGitFileClick = settings.openDiffOnClick ? handleViewFileDiff : handleOpenOriginalFile;

  return (
    <>
      <SidebarPanel className="ui-font ui-text-sm select-none gap-2 p-2">
        <SidebarHeader className="min-w-0 bg-transparent px-0 py-0 backdrop-blur-none">
          <GitProjectSelector
            className="min-w-0 flex-1"
            onRepositoryChange={() => setRepoSelectionError(null)}
          />

          <div className="flex shrink-0 items-center gap-1">
            <SidebarHeaderIconButton
              onClick={handleManualRefresh}
              disabled={isLoadingGitData || isRefreshing}
              className="disabled:opacity-50"
              tooltip="Refresh"
              aria-label="Refresh git status"
            >
              {isLoadingGitData || isRefreshing ? (
                <LoadingIndicator label="Refreshing git status" compact />
              ) : (
                <RefreshCw />
              )}
            </SidebarHeaderIconButton>
            {renderActionsButton()}
          </div>
        </SidebarHeader>

        <div className="@container flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          <SidebarSectionSwitcher
            items={gitTabs}
            value={activeTab}
            onChange={(tab) => setActiveTab(tab as GitSidebarTab)}
          />

          <SidebarSectionPager
            className="flex-1"
            items={[
              {
                id: "changes",
                content: (
                  <GitStatusPanel
                    files={visibleGitFiles}
                    fileDiffStats={fileDiffStats}
                    onFileSelect={handleGitFileClick}
                    onOpenFile={handleOpenOriginalFile}
                    onRefresh={refreshAfterAction}
                    repoPath={activeRepoPath}
                  />
                ),
              },
              {
                id: "history",
                content: (
                  <GitCommitHistory
                    isCollapsed={false}
                    onToggle={() => {}}
                    onViewCommitDiff={handleViewCommitDiff}
                    onViewWorkingTreeDiff={handleViewWorkingTreeDiff}
                    repoPath={activeRepoPath}
                    showHeader={false}
                    uncommittedFiles={visibleGitFiles}
                    currentBranch={gitStatus.branch}
                  />
                ),
              },
            ].filter((item) => gitTabs.some((tab) => tab.id === item.id))}
            value={activeTab}
            onChange={(tab) => setActiveTab(tab as GitSidebarTab)}
          />
        </div>

        <SidebarFooter surface>
          <GitCommitPanel
            stagedFilesCount={stagedFiles.length}
            stagedFiles={stagedFiles}
            currentBranch={gitStatus.branch}
            repoPath={activeRepoPath}
            ahead={gitStatus.ahead}
            behind={gitStatus.behind}
            onCommitSuccess={refreshAfterAction}
          />
        </SidebarFooter>
      </SidebarPanel>

      {renderGitActionsMenu({ hasGitRepo: !!gitStatus, onRefresh: refreshAfterAction })}
      <GitCommandSurface
        isOpen={showStashList}
        onClose={() => {
          setShowStashList(false);
          setStashSearchQuery("");
        }}
        query={stashSearchQuery}
        onQueryChange={setStashSearchQuery}
        placeholder="Search stashes..."
        meta={`${stashes.length} stash${stashes.length === 1 ? "" : "es"}`}
      >
        <CommandList>
          {filteredStashes.length === 0 ? (
            <CommandEmpty>
              {stashSearchQuery.trim() ? "No matching stashes" : "No stashes"}
            </CommandEmpty>
          ) : (
            filteredStashes.map((stash) => {
              const displayTitle = getStashDisplayTitle(stash.message);
              const isActionLoading = stashActionLoading.has(stash.index);

              return (
                <div
                  key={stash.index}
                  role="button"
                  tabIndex={0}
                  className="group/stash ui-font relative mb-1 flex min-h-12 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-hover focus:bg-hover focus:outline-none"
                  onClick={() => {
                    void handleViewStashDiff(stash.index);
                    setShowStashList(false);
                    setStashSearchQuery("");
                  }}
                  onKeyDown={(event) => {
                    if (event.target !== event.currentTarget) return;
                    if (event.key !== "Enter" && event.key !== " ") return;
                    event.preventDefault();
                    void handleViewStashDiff(stash.index);
                    setShowStashList(false);
                    setStashSearchQuery("");
                  }}
                >
                  <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/50 bg-secondary-bg/70 text-text-lighter">
                    <Archive className="size-4" />
                  </div>
                  <div className="min-w-0 flex-1 pr-24">
                    <div className="ui-text-sm truncate text-text" title={displayTitle}>
                      {displayTitle}
                    </div>
                    <div className="ui-text-xs mt-1 flex min-w-0 items-center gap-2 text-text-lighter/80">
                      <span className="truncate">{formatRelativeDate(stash.date)}</span>
                      <span className="rounded border border-border/50 px-1 ui-text-xs leading-4">
                        {getStashPositionLabel(stash.index)}
                      </span>
                    </div>
                  </div>
                  <div className="pointer-events-none absolute right-2 top-1/2 flex -translate-y-1/2 translate-x-1 items-center gap-0.5 rounded-md border border-border/60 bg-secondary-bg p-0.5 opacity-0 transition-all group-hover/stash:pointer-events-auto group-hover/stash:translate-x-0 group-hover/stash:opacity-100 group-focus-within/stash:pointer-events-auto group-focus-within/stash:translate-x-0 group-focus-within/stash:opacity-100">
                    <Button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleStashListAction(
                          () => applyStash(activeRepoPath!, stash.index),
                          stash.index,
                          "Apply stash",
                        );
                      }}
                      disabled={isActionLoading}
                      variant="ghost"
                      compact
                      className="text-text-lighter disabled:opacity-50"
                      tooltip="Apply stash"
                    >
                      <Download />
                    </Button>
                    <Button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleStashListAction(
                          () => popStash(activeRepoPath!, stash.index),
                          stash.index,
                          "Pop stash",
                        );
                      }}
                      disabled={isActionLoading}
                      variant="ghost"
                      compact
                      className="text-text-lighter disabled:opacity-50"
                      tooltip="Pop stash"
                    >
                      <Upload />
                    </Button>
                    <Button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleStashListAction(
                          () => dropStash(activeRepoPath!, stash.index),
                          stash.index,
                          "Drop stash",
                        );
                      }}
                      disabled={isActionLoading}
                      variant="ghost"
                      compact
                      className="text-red-400 hover:bg-red-900/20 hover:text-red-300 disabled:opacity-50"
                      tooltip="Drop stash"
                    >
                      <Trash2 />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </CommandList>
      </GitCommandSurface>

      <GitRemoteManager
        isOpen={showRemoteManager}
        onClose={() => setShowRemoteManager(false)}
        repoPath={activeRepoPath}
        onRefresh={refreshAfterAction}
      />

      <GitTagManager
        isOpen={showTagManager}
        onClose={() => setShowTagManager(false)}
        repoPath={activeRepoPath}
        onRefresh={refreshAfterAction}
        onViewTagComparison={handleViewTagComparison}
      />
    </>
  );
};

export default memo(GitView);
