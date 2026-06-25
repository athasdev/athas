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
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { CommandEmpty, CommandItem, CommandList } from "@/ui/command";
import { LoadingIndicator } from "@/ui/loading";
import { showAlertDialog } from "@/features/dialogs/services/dialog-service";
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
import {
  getCommitDiff,
  getFileDiff,
  getRefDiff,
  getStashDiff,
  getStatusDiffStats,
} from "../api/git-diff-api";
import { clearRepositoryDiscoveryCache, resolveRepositoryPath } from "../api/git-repo-api";
import { applyStash, dropStash, getStashes, popStash } from "../api/git-stash-api";
import { getGitStatus, initRepository } from "../api/git-status-api";
import { useRepositoryStore } from "../stores/git-repository.store";
import { useGitStore } from "../stores/git.store";
import type { MultiFileDiff } from "../types/git-diff.types";
import type { GitDiff, GitFile } from "../types/git.types";
import type { GitActionsMenuAnchorRect } from "../utils/git-actions-menu-position";
import { countDiffStats } from "../utils/git-diff-helpers";
import { getStashDisplayTitle, getStashPositionLabel } from "../utils/git-stash-format";
import { openGitWorktreeWorkspace } from "../utils/git-worktree-open";
import GitActionsMenu from "./git-actions-menu";
import GitBranchManager from "./git-branch-manager";
import GitCommitHistory from "./git-commit-history";
import GitCommitPanel from "./git-commit-panel";
import GitCommandSurface from "./git-command-surface";
import GitProjectSelector from "./git-project-selector";
import GitRemoteManager from "./git-remote-manager";
import GitTagManager from "./git-tag-manager";
import GitWorktreeSwitcher from "./git-worktree-switcher";
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
const GIT_VIEW_BRANCH_MANAGER_EVENT = "athas:open-git-view-branch-manager";
type WorkingTreeDiffScope = "all" | "unstaged" | "staged";

type GitPaletteAction =
  | { type: "select-repository" }
  | { type: "show-tab"; tab: GitSidebarTab }
  | { type: "manage-branches" }
  | { type: "show-branch-diff" }
  | { type: "manage-remotes" }
  | { type: "manage-tags" }
  | { type: "view-stashes" }
  | { type: "initialize-repository" }
  | { type: "refresh" };

const GitView = ({ repoPath, onFileSelect, isActive }: GitViewProps) => {
  const { gitStatus, isLoadingGitData, isRefreshing, actions } = useGitStore();
  const commits = useGitStore((state) => state.commits);
  const branches = useGitStore((state) => state.branches);
  const stashes = useGitStore((state) => state.stashes);
  const { setIsLoadingGitData, setIsRefreshing } = actions;
  const repositoryHeaderState = useRepositoryStore(
    (state) => `${state.availableRepoPaths.length > 1 ? "1" : "0"}:${state.activeRepoPath ?? ""}`,
  );
  const showRepositorySelector = repositoryHeaderState.startsWith("1:");
  const activeRepoPath = repositoryHeaderState.slice(2) || null;
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
  const showUntrackedFiles = useSettingsStore((state) => state.settings.showUntrackedFiles);
  const autoRefreshGitStatus = useSettingsStore((state) => state.settings.autoRefreshGitStatus);
  const rememberLastGitPanelMode = useSettingsStore(
    (state) => state.settings.rememberLastGitPanelMode,
  );
  const gitLastPanelMode = useSettingsStore((state) => state.settings.gitLastPanelMode);
  const gitSidebarTabOrder = useSettingsStore((state) => state.settings.gitSidebarTabOrder);
  const openDiffOnClick = useSettingsStore((state) => state.settings.openDiffOnClick);
  const updateSetting = useSettingsStore((state) => state.updateSetting);
  const [activeTab, setActiveTab] = useState<GitSidebarTab>("changes");
  const [fileDiffStats, setFileDiffStats] = useState<Record<string, GitFileDiffStats>>({});

  const wasActiveRef = useRef(isActive);
  const [showCommitDiffList, setShowCommitDiffList] = useState(false);
  const [commitDiffSearchQuery, setCommitDiffSearchQuery] = useState("");
  const [isLoadingCommitDiff, setIsLoadingCommitDiff] = useState(false);
  const [showBranchDiffList, setShowBranchDiffList] = useState(false);
  const [branchDiffSearchQuery, setBranchDiffSearchQuery] = useState("");
  const [isLoadingBranchDiff, setIsLoadingBranchDiff] = useState(false);
  const [stashSearchQuery, setStashSearchQuery] = useState("");
  const [stashActionLoading, setStashActionLoading] = useState<Set<number>>(new Set());

  const visibleGitFiles = useMemo(
    () =>
      showUntrackedFiles
        ? (gitStatus?.files ?? [])
        : (gitStatus?.files ?? []).filter((file) => file.status !== "untracked"),
    [gitStatus?.files, showUntrackedFiles],
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
    if (autoRefreshGitStatus && isActive && !wasActiveRef.current && gitStatus) {
      refreshGitData();
    }
    wasActiveRef.current = isActive;
  }, [autoRefreshGitStatus, isActive, gitStatus, refreshGitData]);

  useEffect(() => {
    if (!autoRefreshGitStatus) return;

    const handleGitStatusChanged = () => {
      refreshGitData();
    };

    window.addEventListener("git-status-changed", handleGitStatusChanged);
    return () => {
      window.removeEventListener("git-status-changed", handleGitStatusChanged);
    };
  }, [autoRefreshGitStatus, refreshGitData]);

  useEffect(() => {
    if (!autoRefreshGitStatus) return;

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
  }, [autoRefreshGitStatus, activeRepoPath, refreshGitData]);

  useEffect(() => {
    if (!rememberLastGitPanelMode) return;
    setActiveTab(gitLastPanelMode);
  }, [rememberLastGitPanelMode, gitLastPanelMode]);

  useEffect(() => {
    if (!rememberLastGitPanelMode) return;
    if (gitLastPanelMode !== activeTab) {
      void updateSetting("gitLastPanelMode", activeTab);
    }
  }, [activeTab, rememberLastGitPanelMode, gitLastPanelMode, updateSetting]);

  const handleOpenBranchManager = useCallback(() => {
    window.dispatchEvent(new Event(GIT_VIEW_BRANCH_MANAGER_EVENT));
  }, []);

  const handleShowBranchDiffList = useCallback(async () => {
    setShowBranchDiffList(true);
    setBranchDiffSearchQuery("");

    if (!activeRepoPath) return;

    try {
      actions.setBranches(await getBranches(activeRepoPath));
    } catch (error) {
      console.error("Failed to load branches for diff:", error);
    }
  }, [activeRepoPath, actions]);

  const handleShowCommitDiffList = useCallback(() => {
    setShowCommitDiffList(true);
    setCommitDiffSearchQuery("");
  }, []);

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

      if (detail.type === "manage-branches") {
        handleOpenBranchManager();
        return;
      }

      if (detail.type === "show-branch-diff") {
        void handleShowBranchDiffList();
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

      if (detail.type === "initialize-repository") {
        void handleInitializeRepository();
        return;
      }

      if (detail.type === "refresh") {
        void handleManualRefresh();
      }
    };

    window.addEventListener("athas:git-palette-action", handlePaletteAction);
    return () => window.removeEventListener("athas:git-palette-action", handlePaletteAction);
  }, [
    handleInitializeRepository,
    handleManualRefresh,
    handleOpenBranchManager,
    handleSelectRepository,
    handleShowBranchDiffList,
  ]);

  useEffect(() => {
    if (!activeRepoPath || !visibleGitFiles.length) {
      setFileDiffStats({});
      return;
    }

    let isCancelled = false;

    const loadFileDiffStats = async () => {
      const visibleFileKeys = new Set(
        visibleGitFiles.map((file) => `${file.staged ? "staged" : "unstaged"}:${file.path}`),
      );
      const statsEntries = (await getStatusDiffStats(activeRepoPath))
        .map(
          (stat) =>
            [
              `${stat.staged ? "staged" : "unstaged"}:${stat.file_path}`,
              { additions: stat.additions, deletions: stat.deletions },
            ] as const,
        )
        .filter(([key]) => visibleFileKeys.has(key));

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
            const remainingDiffs = await Promise.all(
              diffEntries.map(async ([fileKey, entry]) => {
                const nextDiff = await getFileDiff(repoPath, entry.path, entry.staged);
                if (!nextDiff || (nextDiff.lines.length === 0 && nextDiff.is_image !== true)) {
                  return null;
                }

                return {
                  fileKey,
                  diff: nextDiff,
                };
              }),
            );

            const accumulatedDiffs = [
              { fileKey: selectedFileKey, diff },
              ...remainingDiffs.filter(
                (entry): entry is NonNullable<typeof entry> => entry !== null,
              ),
            ];

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

  const handleViewWorkingTreeDiff = async (scope: WorkingTreeDiffScope = "all") => {
    if (!activeRepoPath) return;

    try {
      const titleByScope: Record<WorkingTreeDiffScope, string> = {
        all: "Uncommitted Changes",
        unstaged: "Unstaged Changes",
        staged: "Staged Changes",
      };
      const emptyLabelByScope: Record<WorkingTreeDiffScope, string> = {
        all: "tracked changes",
        unstaged: "unstaged tracked changes",
        staged: "staged changes",
      };
      const diffEntries = Array.from(
        new Map(
          (visibleGitFiles ?? [])
            .filter((entry) => entry.status !== "untracked")
            .filter((entry) => {
              if (scope === "all") return true;
              return entry.staged === (scope === "staged");
            })
            .map((entry) => [`${entry.staged ? "staged" : "unstaged"}:${entry.path}`, entry]),
        ).entries(),
      );

      if (diffEntries.length === 0) {
        await showAlertDialog(`No ${emptyLabelByScope[scope]} with diffs.`, "Git Diff");
        return;
      }

      const diffItems = (
        await Promise.all(
          diffEntries.map(async ([fileKey, entry]) => {
            const diff = await getFileDiff(activeRepoPath, entry.path, entry.staged);
            if (!diff || (diff.lines.length === 0 && diff.is_image !== true)) {
              return null;
            }

            return { fileKey, diff };
          }),
        )
      ).filter((entry): entry is { fileKey: string; diff: GitDiff } => Boolean(entry));

      if (diffItems.length === 0) {
        await showAlertDialog("No changes to show.", "Git Diff");
        return;
      }

      const allStats = countDiffStats(diffItems.map((item) => item.diff));
      const title = titleByScope[scope];
      const multiDiff: MultiFileDiff = {
        title,
        repoPath: activeRepoPath,
        commitHash: "working-tree",
        files: diffItems.map((item) => item.diff),
        totalFiles: diffItems.length,
        totalAdditions: allStats.additions,
        totalDeletions: allStats.deletions,
        fileKeys: diffItems.map((item) => item.fileKey),
        initiallyExpandedFileKey: diffItems[0]?.fileKey,
        isLoading: false,
      };

      useBufferStore
        .getState()
        .actions.openBuffer(
          "diff://working-tree/all-files",
          `${title} (${diffItems.length} files)`,
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

    setIsLoadingCommitDiff(true);
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
    } finally {
      setIsLoadingCommitDiff(false);
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

  const handleViewBranchDiff = async (baseBranch: string) => {
    const targetBranch = gitStatus?.branch ?? "HEAD";
    if (!activeRepoPath || !onFileSelect || !baseBranch || baseBranch === targetBranch) return;

    const title = `${baseBranch}..${targetBranch}`;

    setIsLoadingBranchDiff(true);
    try {
      const diffs = await getRefDiff(activeRepoPath, baseBranch, targetBranch);

      if (diffs && diffs.length > 0) {
        const { additions, deletions } = countDiffStats(diffs);
        const multiDiff: MultiFileDiff = {
          title,
          repoPath: activeRepoPath,
          commitHash: title,
          files: diffs,
          totalFiles: diffs.length,
          totalAdditions: additions,
          totalDeletions: deletions,
        };

        const encodedTitle = encodeURIComponent(title);
        useBufferStore
          .getState()
          .actions.openBuffer(
            `diff://branch/${encodedTitle}/all-files`,
            `${title} (${diffs.length} files)`,
            "",
            false,
            undefined,
            true,
            true,
            multiDiff,
          );
        setShowBranchDiffList(false);
        setBranchDiffSearchQuery("");
      } else {
        await showAlertDialog(`No changes between ${baseBranch} and ${targetBranch}.`, "Git Diff");
      }
    } catch (error) {
      console.error("Error getting branch comparison:", error);
      await showAlertDialog(
        `Failed to compare ${baseBranch} and ${targetBranch}:\n${error}`,
        "Git Diff",
      );
    } finally {
      setIsLoadingBranchDiff(false);
    }
  };

  const handleGitViewWorktreeChange = useCallback(
    async (worktreePath: string) => {
      const opened = await openGitWorktreeWorkspace(worktreePath);
      if (!opened) return;

      const status = await getGitStatus(worktreePath);
      actions.setWorkspaceGitStatus(status, worktreePath);
      actions.setGitStatus(status);
    },
    [actions],
  );

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
        if (autoRefreshGitStatus) {
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
      onOpenBranchManager={handleOpenBranchManager}
      onShowBranchDiff={() => void handleShowBranchDiffList()}
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
  const filteredDiffCommits = useMemo(() => {
    const query = commitDiffSearchQuery.trim().toLowerCase();
    if (!query) {
      return commits;
    }

    return commits.filter((commit) =>
      matchesSearchQuery(query, [
        commit.message,
        commit.description ?? "",
        commit.author,
        commit.email ?? "",
        commit.hash,
        commit.hash.substring(0, 7),
      ]),
    );
  }, [commitDiffSearchQuery, commits]);
  const branchDiffBranches = useMemo(
    () => branches.filter((branch) => branch !== gitStatus?.branch),
    [branches, gitStatus?.branch],
  );
  const filteredBranchDiffBranches = useMemo(() => {
    const query = branchDiffSearchQuery.trim().toLowerCase();
    if (!query) {
      return branchDiffBranches;
    }

    return branchDiffBranches.filter((branch) => matchesSearchQuery(query, [branch]));
  }, [branchDiffBranches, branchDiffSearchQuery]);

  const gitTabOrder: GitSidebarTab[] = ["changes", "history"];
  const gitTabs: Array<{
    id: GitSidebarTab;
    label: string;
    icon: ReactNode;
  }> = [...gitSidebarTabOrder]
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
          <SidebarHeader className="justify-between bg-transparent p-0 backdrop-blur-none">
            <div className="flex items-center gap-2">{renderActionsButton()}</div>
          </SidebarHeader>
          <SidebarEmptyActionState className="h-full" message="No repository selected">
            {renderRepositoryEmptyActions()}
            {repoSelectionError ? (
              <span className="ui-text-sm mt-1.5 text-error">{repoSelectionError}</span>
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
          <SidebarHeader className="justify-between bg-transparent p-0 backdrop-blur-none">
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
          <SidebarHeader className="justify-between bg-transparent p-0 backdrop-blur-none">
            <div className="flex items-center gap-2">{renderActionsButton()}</div>
          </SidebarHeader>
          <SidebarEmptyActionState className="h-full" message="Not a Git repository">
            {renderRepositoryEmptyActions()}
            {repoSelectionError ? (
              <span className="ui-text-sm mt-1.5 text-error">{repoSelectionError}</span>
            ) : null}
          </SidebarEmptyActionState>
        </SidebarPanel>
        {renderGitActionsMenu({ hasGitRepo: false, onRefresh: handleManualRefresh })}
      </>
    );
  }

  const stagedFiles = visibleGitFiles.filter((f) => f.staged);
  const refreshAfterAction = autoRefreshGitStatus ? handleManualRefresh : undefined;
  const handleGitFileClick = openDiffOnClick ? handleViewFileDiff : handleOpenOriginalFile;

  return (
    <>
      <SidebarPanel className="ui-font ui-text-sm select-none gap-2 p-2">
        <div className="@container flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          <SidebarSectionSwitcher
            items={gitTabs}
            value={activeTab}
            onChange={(tab) => setActiveTab(tab as GitSidebarTab)}
          />

          <div className="flex min-w-0 shrink-0 items-end gap-2 overflow-hidden">
            {showRepositorySelector ? (
              <div className="flex min-w-0 shrink flex-col gap-0.5">
                <span className="ui-text-xs px-1 text-text-lighter">Repository</span>
                <GitProjectSelector
                  className="w-fit min-w-0 max-w-[9rem] shrink"
                  triggerClassName="w-fit"
                  onRepositoryChange={() => setRepoSelectionError(null)}
                />
              </div>
            ) : null}

            <div className="flex min-w-0 shrink flex-col gap-0.5">
              <span className="ui-text-xs px-1 text-text-lighter">Branch</span>
              <GitBranchManager
                currentBranch={gitStatus.branch}
                repoPath={activeRepoPath}
                paletteTarget
                openEventName={GIT_VIEW_BRANCH_MANAGER_EVENT}
                placement="up"
                triggerIconSize={14}
                triggerClassName="h-7 w-fit min-w-0 max-w-[8rem] justify-start px-2"
                triggerInputClassName="max-w-full"
                onBranchChange={() => void handleManualRefresh()}
              />
            </div>

            <div className="flex min-w-0 shrink flex-col gap-0.5">
              <span className="ui-text-xs px-1 text-text-lighter">Worktree</span>
              <GitWorktreeSwitcher
                repoPath={activeRepoPath}
                placement="up"
                triggerIconSize={14}
                triggerClassName="h-7 w-fit min-w-0 max-w-[8rem] justify-start px-2"
                triggerInputClassName="max-w-full"
                onWorktreeChange={(worktreePath) => void handleGitViewWorktreeChange(worktreePath)}
              />
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1 pb-0.5">
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
          </div>

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
                    onViewDiff={(scope) => void handleViewWorkingTreeDiff(scope)}
                    onShowCommitDiffPicker={handleShowCommitDiffList}
                    onShowBranchDiffPicker={() => void handleShowBranchDiffList()}
                    onShowStashDiffPicker={() => {
                      setShowStashList(true);
                      setStashSearchQuery("");
                    }}
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
                    repoPath={activeRepoPath}
                    showHeader={false}
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
        isOpen={showCommitDiffList}
        onClose={() => {
          setShowCommitDiffList(false);
          setCommitDiffSearchQuery("");
        }}
        query={commitDiffSearchQuery}
        onQueryChange={setCommitDiffSearchQuery}
        placeholder="Search commits..."
        meta={`${commits.length} commit${commits.length === 1 ? "" : "s"}`}
      >
        <CommandList>
          {filteredDiffCommits.length === 0 ? (
            <CommandEmpty>
              {commitDiffSearchQuery.trim() ? "No matching commits" : "No commits"}
            </CommandEmpty>
          ) : (
            <div className="space-y-1">
              {filteredDiffCommits.map((commit) => {
                const shortHash = commit.hash.substring(0, 7);

                return (
                  <CommandItem
                    key={commit.hash}
                    type="button"
                    onClick={() => {
                      void handleViewCommitDiff(commit.hash);
                      setShowCommitDiffList(false);
                      setCommitDiffSearchQuery("");
                    }}
                    disabled={isLoadingCommitDiff}
                    className="ui-font"
                  >
                    <ClockCounterClockwise size={14} className="shrink-0 text-text-lighter" />
                    <span className="ui-text-xs min-w-0 flex-1 truncate text-text">
                      {commit.message}
                    </span>
                    <span className="ui-text-xs shrink-0 editor-font text-text-lighter">
                      {shortHash}
                    </span>
                  </CommandItem>
                );
              })}
            </div>
          )}
        </CommandList>
      </GitCommandSurface>
      <GitCommandSurface
        isOpen={showBranchDiffList}
        onClose={() => {
          setShowBranchDiffList(false);
          setBranchDiffSearchQuery("");
        }}
        query={branchDiffSearchQuery}
        onQueryChange={setBranchDiffSearchQuery}
        placeholder="Compare current branch with..."
        meta={`${branchDiffBranches.length} branch${branchDiffBranches.length === 1 ? "" : "es"}`}
      >
        <CommandList>
          {filteredBranchDiffBranches.length === 0 ? (
            <CommandEmpty>
              {branchDiffSearchQuery.trim() ? "No matching branches" : "No other branches"}
            </CommandEmpty>
          ) : (
            <div className="space-y-1">
              {filteredBranchDiffBranches.map((branch) => (
                <CommandItem
                  key={branch}
                  type="button"
                  onClick={() => void handleViewBranchDiff(branch)}
                  disabled={isLoadingBranchDiff}
                  className="ui-font"
                >
                  <GitBranch size={14} className="shrink-0 text-text-lighter" />
                  <span className="ui-text-xs min-w-0 flex-1 truncate text-text">{branch}</span>
                  <span className="ui-text-xs shrink-0 text-text-lighter">
                    compare with {gitStatus.branch}
                  </span>
                </CommandItem>
              ))}
            </div>
          )}
        </CommandList>
      </GitCommandSurface>
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
                  className="group/stash ui-font ui-text-xs mb-1 flex min-h-7 w-full cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-left leading-[1.35] transition-colors hover:bg-hover focus:bg-hover focus:outline-none"
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
                  <Archive size={14} className="shrink-0 text-text-lighter" />
                  <span className="min-w-0 flex-1 truncate text-text" title={displayTitle}>
                    {displayTitle}
                  </span>
                  <span className="shrink-0 text-text-lighter/80">
                    {formatRelativeDate(stash.date)}
                  </span>
                  <span className="shrink-0 rounded border border-border/50 px-1 ui-text-xs leading-4 text-text-lighter/80">
                    {getStashPositionLabel(stash.index)}
                  </span>
                  <div className="ml-1 flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/stash:opacity-100 sm:group-focus-within/stash:opacity-100">
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
                      className="size-6 rounded text-text-lighter disabled:opacity-50"
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
                      className="size-6 rounded text-text-lighter disabled:opacity-50"
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
                      className="size-6 rounded text-error hover:bg-error/10 hover:text-error disabled:opacity-50"
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
