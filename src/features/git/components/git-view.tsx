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
} from "@/ui/icons";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { Button } from "@/ui/button";
import { ButtonGroup, ButtonGroupSeparator } from "@/ui/button-group";
import { CommandEmpty, CommandItemBadge, CommandItemRow, CommandList } from "@/ui/command";
import { Dropdown, type MenuItem } from "@/ui/dropdown";
import { EmptyState } from "@/ui/empty";
import { Spinner } from "@/ui/spinner";
import { showAlertDialog } from "@/ui/dialog";
import {
  SidebarFooter,
  SidebarIconButton,
  SidebarPanel,
  SidebarTabPanels,
  SidebarTabBar,
  SidebarWorkspace,
} from "@/ui/sidebar";
import { toast } from "sonner";
import { formatRelativeDate } from "@/utils/date";
import { matchesSearchQuery } from "@/utils/search-match";
import { getBranches } from "../api/git-branches-api";
import { getStatusDiffStats } from "../api/git-diff-api";
import { clearRepositoryDiscoveryCache, resolveRepositoryPath } from "../api/git-repo-api";
import { fetchChanges, pullChanges, pushChanges } from "../api/git-remotes-api";
import { applyStash, dropStash, popStash } from "../api/git-stash-api";
import { getGitStatus, initRepository } from "../api/git-status-api";
import { useGitDataController } from "../hooks/use-git-data-controller";
import { useGitDiffActions } from "../hooks/use-git-diff-actions";
import { useRepositoryStore } from "../stores/git-repository.store";
import { useGitStore } from "../stores/git.store";
import type { GitCommit, GitDiff, GitFile } from "../types/git.types";
import {
  type WorkingTreeDiffEntry,
  type WorkingTreeDiffScope,
} from "../services/working-tree-diff-loader";
import type { GitActionsMenuAnchorRect } from "../utils/git-actions-menu-position";
import { getStashDisplayTitle, getStashPositionLabel } from "../utils/git-stash-format";
import { openGitWorktreeWorkspace } from "../utils/git-worktree-open";
import {
  resolveMultiDiffSelection,
  selectMultiDiffFileByPath,
} from "../utils/multi-diff-selection";
import GitActionsMenu from "./git-actions-menu";
import GitBranchManager from "./git-branch-manager";
import GitCommitHistory, {
  GitCommitHistoryControls,
  type HistorySearchScope,
} from "./git-commit-history";
import { GitCommitFilesPanel } from "./git-commit-files-panel";
import GitCommitPanel from "../commit-composer/components/git-commit-panel";
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
type GitRemoteAction = "push" | "pull" | "fetch";

const REMOTE_ACTION_LABELS: Record<GitRemoteAction, { present: string; past: string }> = {
  push: { present: "Pushing", past: "Pushed" },
  pull: { present: "Pulling", past: "Pulled" },
  fetch: { present: "Fetching", past: "Fetched" },
};

type GitPaletteAction =
  | { type: "select-repository" }
  | { type: "show-tab"; tab: GitSidebarTab }
  | { type: "manage-branches"; tab?: "branches" | "worktrees" | "repositories" }
  | { type: "show-branch-diff" }
  | { type: "manage-remotes" }
  | { type: "manage-tags" }
  | { type: "view-stashes" }
  | { type: "initialize-repository" }
  | { type: "refresh" };

const GitView = ({ repoPath, onFileSelect, isActive }: GitViewProps) => {
  const activeBuffer = useBufferStore((state) =>
    getBufferById(state.buffers, state.activeBufferId),
  );
  const updateBufferContent = useBufferStore.use.actions().updateBufferContent;
  const gitStatus = useGitStore((state) => state.gitStatus);
  const isLoadingGitData = useGitStore((state) => state.isLoadingGitData);
  const actions = useGitStore((state) => state.actions);
  const commits = useGitStore((state) => state.commits);
  const branches = useGitStore((state) => state.branches);
  const stashes = useGitStore((state) => state.stashes);
  const { syncWorkspaceRepositories, setManualRepository } = useRepositoryStore.use.actions();
  const { activeRepoPath, refresh: handleManualRefresh } = useGitDataController({
    workspacePath: repoPath,
    isActive,
  });
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
  const rememberLastGitPanelMode = useSettingsStore(
    (state) => state.settings.rememberLastGitPanelMode,
  );
  const gitLastPanelMode = useSettingsStore((state) => state.settings.gitLastPanelMode);
  const gitSidebarTabOrder = useSettingsStore((state) => state.settings.gitSidebarTabOrder);
  const openDiffOnClick = useSettingsStore((state) => state.settings.openDiffOnClick);
  const updateSetting = useSettingsStore((state) => state.actions.updateSetting);
  const [activeTab, setActiveTab] = useState<GitSidebarTab>("changes");
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [historySearchScope, setHistorySearchScope] = useState<HistorySearchScope>("all");
  const [selectedHistoryCommit, setSelectedHistoryCommit] = useState<GitCommit | null>(null);
  const [selectedHistoryCommitFiles, setSelectedHistoryCommitFiles] = useState<GitDiff[]>([]);
  const [selectedHistoryFilePath, setSelectedHistoryFilePath] = useState<string | null>(null);
  const [isLoadingHistoryCommitFiles, setIsLoadingHistoryCommitFiles] = useState(false);
  const historyCommitRequestRef = useRef(0);
  const [fileDiffStats, setFileDiffStats] = useState<Record<string, GitFileDiffStats>>({});

  const [showCommitDiffList, setShowCommitDiffList] = useState(false);
  const [commitDiffSearchQuery, setCommitDiffSearchQuery] = useState("");
  const [showBranchDiffList, setShowBranchDiffList] = useState(false);
  const [branchDiffSearchQuery, setBranchDiffSearchQuery] = useState("");
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
  const handleBranchDiffOpened = useCallback(() => {
    setShowBranchDiffList(false);
    setBranchDiffSearchQuery("");
  }, []);
  const {
    isLoadingCommitDiff,
    isLoadingBranchDiff,
    openOriginalFile: handleOpenOriginalFile,
    viewFileDiff: handleViewFileDiff,
    viewWorkingTreeDiff: handleViewWorkingTreeDiff,
    viewCommitDiff: handleViewCommitDiff,
    viewStashDiff: handleViewStashDiff,
    viewTagComparison: handleViewTagComparison,
    viewBranchDiff: handleViewBranchDiff,
  } = useGitDiffActions({
    activeRepoPath,
    onFileSelect,
    gitFileByPath,
    workingTreeDiffEntriesByScope,
    commitByHash,
    currentBranch: gitStatus?.branch,
    onBranchDiffOpened: handleBranchDiffOpened,
  });
  const handleBackFromHistoryCommit = useCallback(() => {
    historyCommitRequestRef.current += 1;
    setSelectedHistoryCommit(null);
    setSelectedHistoryCommitFiles([]);
    setSelectedHistoryFilePath(null);
    setIsLoadingHistoryCommitFiles(false);
  }, []);
  const handleSelectHistoryCommit = useCallback(
    async (commit: GitCommit) => {
      const requestId = historyCommitRequestRef.current + 1;
      historyCommitRequestRef.current = requestId;
      setSelectedHistoryCommit(commit);
      setSelectedHistoryCommitFiles([]);
      setSelectedHistoryFilePath(null);
      setIsLoadingHistoryCommitFiles(true);

      const diffs = await handleViewCommitDiff(commit.hash, undefined, {
        fileNavigation: "external",
      });
      if (historyCommitRequestRef.current !== requestId) return;

      const files = diffs ?? [];
      const firstFile = files[0];
      setSelectedHistoryCommitFiles(files);
      setSelectedHistoryFilePath(
        firstFile ? firstFile.new_path || firstFile.old_path || firstFile.file_path : null,
      );
      setIsLoadingHistoryCommitFiles(false);
    },
    [handleViewCommitDiff],
  );
  const handleSelectHistoryCommitFile = useCallback(
    (filePath: string) => {
      if (!selectedHistoryCommit) return;
      setSelectedHistoryFilePath(filePath);

      if (
        activeBuffer?.type === "diff" &&
        activeBuffer.diffData &&
        "files" in activeBuffer.diffData &&
        activeBuffer.diffData.commitHash === selectedHistoryCommit.hash
      ) {
        const nextMultiDiff = selectMultiDiffFileByPath(activeBuffer.diffData, filePath);
        if (nextMultiDiff !== activeBuffer.diffData) {
          updateBufferContent(activeBuffer.id, activeBuffer.content, false, nextMultiDiff);
        }
        return;
      }

      void handleViewCommitDiff(selectedHistoryCommit.hash, filePath, {
        fileNavigation: "external",
      });
    },
    [activeBuffer, handleViewCommitDiff, selectedHistoryCommit, updateBufferContent],
  );

  useEffect(() => {
    if (
      !selectedHistoryCommit ||
      activeBuffer?.type !== "diff" ||
      !activeBuffer.diffData ||
      !("files" in activeBuffer.diffData) ||
      activeBuffer.diffData.commitHash !== selectedHistoryCommit.hash
    ) {
      return;
    }

    const selection = resolveMultiDiffSelection(activeBuffer.diffData);
    setSelectedHistoryFilePath(selection?.path ?? null);
  }, [activeBuffer, selectedHistoryCommit]);

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

  const handleRemoteAction = useCallback(
    async (action: GitRemoteAction) => {
      if (!activeRepoPath) {
        toast.error("No repository open");
        return;
      }

      setIsSyncMenuOpen(false);
      setRemoteAction(action);
      const label = REMOTE_ACTION_LABELS[action];
      const toastId = toast.info(`${label.present} changes...`, {
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
    setRepoSelectionError(null);
    handleBackFromHistoryCommit();
  }, [activeRepoPath, handleBackFromHistoryCommit, repoPath]);

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

  const handleOpenBranchManager = useCallback(
    (tab: "branches" | "worktrees" | "repositories" = "branches") => {
      window.dispatchEvent(new CustomEvent(GIT_VIEW_BRANCH_MANAGER_EVENT, { detail: { tab } }));
    },
    [],
  );

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
        handleBackFromHistoryCommit();
        setActiveTab(detail.tab);
        return;
      }

      if (detail.type === "manage-branches") {
        handleOpenBranchManager(detail.tab);
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
    handleBackFromHistoryCommit,
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
        await handleManualRefresh();
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
    <SidebarIconButton
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
    </SidebarIconButton>
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
  }> = [...gitSidebarTabOrder]
    .filter((id): id is GitSidebarTab => id === "changes" || id === "history")
    .sort((a, b) => gitTabOrder.indexOf(a) - gitTabOrder.indexOf(b))
    .map((id) => {
      const tabMap: Record<GitSidebarTab, { id: GitSidebarTab; label: string }> = {
        changes: {
          id: "changes",
          label: "Changes",
        },
        history: {
          id: "history",
          label: "History",
        },
      };

      return tabMap[id];
    })
    .filter(Boolean);

  if (!activeRepoPath) {
    return (
      <>
        <SidebarWorkspace title="Source Control" actions={renderActionsButton()}>
          <EmptyState
            layout="sidebar"
            title="No repository selected"
            message={repoSelectionError}
            action={{
              label: isSelectingRepo ? "Selecting..." : "Browse",
              icon: <FolderSimpleStar weight="duotone" />,
              disabled: isSelectingRepo,
              onClick: () => void handleSelectRepository(),
            }}
            secondaryAction={{
              label: isInitializingRepo ? "Initializing..." : "Initialize",
              icon: <GitBranch weight="duotone" />,
              variant: "ghost",
              disabled: !repoPath || isInitializingRepo,
              tooltip: repoPath
                ? "Initialize Git repository"
                : "Open a folder before initializing Git",
              onClick: () => void handleInitializeRepository(),
            }}
          />
        </SidebarWorkspace>
        {renderGitActionsMenu({ hasGitRepo: false, onRefresh: handleManualRefresh })}
      </>
    );
  }

  if (isLoadingGitData && !gitStatus) {
    return (
      <>
        <SidebarWorkspace title="Source Control" actions={renderActionsButton()}>
          <EmptyState
            layout="sidebar"
            message={<Spinner label="Loading Git status" showLabel compact />}
          />
        </SidebarWorkspace>
        {renderGitActionsMenu({ hasGitRepo: false, onRefresh: handleManualRefresh })}
      </>
    );
  }

  if (!gitStatus) {
    return (
      <>
        <SidebarWorkspace title="Source Control" actions={renderActionsButton()}>
          <EmptyState
            layout="sidebar"
            title="Not a Git repository"
            message={repoSelectionError}
            action={{
              label: isSelectingRepo ? "Selecting..." : "Browse",
              icon: <FolderSimpleStar weight="duotone" />,
              disabled: isSelectingRepo,
              onClick: () => void handleSelectRepository(),
            }}
            secondaryAction={{
              label: isInitializingRepo ? "Initializing..." : "Initialize",
              icon: <GitBranch weight="duotone" />,
              variant: "ghost",
              disabled: !repoPath || isInitializingRepo,
              tooltip: repoPath
                ? "Initialize Git repository"
                : "Open a folder before initializing Git",
              onClick: () => void handleInitializeRepository(),
            }}
          />
        </SidebarWorkspace>
        {renderGitActionsMenu({ hasGitRepo: false, onRefresh: handleManualRefresh })}
      </>
    );
  }

  const refreshAfterAction = handleManualRefresh;
  const handleGitFileClick = openDiffOnClick ? handleViewFileDiff : handleOpenOriginalFile;

  if (selectedHistoryCommit) {
    return (
      <SidebarPanel className="font-sans ui-text-sm select-none">
        <GitCommitFilesPanel
          commit={selectedHistoryCommit}
          files={selectedHistoryCommitFiles}
          selectedFilePath={selectedHistoryFilePath}
          isLoading={isLoadingHistoryCommitFiles}
          onBack={handleBackFromHistoryCommit}
          onSelectFile={handleSelectHistoryCommitFile}
        />
      </SidebarPanel>
    );
  }

  return (
    <>
      <SidebarWorkspace
        title={
          <GitBranchManager
            currentBranch={gitStatus.branch}
            repoPath={activeRepoPath}
            paletteTarget
            openEventName={GIT_VIEW_BRANCH_MANAGER_EVENT}
            onBranchChange={() => void handleManualRefresh()}
            onWorktreeChange={(worktreePath) => void handleGitViewWorktreeChange(worktreePath)}
            onRepositoryChange={() => setRepoSelectionError(null)}
          />
        }
        actions={
          <>
            {activeTab === "history" ? (
              <GitCommitHistoryControls
                searchQuery={historySearchQuery}
                searchScope={historySearchScope}
                onSearchQueryChange={setHistorySearchQuery}
                onSearchScopeChange={setHistorySearchScope}
              />
            ) : null}
            <ButtonGroup ref={syncMenuAnchorRef} className="min-w-0 max-w-full">
              <Button
                type="button"
                variant="default"
                size="xs"
                className="min-w-0 flex-1"
                onClick={() => void handleRemoteAction(primaryRemoteAction)}
                disabled={!activeRepoPath || isRemoteActionLoading}
                aria-label={`${syncActionLabel} remote changes`}
              >
                <span className="min-w-0 truncate whitespace-nowrap">{syncActionLabel}</span>
              </Button>
              <ButtonGroupSeparator />
              <Button
                type="button"
                variant="default"
                size="icon-xs"
                onClick={() => setIsSyncMenuOpen((open) => !open)}
                disabled={!activeRepoPath || isRemoteActionLoading}
                active={isSyncMenuOpen}
                aria-label="Choose remote action"
                aria-haspopup="menu"
                aria-expanded={isSyncMenuOpen}
              >
                <CaretDown className="size-3" />
              </Button>
            </ButtonGroup>
            <Dropdown
              isOpen={isSyncMenuOpen}
              anchorRef={syncMenuAnchorRef}
              anchorAlign="end"
              onClose={() => setIsSyncMenuOpen(false)}
              items={syncMenuItems}
              className="min-w-33"
            />
            {renderActionsButton()}
          </>
        }
        className="font-sans ui-text-sm select-none"
      >
        <SidebarTabBar items={gitTabs} value={activeTab} onChange={setActiveTab}>
          <SidebarTabPanels
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
                    onSelectCommit={(commit) => void handleSelectHistoryCommit(commit)}
                    repoPath={activeRepoPath}
                    ahead={gitStatus.ahead}
                    behind={gitStatus.behind}
                    searchQuery={historySearchQuery}
                    searchScope={historySearchScope}
                  />
                ),
              },
            ].filter((item) => gitTabs.some((tab) => tab.id === item.id))}
          />

          <SidebarFooter>
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
        </SidebarTabBar>
      </SidebarWorkspace>

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
                    icon={<ClockCounterClockwise size={14} className="text-subtle-foreground" />}
                    title={commit.message}
                    accessory={<CommandItemBadge>{shortHash}</CommandItemBadge>}
                    onClick={() => {
                      void handleViewCommitDiff(commit.hash);
                      setShowCommitDiffList(false);
                      setCommitDiffSearchQuery("");
                    }}
                    disabled={isLoadingCommitDiff}
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
                  icon={<GitBranch size={14} className="text-subtle-foreground" />}
                  title={branch}
                  description={`compare with ${gitStatus.branch}`}
                  onClick={() => void handleViewBranchDiff(branch)}
                  disabled={isLoadingBranchDiff}
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
                  icon={<Archive size={14} className="text-subtle-foreground" />}
                  title={displayTitle}
                  description={
                    <>
                      <span className="shrink-0">{formatRelativeDate(stash.date)}</span>
                      <CommandItemBadge>{getStashPositionLabel(stash.index)}</CommandItemBadge>
                    </>
                  }
                  contentLayout="inline"
                  disabled={isActionLoading}
                  className="group/stash text-subtle-foreground hover:text-foreground"
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
                        size="icon-xs"
                        className="text-subtle-foreground disabled:opacity-50"
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
                        size="icon-xs"
                        className="text-subtle-foreground disabled:opacity-50"
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
                        size="icon-xs"
                        className="text-destructive hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
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
