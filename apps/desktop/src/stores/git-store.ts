import { create } from "zustand";
import { combine } from "zustand/middleware";
import type { GitCommit, GitStatus } from "../utils/git";
import { getGitLog } from "../utils/git";

interface GitState {
  // Data
  gitStatus: GitStatus | null;
  commits: GitCommit[];
  branches: string[];

  // Loading states
  isLoadingGitData: boolean;
  isRefreshing: boolean;

  // Pagination state
  commitPageSize: number;
  hasMoreCommits: boolean;
  isLoadingMoreCommits: boolean;
}

const initialState: GitState = {
  gitStatus: null,
  commits: [],
  branches: [],
  isLoadingGitData: false,
  isRefreshing: false,
  commitPageSize: 50,
  hasMoreCommits: true,
  isLoadingMoreCommits: false,
};

export const useGitStore = create(
  combine(initialState, (set, get) => ({
    actions: {
      setGitStatus: (gitStatus: GitStatus | null) => set({ gitStatus }),
      setIsLoadingGitData: (isLoadingGitData: boolean) => set({ isLoadingGitData }),
      setIsRefreshing: (isRefreshing: boolean) => set({ isRefreshing }),
      updateGitData: (data: {
        gitStatus: GitStatus | null;
        commits: GitCommit[];
        branches: string[];
      }) => {
        const state = get();
        set({
          gitStatus: data.gitStatus,
          commits: data.commits,
          branches: data.branches,
          hasMoreCommits: data.commits.length >= state.commitPageSize,
        });
      },

      loadFreshGitData: (data: {
        gitStatus: GitStatus | null;
        commits: GitCommit[];
        branches: string[];
      }) => {
        const state = get();
        set({
          gitStatus: data.gitStatus,
          commits: data.commits,
          branches: data.branches,
          hasMoreCommits: data.commits.length >= state.commitPageSize,
          isLoadingMoreCommits: false,
        });
      },

      resetCommits: () => set({ commits: [], hasMoreCommits: true }),

      loadMoreCommits: async (repoPath: string) => {
        const state = get();

        if (!state.hasMoreCommits || state.isLoadingMoreCommits || !repoPath) {
          return;
        }

        set({ isLoadingMoreCommits: true });

        try {
          const skip = state.commits.length;
          const newCommits = await getGitLog(repoPath, state.commitPageSize, skip);

          const allCommits = [...state.commits, ...newCommits];
          set({
            commits: allCommits,
            hasMoreCommits: newCommits.length >= state.commitPageSize,
            isLoadingMoreCommits: false,
          });
        } catch {
          set({ isLoadingMoreCommits: false });
        }
      },
    },
  })),
);
