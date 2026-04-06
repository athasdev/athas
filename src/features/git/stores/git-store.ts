import { create } from "zustand";
import { frontendTrace } from "@/utils/frontend-trace";
import { getGitLog } from "../api/git-commits-api";
import { getGitStatus } from "../api/git-status-api";
import type { GitCommit, GitStash, GitStatus } from "../types/git-types";

const MAX_WORKSPACE_GIT_STATUS_FILES = 200;

function toWorkspaceGitStatus(status: GitStatus | null): GitStatus | null {
  if (!status) return null;
  if (status.files.length <= MAX_WORKSPACE_GIT_STATUS_FILES) return status;

  console.info("[workspace-git] truncating workspace git status", {
    totalFiles: status.files.length,
    keptFiles: MAX_WORKSPACE_GIT_STATUS_FILES,
  });
  frontendTrace("warn", "workspace-git", "truncate", {
    totalFiles: status.files.length,
    keptFiles: MAX_WORKSPACE_GIT_STATUS_FILES,
  });

  return {
    ...status,
    files: status.files.slice(0, MAX_WORKSPACE_GIT_STATUS_FILES),
  };
}

interface GitState {
  gitStatus: GitStatus | null;
  workspaceGitStatus: GitStatus | null;
  commits: GitCommit[];
  branches: string[];
  stashes: GitStash[];
  hasMoreCommits: boolean;
  isLoadingMoreCommits: boolean;
  isLoadingGitData: boolean;
  isRefreshing: boolean;
  currentRepoPath: string | null;
  currentWorkspaceRepoPath: string | null;

  actions: {
    loadFreshGitData: (data: {
      gitStatus: GitStatus | null;
      commits: GitCommit[];
      branches: string[];
      stashes: GitStash[];
      repoPath: string;
    }) => void;
    refreshGitData: (data: {
      gitStatus: GitStatus | null;
      branches: string[];
      repoPath: string;
    }) => Promise<void>;
    refreshWorkspaceGitStatus: (repoPath: string) => Promise<void>;
    loadMoreCommits: (repoPath: string) => Promise<void>;
    setGitStatus: (status: GitStatus | null) => void;
    setWorkspaceGitStatus: (status: GitStatus | null, repoPath: string | null) => void;
    setCommits: (commits: GitCommit[]) => void;
    setBranches: (branches: string[]) => void;
    setStashes: (stashes: GitStash[]) => void;
    setIsLoadingGitData: (loading: boolean) => void;
    setIsRefreshing: (refreshing: boolean) => void;
    reset: () => void;
  };
}

const COMMITS_PER_PAGE = 50;

export const useGitStore = create<GitState>((set, get) => ({
  gitStatus: null,
  workspaceGitStatus: null,
  commits: [],
  branches: [],
  stashes: [],
  hasMoreCommits: true,
  isLoadingMoreCommits: false,
  isLoadingGitData: false,
  isRefreshing: false,
  currentRepoPath: null,
  currentWorkspaceRepoPath: null,

  actions: {
    loadFreshGitData: ({ gitStatus, commits, branches, stashes, repoPath }) => {
      set({
        gitStatus,
        commits,
        branches,
        stashes,
        hasMoreCommits: commits.length >= COMMITS_PER_PAGE,
        currentRepoPath: repoPath,
      });
    },

    refreshGitData: async ({ gitStatus, branches, repoPath }) => {
      const { currentRepoPath, commits: existingCommits } = get();

      if (currentRepoPath !== repoPath || existingCommits.length === 0) {
        set({ gitStatus, branches });
        return;
      }

      const latestCommits = await getGitLog(repoPath, 50, 0);

      if (latestCommits.length > 0) {
        const existingHashSet = new Set(existingCommits.map((c) => c.hash));
        const newCommits = latestCommits.filter((c) => !existingHashSet.has(c.hash));

        if (newCommits.length > 0) {
          set({
            gitStatus,
            branches,
            commits: [...newCommits, ...existingCommits],
          });
        } else {
          set({ gitStatus, branches });
        }
      } else {
        set({ gitStatus, branches });
      }
    },

    refreshWorkspaceGitStatus: async (repoPath) => {
      const status = await getGitStatus(repoPath);

      if (get().currentWorkspaceRepoPath !== repoPath) {
        return;
      }

      set({
        workspaceGitStatus: toWorkspaceGitStatus(status),
      });
    },

    loadMoreCommits: async (repoPath) => {
      const { commits, hasMoreCommits, isLoadingMoreCommits } = get();

      if (!hasMoreCommits || isLoadingMoreCommits) return;

      set({ isLoadingMoreCommits: true });

      try {
        const newCommits = await getGitLog(repoPath, COMMITS_PER_PAGE, commits.length);

        const existingHashSet = new Set(commits.map((c) => c.hash));
        const uniqueNewCommits = newCommits.filter((c) => !existingHashSet.has(c.hash));

        if (uniqueNewCommits.length > 0) {
          set({
            commits: [...commits, ...uniqueNewCommits],
            hasMoreCommits: uniqueNewCommits.length >= COMMITS_PER_PAGE,
          });
        } else {
          set({ hasMoreCommits: false });
        }
      } finally {
        set({ isLoadingMoreCommits: false });
      }
    },

    setGitStatus: (status) => set({ gitStatus: status }),
    setWorkspaceGitStatus: (status, repoPath) =>
      set({
        workspaceGitStatus: toWorkspaceGitStatus(status),
        currentWorkspaceRepoPath: repoPath,
      }),
    setCommits: (commits) => set({ commits }),
    setBranches: (branches) => set({ branches }),
    setStashes: (stashes) => set({ stashes }),
    setIsLoadingGitData: (loading) => set({ isLoadingGitData: loading }),
    setIsRefreshing: (refreshing) => set({ isRefreshing: refreshing }),

    reset: () =>
      set({
        gitStatus: null,
        commits: [],
        branches: [],
        stashes: [],
        hasMoreCommits: true,
        isLoadingMoreCommits: false,
        isLoadingGitData: false,
        isRefreshing: false,
        currentRepoPath: null,
        currentWorkspaceRepoPath: null,
        workspaceGitStatus: null,
      }),
  },
}));
