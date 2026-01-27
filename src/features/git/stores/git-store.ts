import { create } from "zustand";
import { getGitLog } from "../api/commits";
import type { GitCommit, GitStash, GitStatus } from "../types/git";

interface GitState {
  gitStatus: GitStatus | null;
  commits: GitCommit[];
  branches: string[];
  stashes: GitStash[];
  hasMoreCommits: boolean;
  isLoadingMoreCommits: boolean;
  isLoadingGitData: boolean;
  isRefreshing: boolean;
  currentRepoPath: string | null;

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
    loadMoreCommits: (repoPath: string) => Promise<void>;
    setGitStatus: (status: GitStatus | null) => void;
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
  commits: [],
  branches: [],
  stashes: [],
  hasMoreCommits: true,
  isLoadingMoreCommits: false,
  isLoadingGitData: false,
  isRefreshing: false,
  currentRepoPath: null,

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
      }),
  },
}));
