import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { showConfirmDialog, showPromptDialog } from "@/ui/dialog";
import {
  checkoutBranch,
  createBranch as createGitBranch,
  deleteBranch as deleteGitBranch,
  getBranches,
} from "../api/git-branches-api";
import { commitChanges } from "../api/git-commits-api";
import { getStatusDiffStats } from "../api/git-diff-api";
import { fetchChanges, pullChanges, pushChanges } from "../api/git-remotes-api";
import { applyStash, createStash, dropStash, popStash } from "../api/git-stash-api";
import { discardFileChanges, setFilesStaged } from "../api/git-status-api";
import {
  generateCommitMessage,
  getCommitMessageGenerationError,
} from "../commit-composer/services/commit-message-generation";
import { useGitDataController } from "../hooks/use-git-data-controller";
import { useGitDiffActions } from "../hooks/use-git-diff-actions";
import type {
  WorkingTreeDiffEntry,
  WorkingTreeDiffScope,
} from "../services/working-tree-diff-loader";
import { useGitBlameStore } from "../stores/git-blame.store";
import { useGitStore } from "../stores/git.store";
import type { GitFile } from "../types/git.types";

export type RemoteAction = "push" | "pull" | "fetch";

export interface ChangeFile extends GitFile {
  key: string;
  name: string;
  dir: string;
  additions: number;
  deletions: number;
}

export interface SourceControlModelProps {
  repoPath?: string;
  onFileSelect?: (path: string, isDir: boolean) => void;
  isActive?: boolean;
}

export const fileKey = (file: GitFile) => `${file.staged ? "staged" : "unstaged"}:${file.path}`;

function toChangeFile(
  file: GitFile,
  stats: Record<string, { additions: number; deletions: number }>,
) {
  const key = fileKey(file);
  const parts = file.path.split("/");
  const name = parts.pop() || file.path;
  return {
    ...file,
    key,
    name,
    dir: parts.join("/"),
    additions: stats[key]?.additions ?? 0,
    deletions: stats[key]?.deletions ?? 0,
  } satisfies ChangeFile;
}

export function useSourceControlModel({
  repoPath,
  onFileSelect,
  isActive,
}: SourceControlModelProps) {
  const gitStatus = useGitStore((state) => state.gitStatus);
  const commits = useGitStore((state) => state.commits);
  const branches = useGitStore((state) => state.branches);
  const stashes = useGitStore((state) => state.stashes);
  const isLoading = useGitStore((state) => state.isLoadingGitData);
  const hasMoreCommits = useGitStore((state) => state.hasMoreCommits);
  const loadMoreCommits = useGitStore((state) => state.actions.loadMoreCommits);
  const showUntrackedFiles = useSettingsStore((state) => state.settings.showUntrackedFiles);
  const aiModelId = useSettingsStore((state) => state.settings.aiAutocompleteModelId);
  const openDiffOnClick = useSettingsStore((state) => state.settings.openDiffOnClick);
  const { activeRepoPath, refresh } = useGitDataController({ workspacePath: repoPath, isActive });

  const [stats, setStats] = useState<Record<string, { additions: number; deletions: number }>>({});
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  const [remoteAction, setRemoteAction] = useState<RemoteAction | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  const files = useMemo(
    () =>
      (gitStatus?.files ?? [])
        .filter((file) => showUntrackedFiles || file.status !== "untracked")
        .map((file) => toChangeFile(file, stats)),
    [gitStatus?.files, showUntrackedFiles, stats],
  );
  const staged = useMemo(() => files.filter((file) => file.staged), [files]);
  const unstaged = useMemo(() => files.filter((file) => !file.staged), [files]);
  const totals = useMemo(
    () =>
      files.reduce(
        (sum, file) => ({
          additions: sum.additions + file.additions,
          deletions: sum.deletions + file.deletions,
        }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  );

  const { gitFileByPath, entriesByScope } = useMemo(() => {
    const byPath = new Map<string, GitFile>();
    const scopes: Record<WorkingTreeDiffScope, WorkingTreeDiffEntry[]> = {
      all: [],
      unstaged: [],
      staged: [],
    };
    for (const file of files) {
      if (!byPath.has(file.path)) byPath.set(file.path, file);
      if (file.status === "untracked") continue;
      const entry: WorkingTreeDiffEntry = [file.key, file];
      scopes.all.push(entry);
      scopes[file.staged ? "staged" : "unstaged"].push(entry);
    }
    return { gitFileByPath: byPath, entriesByScope: scopes };
  }, [files]);
  const commitByHash = useMemo(() => new Map(commits.map((c) => [c.hash, c] as const)), [commits]);

  const diff = useGitDiffActions({
    activeRepoPath,
    onFileSelect,
    gitFileByPath,
    workingTreeDiffEntriesByScope: entriesByScope,
    commitByHash,
    currentBranch: gitStatus?.branch,
  });

  const statusFilesLength = gitStatus?.files.length ?? 0;
  useEffect(() => {
    if (!activeRepoPath || statusFilesLength === 0) {
      setStats({});
      return;
    }
    let cancelled = false;
    void getStatusDiffStats(activeRepoPath).then((result) => {
      if (cancelled) return;
      const next: Record<string, { additions: number; deletions: number }> = {};
      for (const stat of result) {
        next[`${stat.staged ? "staged" : "unstaged"}:${stat.file_path}`] = {
          additions: stat.additions,
          deletions: stat.deletions,
        };
      }
      setStats(next);
    });
    return () => {
      cancelled = true;
    };
  }, [activeRepoPath, gitStatus, statusFilesLength]);

  const setStaged = useCallback(
    async (targets: ChangeFile[], nextStaged: boolean) => {
      if (!activeRepoPath || targets.length === 0) return;
      const keys = targets.map((file) => file.key);
      setBusyKeys((prev) => new Set([...prev, ...keys]));
      try {
        await setFilesStaged(
          activeRepoPath,
          Array.from(new Set(targets.map((file) => file.path))),
          nextStaged,
        );
        await refresh();
      } finally {
        setBusyKeys((prev) => {
          const next = new Set(prev);
          for (const key of keys) next.delete(key);
          return next;
        });
      }
    },
    [activeRepoPath, refresh],
  );

  const discard = useCallback(
    async (targets: ChangeFile[]) => {
      if (!activeRepoPath || targets.length === 0) return;
      const label = targets.length === 1 ? targets[0]!.name : `${targets.length} files`;
      const confirmed = await showConfirmDialog(
        `Discard changes in ${label}? This can't be undone.`,
        {
          title: "Discard changes",
          confirmLabel: "Discard",
        },
      );
      if (!confirmed) return;
      for (const file of targets) {
        await discardFileChanges(activeRepoPath, file.path);
      }
      await refresh();
    },
    [activeRepoPath, refresh],
  );

  const openDiff = useCallback(
    (file: ChangeFile) => {
      if (file.status === "untracked") {
        void diff.openOriginalFile(file.path);
        return;
      }
      void diff.viewFileDiff(file.path, file.staged);
    },
    [diff],
  );
  const openFile = useCallback((file: ChangeFile) => void diff.openOriginalFile(file.path), [diff]);
  const openPrimary = openDiffOnClick ? openDiff : openFile;

  const commit = useCallback(
    async (message: string, options: { stageAll?: boolean; andPush?: boolean } = {}) => {
      if (!activeRepoPath || !message.trim() || isCommitting) return false;
      setIsCommitting(true);
      try {
        if (options.stageAll && unstaged.length > 0) {
          await setFilesStaged(
            activeRepoPath,
            unstaged.map((file) => file.path),
            true,
          );
        }
        const ok = await commitChanges(activeRepoPath, message.trim());
        if (!ok) {
          toast.error("Commit failed");
          return false;
        }
        toast.success("Committed");
        if (options.andPush) {
          const result = await pushChanges(activeRepoPath);
          if (result.success) toast.success("Pushed");
          else toast.error(result.error || "Push failed");
        }
        await refresh();
        return true;
      } finally {
        setIsCommitting(false);
      }
    },
    [activeRepoPath, isCommitting, refresh, unstaged],
  );

  const generateMessage = useCallback(
    async (draft: string) => {
      if (!activeRepoPath || staged.length === 0 || isGenerating) return null;
      setIsGenerating(true);
      try {
        const message = await generateCommitMessage({
          model: aiModelId,
          repoPath: activeRepoPath,
          currentBranch: gitStatus?.branch,
          stagedFiles: staged,
          draft,
          mode: "title",
        });
        return message || null;
      } catch (error) {
        toast.error(getCommitMessageGenerationError(error, "Failed to generate message"));
        return null;
      } finally {
        setIsGenerating(false);
      }
    },
    [activeRepoPath, aiModelId, gitStatus?.branch, isGenerating, staged],
  );

  const runRemote = useCallback(
    async (action: RemoteAction) => {
      if (!activeRepoPath || remoteAction) return;
      setRemoteAction(action);
      try {
        const result =
          action === "push"
            ? await pushChanges(activeRepoPath)
            : action === "pull"
              ? await pullChanges(activeRepoPath)
              : await fetchChanges(activeRepoPath);
        if (result.success) {
          toast.success(action === "push" ? "Pushed" : action === "pull" ? "Pulled" : "Fetched");
          await refresh();
        } else {
          toast.error(result.error || `Failed to ${action}`);
        }
      } finally {
        setRemoteAction(null);
      }
    },
    [activeRepoPath, refresh, remoteAction],
  );

  const checkout = useCallback(
    async (branch: string) => {
      if (!activeRepoPath || branch === gitStatus?.branch) return;
      const repo = activeRepoPath;
      const result = await checkoutBranch(repo, branch);
      if (result.success) {
        useGitBlameStore.getState().actions.clearAllBlame();
        toast.success(`Switched to ${branch}`);
        await refresh();
        return;
      }
      if (result.hasChanges) {
        toast.warning(result.message, {
          duration: 10000,
          action: {
            label: "Stash & switch",
            onClick: async () => {
              if (!(await createStash(repo, `Switching to ${branch}`, true))) {
                toast.error("Failed to stash changes");
                return;
              }
              const retry = await checkoutBranch(repo, branch);
              if (retry.success) {
                useGitBlameStore.getState().actions.clearAllBlame();
                toast.success(`Stashed changes and switched to ${branch}`);
              } else {
                toast.error(retry.message || `Failed to switch to ${branch}`);
              }
              await refresh();
            },
          },
        });
        return;
      }
      toast.error(result.message || `Failed to switch to ${branch}`);
    },
    [activeRepoPath, gitStatus?.branch, refresh],
  );

  const reloadBranches = useCallback(async () => {
    if (!activeRepoPath) return;
    useGitStore.getState().actions.setBranches(await getBranches(activeRepoPath));
  }, [activeRepoPath]);

  const createBranch = useCallback(
    async (fromBranch?: string) => {
      if (!activeRepoPath) return;
      const base = fromBranch ?? gitStatus?.branch;
      const name = await showPromptDialog("Enter a name for the new branch.", {
        title: base ? `New branch from ${base}` : "New branch",
        placeholder: "feature/name",
        confirmLabel: "Create",
      });
      if (!name?.trim()) return;
      if (!(await createGitBranch(activeRepoPath, name.trim(), base))) {
        toast.error("Failed to create branch");
        return;
      }
      await reloadBranches();
      await refresh();
    },
    [activeRepoPath, gitStatus?.branch, refresh, reloadBranches],
  );

  const deleteBranch = useCallback(
    async (branch: string) => {
      if (!activeRepoPath || branch === gitStatus?.branch) return;
      const confirmed = await showConfirmDialog(`Delete branch "${branch}"?`, {
        title: "Delete branch",
        confirmLabel: "Delete",
      });
      if (!confirmed) return;
      if (!(await deleteGitBranch(activeRepoPath, branch))) {
        toast.error("Failed to delete branch");
        return;
      }
      await reloadBranches();
    },
    [activeRepoPath, gitStatus?.branch, reloadBranches],
  );

  const stash = useCallback(
    async (
      kind: "create" | "apply" | "pop" | "drop",
      index?: number,
      message?: string,
      paths?: string[],
    ) => {
      if (!activeRepoPath) return;
      const ok =
        kind === "create"
          ? await createStash(activeRepoPath, message, true, paths)
          : kind === "apply"
            ? await applyStash(activeRepoPath, index ?? 0)
            : kind === "pop"
              ? await popStash(activeRepoPath, index)
              : await dropStash(activeRepoPath, index ?? 0);
      if (!ok) toast.error(`Stash ${kind} failed`);
      await refresh();
    },
    [activeRepoPath, refresh],
  );

  const ahead = gitStatus?.ahead ?? 0;
  const behind = gitStatus?.behind ?? 0;
  const suggestedRemote: RemoteAction = behind > 0 ? "pull" : ahead > 0 ? "push" : "fetch";

  return {
    activeRepoPath,
    repoName: activeRepoPath?.split("/").pop() ?? "",
    hasStatus: !!gitStatus,
    isLoading,
    branch: gitStatus?.branch ?? "",
    ahead,
    behind,
    suggestedRemote,
    files,
    staged,
    unstaged,
    totals,
    commits,
    hasMoreCommits,
    loadMoreCommits: () => activeRepoPath && void loadMoreCommits(activeRepoPath),
    branches,
    stashes,
    busyKeys,
    remoteAction,
    isCommitting,
    isGenerating,
    refresh,
    setStaged,
    discard,
    openDiff,
    openFile,
    openPrimary,
    diff,
    viewAll: (scope: WorkingTreeDiffScope) => void diff.viewWorkingTreeDiff(scope),
    viewCommit: (hash: string) => void diff.viewCommitDiff(hash),
    viewStash: (index: number) => void diff.viewStashDiff(index),
    viewBranchDiff: (branch: string) => void diff.viewBranchDiff(branch),
    commit,
    generateMessage,
    runRemote,
    checkout,
    createBranch,
    deleteBranch,
    reloadBranches,
    stash,
  };
}

export type SourceControlModel = ReturnType<typeof useSourceControlModel>;
