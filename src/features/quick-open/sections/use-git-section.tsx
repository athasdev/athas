import { useCallback, useEffect, useMemo, useState } from "react";
import { ThemedFileIcon } from "@/extensions/icon-themes/components/themed-file-icon";
import { SearchMatchHighlight } from "@/components/search-match-highlight";
import { checkoutBranch, getBranches } from "@/features/git/api/git-branches-api";
import { getGitLog } from "@/features/git/api/git-commits-api";
import { getGitStatus } from "@/features/git/api/git-status-api";
import { createStash } from "@/features/git/api/git-stash-api";
import { useGitBlameStore } from "@/features/git/stores/git-blame.store";
import { useRepositoryStore } from "@/features/git/stores/git-repository.store";
import { useGitStore } from "@/features/git/stores/git.store";
import type { GitCommit, GitFile } from "@/features/git/types/git.types";
import { openCommitDiffBuffer } from "@/features/git/utils/open-commit-diff-buffer";
import { useFileSystemStore } from "@/features/file-system/stores/file-system.store";
import { showToast } from "@/features/layout/contexts/toast-context";
import { openSidebarResourceBuffer } from "@/features/sidebar/utils/open-sidebar-resource";
import { CommandEmpty, CommandItemBadge } from "@/ui/command";
import { CheckIcon, GitBranchIcon, GitCommitIcon } from "@/ui/icons";
import { getBaseName, getDirName } from "@/utils/path-helpers";
import { matchesSearchQuery } from "@/utils/search-match";
import type {
  QuickOpenItem,
  QuickOpenSectionInput,
  QuickOpenSectionResult,
} from "../types/quick-open.types";

const STATUS_LABELS: Record<GitFile["status"], string> = {
  modified: "M",
  added: "A",
  deleted: "D",
  untracked: "U",
  renamed: "R",
};

const COMMIT_LIMIT = 50;

async function switchBranch(repoPath: string, branch: string) {
  const result = await checkoutBranch(repoPath, branch);
  if (result.success) {
    useGitBlameStore.getState().actions.clearAllBlame();
    showToast({ message: `Switched to ${branch}`, type: "success" });
    return;
  }
  if (!result.hasChanges) {
    showToast({ message: result.message, type: "error" });
    return;
  }
  showToast({
    message: result.message,
    type: "warning",
    duration: 0,
    action: {
      label: "Stash Changes",
      onClick: async () => {
        try {
          if (!(await createStash(repoPath, `Switching to ${branch}`, true))) return;
          const retry = await checkoutBranch(repoPath, branch);
          if (retry.success) {
            useGitBlameStore.getState().actions.clearAllBlame();
            showToast({ message: "Changes stashed and branch switched", type: "success" });
          } else {
            showToast({ message: "Failed to switch branch after stashing", type: "error" });
          }
        } catch {
          showToast({ message: "Failed to stash changes", type: "error" });
        }
      },
    },
  });
}

function formatCommitDate(date: string) {
  const parsed = new Date(date);
  return Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString();
}

/** Changed files, branches and recent commits of the active repository. */
export function useGitSection({
  query,
  isActive,
  close,
}: QuickOpenSectionInput): QuickOpenSectionResult {
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const rootFolderPath = useFileSystemStore((state) => state.rootFolderPath);
  const repoPath = activeRepoPath ?? rootFolderPath ?? null;
  // The workspace status is kept current for the title bar, so changes there show live.
  const workspaceGitStatus = useGitStore((state) => state.workspaceGitStatus);
  const status = repoPath && repoPath === rootFolderPath ? workspaceGitStatus : null;
  const [loaded, setLoaded] = useState<{
    repoPath: string | null;
    branches: string[];
    commits: GitCommit[];
    currentBranch: string | null;
    files: GitFile[];
  }>({ repoPath: null, branches: [], commits: [], currentBranch: null, files: [] });

  useEffect(() => {
    if (!isActive || !repoPath) return;
    let cancelled = false;
    void Promise.all([
      getBranches(repoPath).catch(() => []),
      getGitLog(repoPath, COMMIT_LIMIT, 0).catch(() => []),
      getGitStatus(repoPath).catch(() => null),
    ]).then(([branches, commits, fetchedStatus]) => {
      if (cancelled) return;
      setLoaded({
        repoPath,
        branches: branches ?? [],
        commits: commits ?? [],
        currentBranch: fetchedStatus?.branch ?? null,
        files: fetchedStatus?.files ?? [],
      });
    });
    return () => {
      cancelled = true;
    };
  }, [isActive, repoPath]);

  const isCurrent = loaded.repoPath === repoPath;
  const files = status?.files ?? (isCurrent ? loaded.files : []);
  const currentBranch = status?.branch ?? (isCurrent ? loaded.currentBranch : null);
  const branches = isCurrent ? loaded.branches : [];
  const commits = isCurrent ? loaded.commits : [];

  const openChange = useCallback(
    (file: GitFile) => {
      if (!repoPath) return;
      close();
      void openSidebarResourceBuffer({
        type: "git-file-diff",
        repoPath,
        filePath: file.path,
        staged: file.staged,
        status: file.status,
        name: getBaseName(file.path, file.path),
      });
    },
    [close, repoPath],
  );

  const items = useMemo((): QuickOpenItem[] => {
    if (!repoPath) return [];
    const changes = files
      .filter((file) => matchesSearchQuery(query, [file.path]))
      .map((file): QuickOpenItem => ({
        key: `change:${file.staged ? "staged" : "unstaged"}:${file.path}`,
        group: "Changes",
        icon: <ThemedFileIcon fileName={getBaseName(file.path, file.path)} isDir={false} />,
        title: <SearchMatchHighlight text={getBaseName(file.path, file.path)} query={query} />,
        description: <SearchMatchHighlight text={getDirName(file.path)} query={query} />,
        accessory: (
          <>
            {file.staged ? <CommandItemBadge>Staged</CommandItemBadge> : null}
            <CommandItemBadge>{STATUS_LABELS[file.status]}</CommandItemBadge>
          </>
        ),
        select: () => openChange(file),
      }));
    const branchItems = branches
      .filter((branch) => matchesSearchQuery(query, [branch]))
      .map((branch): QuickOpenItem => ({
        key: `branch:${branch}`,
        group: "Branches",
        icon: <GitBranchIcon />,
        title: <SearchMatchHighlight text={branch} query={query} />,
        description: branch === currentBranch ? "Current branch" : "Switch to this branch",
        accessory: branch === currentBranch ? <CheckIcon className="text-primary" /> : undefined,
        select: () => {
          close();
          if (branch !== currentBranch) void switchBranch(repoPath, branch);
        },
      }));
    const commitItems = commits
      .filter((commit) => matchesSearchQuery(query, [commit.message, commit.hash, commit.author]))
      .map((commit): QuickOpenItem => ({
        key: `commit:${commit.hash}`,
        group: "Commits",
        icon: <GitCommitIcon />,
        title: <SearchMatchHighlight text={commit.message} query={query} />,
        description: `${commit.author} · ${formatCommitDate(commit.date)}`,
        accessory: <CommandItemBadge>{commit.hash.slice(0, 7)}</CommandItemBadge>,
        select: () => {
          close();
          void openCommitDiffBuffer({
            repoPath,
            commitHash: commit.hash,
            message: commit.message,
            description: commit.description ?? undefined,
            author: commit.author,
            email: commit.email,
            date: commit.date,
          });
        },
      }));
    return [...changes, ...branchItems, ...commitItems];
  }, [branches, close, commits, currentBranch, files, openChange, query, repoPath]);

  return {
    items,
    isLoading: isActive && !!repoPath && !isCurrent,
    summary: currentBranch ?? undefined,
    empty: (
      <CommandEmpty>
        {!repoPath
          ? "Open a folder that is a Git repository"
          : !isCurrent
            ? "Loading repository..."
            : query
              ? "No matching changes, branches or commits"
              : "No changes, branches or commits"}
      </CommandEmpty>
    ),
  };
}
