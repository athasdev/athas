import { open } from "@tauri-apps/plugin-dialog";
import {
  ArchiveIcon as Archive,
  CaretDownIcon as CaretDown,
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
import { CommandEmpty, CommandItemBadge, CommandItemRow, CommandList } from "@/ui/command";
import { Dropdown, type MenuItem } from "@/ui/dropdown";
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
import { SplitActionButton } from "@/ui/split-action-button";
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
import { fetchChanges, pullChanges, pushChanges } from "../api/git-remotes-api";
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
const GIT_VIEW_BRANCH_MANAGER_EVENT = "athas:open-git-view-branch-manager";
type WorkingTreeDiffScope = "all" | "unstaged" | "staged";
type WorkingTreeDiffEntry = readonly [fileKey: string, file: GitFile];
type LoadedWorkingTreeDiff = { fileKey: string; diff: GitDiff };
type GitRemoteAction = "push" | "pull" | "fetch";

const WORKING_TREE_DIFF_BATCH_SIZE = 8;
const WORKING_TREE_DIFF_FILE_LIMIT = 1_000;

const REMOTE_ACTION_LABELS: Record<GitRemoteAction, { present: string; past: string }> = {
  push: { present: "Pushing", past: "Pushed" },
  pull: { present: "Pulling", past: "Pulled" },
  fetch: { present: "Fetching", past: "Fetched" },
};

const gitEmptyActionButtonClassName =
  "h-6 border border-border/70 bg-secondary-bg/60 px-2 text-text-lighter ui-text-base hover:bg-hover hover:text-text";

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

const yieldToRenderer = () => new Promise((resolve) => globalThis.setTimeout(resolve, 0));

async function loadWorkingTreeDiffsProgressively({
  repoPath,
  bufferId,
  title,
  diffEntries,
  initialDiffs = [],
  initialProcessed = 0,
  initiallyExpandedFileKey,
}: {
  repoPath: string;
  bufferId: string;
  title: string;
  diffEntries: WorkingTreeDiffEntry[];
  initialDiffs?: LoadedWorkingTreeDiff[];
  initialProcessed?: number;
  initiallyExpandedFileKey?: string;
}) {
  const total = initialProcessed + diffEntries.length;
  const diffEntriesToLoad = diffEntries.slice(
    0,
    Math.max(0, WORKING_TREE_DIFF_FILE_LIMIT - initialDiffs.length),
  );
  const loadedDiffs: LoadedWorkingTreeDiff[] = [...initialDiffs];

  const publish = (processed: number, isLoading: boolean) => {
    const stats = countDiffStats(loadedDiffs.map((item) => item.diff));

    useBufferStore.getState().actions.updateBufferContent(bufferId, "", false, {
      title,
      repoPath,
      commitHash: "working-tree",
      files: loadedDiffs.map((item) => item.diff),
      totalFiles: loadedDiffs.length,
      totalAdditions: stats.additions,
      totalDeletions: stats.deletions,
      fileKeys: loadedDiffs.map((item) => item.fileKey),
      initiallyExpandedFileKey: initiallyExpandedFileKey ?? loadedDiffs[0]?.fileKey,
      isLoading,
      indexingProgress: {
        processed,
        total,
        label: "Indexing",
      },
    } satisfies MultiFileDiff);
  };

  publish(initialProcessed, diffEntriesToLoad.length > 0);

  let processed = initialProcessed;
  for (let index = 0; index < diffEntriesToLoad.length; index += WORKING_TREE_DIFF_BATCH_SIZE) {
    const batch = diffEntriesToLoad.slice(index, index + WORKING_TREE_DIFF_BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async ([fileKey, entry]) => {
        const diff = await getFileDiff(repoPath, entry.path, entry.staged);
        if (!diff || (diff.lines.length === 0 && diff.is_image !== true)) {
          return null;
        }

        return { fileKey, diff };
      }),
    );

    processed += batch.length;
    loadedDiffs.push(
      ...batchResults.filter((entry): entry is LoadedWorkingTreeDiff => entry !== null),
    );
    publish(processed, index + batch.length < diffEntriesToLoad.length);
    await yieldToRenderer();
  }
}

const GitView = ({ repoPath, onFileSelect, isActive }: GitViewProps) => {
  const gitStatus = useGitStore((state) => state.gitStatus);
  const isLoadingGitData = useGitStore((state) => state.isLoadingGitData);
  const isRefreshing = useGitStore((state) => state.isRefreshing);
  const actions = useGitStore((state) => state.actions);
  const commits = useGitStore((state) => state.commits);
  const branches = useGitStore((state) => state.branches);
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
  const syncMenuAnchorRef = useRef<HTMLDivElement>(null);
  const [isSyncMenuOpen, setIsSyncMenuOpen] = useState(false);
  const [remoteAction, setRemoteAction] = useState<GitRemoteAction | null>(null);

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

  const {
    gitFileByPath,
    visibleGitFiles,
    visibleGitFileKeySet,
    workingTreeDiffEntriesByScope,
    stagedFiles,
  } = useMemo(() => {
    const nextGitFileByPath = new Map<string, GitFile>();
    const nextVisibleGitFiles: GitFile[] = [];
    const nextVisibleGitFileKeySet = new Set<string>();
    const nextWorkingTreeDiffEntriesByScope: Record<WorkingTreeDiffScope, WorkingTreeDiffEntry[]> =
      {
        all: [],
        unstaged: [],
        staged: [],
      };
    const nextStagedFiles: GitFile[] = [];
    const seenDiffableFileKeys = new Set<string>();

    for (const file of gitStatus?.files ?? []) {
      if (!nextGitFileByPath.has(file.path)) {
        nextGitFileByPath.set(file.path, file);
      }

      if (!showUntrackedFiles && file.status === "untracked") {
        continue;
      }

      const fileKey = `${file.staged ? "staged" : "unstaged"}:${file.path}`;
      nextVisibleGitFiles.push(file);
      nextVisibleGitFileKeySet.add(fileKey);

      if (file.staged) {
        nextStagedFiles.push(file);
      }

      if (file.status === "untracked" || seenDiffableFileKeys.has(fileKey)) {
        continue;
      }

      seenDiffableFileKeys.add(fileKey);
      const entry: WorkingTreeDiffEntry = [fileKey, file];
      nextWorkingTreeDiffEntriesByScope.all.push(entry);
      nextWorkingTreeDiffEntriesByScope[file.staged ? "staged" : "unstaged"].push(entry);
    }

    return {
      gitFileByPath: nextGitFileByPath,
      visibleGitFiles: nextVisibleGitFiles,
      visibleGitFileKeySet: nextVisibleGitFileKeySet,
      workingTreeDiffEntriesByScope: nextWorkingTreeDiffEntriesByScope,
      stagedFiles: nextStagedFiles,
    };
  }, [gitStatus?.files, showUntrackedFiles]);
  const commitByHash = useMemo(() => {
    return new Map(commits.map((commit) => [commit.hash, commit] as const));
  }, [commits]);

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

  const handleRemoteAction = useCallback(
    async (action: GitRemoteAction) => {
      if (!activeRepoPath) {
        toast.error("No repository open");
        return;
      }

      setIsSyncMenuOpen(false);
      setRemoteAction(action);
      const label = REMOTE_ACTION_LABELS[action];
      const toastId = toast.show({
        message: `${label.present} changes...`,
        type: "info",
        duration: Infinity,
      });

      try {
        const result =
          action === "push"
            ? await pushChanges(activeRepoPath)
            : action === "pull"
              ? await pullChanges(activeRepoPath)
              : await fetchChanges(activeRepoPath);

        toast.dismiss(toastId);

        if (result.success) {
          toast.success(`${label.past} changes successfully.`);
          await handleManualRefresh();
          return;
        }

        toast.error(result.error || `Failed to ${action} changes.`);
      } catch (error) {
        toast.dismiss(toastId);
        toast.error(error instanceof Error ? error.message : `Failed to ${action} changes.`);
      } finally {
        setRemoteAction(null);
      }
    },
    [activeRepoPath, handleManualRefresh],
  );

  const aheadCount = gitStatus?.ahead ?? 0;
  const behindCount = gitStatus?.behind ?? 0;
  const primaryRemoteAction: GitRemoteAction =
    aheadCount > 0 ? "push" : behindCount > 0 ? "pull" : "fetch";
  const syncActionLabel =
    remoteAction !== null
      ? REMOTE_ACTION_LABELS[remoteAction].present
      : primaryRemoteAction === "push"
        ? `Push ${aheadCount}`
        : primaryRemoteAction === "pull"
          ? `Pull ${behindCount}`
          : "Fetch";
  const isRemoteActionLoading = remoteAction !== null;

  const syncMenuItems = useMemo<MenuItem[]>(
    () => [
      {
        id: "push",
        label: aheadCount > 0 ? `Push ${aheadCount} commit${aheadCount !== 1 ? "s" : ""}` : "Push",
        icon: <Upload />,
        disabled: isRemoteActionLoading,
        onClick: () => void handleRemoteAction("push"),
      },
      {
        id: "pull",
        label:
          behindCount > 0 ? `Pull ${behindCount} commit${behindCount !== 1 ? "s" : ""}` : "Pull",
        icon: <Download weight="fill" />,
        disabled: isRemoteActionLoading,
        onClick: () => void handleRemoteAction("pull"),
      },
      {
        id: "fetch",
        label: "Fetch",
        icon: <RefreshCw />,
        disabled: isRemoteActionLoading,
        onClick: () => void handleRemoteAction("fetch"),
      },
    ],
    [aheadCount, behindCount, handleRemoteAction, isRemoteActionLoading],
  );

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
      const nextFileDiffStats: Record<string, GitFileDiffStats> = {};
      for (const stat of await getStatusDiffStats(activeRepoPath)) {
        const key = `${stat.staged ? "staged" : "unstaged"}:${stat.file_path}`;
        if (visibleGitFileKeySet.has(key)) {
          nextFileDiffStats[key] = { additions: stat.additions, deletions: stat.deletions };
        }
      }

      if (!isCancelled) {
        setFileDiffStats(nextFileDiffStats);
      }
    };

    void loadFileDiffStats();

    return () => {
      isCancelled = true;
    };
  }, [activeRepoPath, visibleGitFiles.length, visibleGitFileKeySet]);

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

      const file = gitFileByPath.get(actualFilePath);

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
        const diffEntries = workingTreeDiffEntriesByScope.all.filter(
          ([fileKey]) => fileKey !== selectedFileKey,
        );

        if (diffEntries.length > 0) {
          void (async () => {
            await loadWorkingTreeDiffsProgressively({
              repoPath,
              bufferId,
              title: "Uncommitted Changes",
              diffEntries,
              initialDiffs: [{ fileKey: selectedFileKey, diff }],
              initialProcessed: 1,
              initiallyExpandedFileKey: selectedFileKey,
            });
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
      const diffEntries = workingTreeDiffEntriesByScope[scope];

      if (diffEntries.length === 0) {
        await showAlertDialog(`No ${emptyLabelByScope[scope]} with diffs.`, "Git Diff");
        return;
      }

      const title = titleByScope[scope];
      const multiDiff: MultiFileDiff = {
        title,
        repoPath: activeRepoPath,
        commitHash: "working-tree",
        files: [],
        totalFiles: 0,
        totalAdditions: 0,
        totalDeletions: 0,
        fileKeys: [],
        isLoading: true,
        indexingProgress: {
          processed: 0,
          total: diffEntries.length,
          label: "Indexing",
        },
      };

      const bufferId = useBufferStore
        .getState()
        .actions.openBuffer(
          "diff://working-tree/all-files",
          title,
          "",
          false,
          undefined,
          true,
          true,
          multiDiff,
        );

      void loadWorkingTreeDiffsProgressively({
        repoPath: activeRepoPath,
        bufferId,
        title,
        diffEntries,
      });
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
      const commit = commitByHash.get(commitHash);

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
        className={gitEmptyActionButtonClassName}
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
        className={gitEmptyActionButtonClassName}
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
              <span className="ui-text-base mt-1.5 text-error">{repoSelectionError}</span>
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
              <span className="ui-text-base mt-1.5 text-error">{repoSelectionError}</span>
            ) : null}
          </SidebarEmptyActionState>
        </SidebarPanel>
        {renderGitActionsMenu({ hasGitRepo: false, onRefresh: handleManualRefresh })}
      </>
    );
  }

  const refreshAfterAction = autoRefreshGitStatus ? handleManualRefresh : undefined;
  const handleGitFileClick = openDiffOnClick ? handleViewFileDiff : handleOpenOriginalFile;

  return (
    <>
      <SidebarPanel className="ui-font ui-text-base select-none gap-2 p-2">
        <div className="@container flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
          <SidebarSectionSwitcher
            items={gitTabs}
            value={activeTab}
            onChange={(tab) => setActiveTab(tab as GitSidebarTab)}
          />

          <div className="flex min-w-0 shrink-0 items-end gap-2 overflow-hidden">
            <div className="flex min-w-0 shrink flex-col">
              <GitBranchManager
                currentBranch={gitStatus.branch}
                repoPath={activeRepoPath}
                paletteTarget
                openEventName={GIT_VIEW_BRANCH_MANAGER_EVENT}
                onBranchChange={() => void handleManualRefresh()}
                onWorktreeChange={(worktreePath) => void handleGitViewWorktreeChange(worktreePath)}
                onRepositoryChange={() => setRepoSelectionError(null)}
              />
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1 pb-0.5">
              <SplitActionButton
                ref={syncMenuAnchorRef}
                label={syncActionLabel}
                actionAriaLabel={`${syncActionLabel} remote changes`}
                menuAriaLabel="Choose remote action"
                menuIcon={<CaretDown className="size-3" />}
                onAction={() => void handleRemoteAction(primaryRemoteAction)}
                onMenu={() => setIsSyncMenuOpen((open) => !open)}
                disabled={!activeRepoPath || isRemoteActionLoading}
                menuDisabled={!activeRepoPath || isRemoteActionLoading}
                active={isSyncMenuOpen}
                expanded={isSyncMenuOpen}
              />
              <Dropdown
                isOpen={isSyncMenuOpen}
                anchorRef={syncMenuAnchorRef}
                anchorAlign="end"
                onClose={() => setIsSyncMenuOpen(false)}
                items={syncMenuItems}
                className="min-w-[132px]"
              />
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
                    ahead={gitStatus.ahead}
                    behind={gitStatus.behind}
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
                  <CommandItemRow
                    key={commit.hash}
                    type="button"
                    icon={<ClockCounterClockwise size={14} className="text-text-lighter" />}
                    title={commit.message}
                    accessory={<CommandItemBadge>{shortHash}</CommandItemBadge>}
                    onClick={() => {
                      void handleViewCommitDiff(commit.hash);
                      setShowCommitDiffList(false);
                      setCommitDiffSearchQuery("");
                    }}
                    disabled={isLoadingCommitDiff}
                    className="min-h-9"
                  />
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
                <CommandItemRow
                  key={branch}
                  type="button"
                  icon={<GitBranch size={14} className="text-text-lighter" />}
                  title={branch}
                  description={`compare with ${gitStatus.branch}`}
                  onClick={() => void handleViewBranchDiff(branch)}
                  disabled={isLoadingBranchDiff}
                  className="min-h-9"
                />
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
                <CommandItemRow
                  key={stash.index}
                  as="div"
                  icon={<Archive size={14} className="text-text-lighter" />}
                  title={displayTitle}
                  description={
                    <>
                      <span className="shrink-0">{formatRelativeDate(stash.date)}</span>
                      <CommandItemBadge>{getStashPositionLabel(stash.index)}</CommandItemBadge>
                    </>
                  }
                  contentLayout="inline"
                  disabled={isActionLoading}
                  className="group/stash min-h-9 text-text-lighter hover:text-text"
                  onClick={() => {
                    void handleViewStashDiff(stash.index);
                    setShowStashList(false);
                    setStashSearchQuery("");
                  }}
                  action={
                    <div className="ml-auto flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover/stash:opacity-100 sm:group-focus-within/stash:opacity-100">
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
                        className="size-6 rounded-[var(--app-radius-control-sm)] text-text-lighter disabled:opacity-50"
                        tooltip="Apply stash"
                      >
                        <Download weight="fill" />
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
                        className="size-6 rounded-[var(--app-radius-control-sm)] text-text-lighter disabled:opacity-50"
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
                        className="size-6 rounded-[var(--app-radius-control-sm)] text-error hover:bg-error/10 hover:text-error disabled:opacity-50"
                        tooltip="Drop stash"
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  }
                />
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
