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

  // Track current repo to detect changes
  currentRepoPath: string | null;
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
  currentRepoPath: null,
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
        repoPath?: string;
      }) => {
        const state = get();
        set({
          gitStatus: data.gitStatus,
          commits: data.commits,
          branches: data.branches,
          hasMoreCommits: data.commits.length >= state.commitPageSize,
          isLoadingMoreCommits: false,
          currentRepoPath: data.repoPath || state.currentRepoPath,
        });
      },

      // New method to refresh git data while preserving loaded commits
      refreshGitData: async (data: {
        gitStatus: GitStatus | null;
        branches: string[];
        repoPath: string;
      }) => {
        const state = get();

        // If repo path changed, reset everything
        if (state.currentRepoPath !== data.repoPath) {
          set({
            gitStatus: data.gitStatus,
            branches: data.branches,
            commits: [],
            hasMoreCommits: true,
            currentRepoPath: data.repoPath,
          });
          return;
        }

        // Check for new commits by loading a small number from the beginning
        try {
          const recentCommits = await getGitLog(data.repoPath, 20, 0);

          if (recentCommits.length === 0) {
            // No commits in repo
            set({
              gitStatus: data.gitStatus,
              branches: data.branches,
              commits: [],
              hasMoreCommits: false,
            });
            return;
          }

          const existingCommits = state.commits;

          if (existingCommits.length === 0) {
            // No existing commits, load initial set
            const initialCommits = await getGitLog(data.repoPath, state.commitPageSize, 0);
            set({
              gitStatus: data.gitStatus,
              branches: data.branches,
              commits: initialCommits,
              hasMoreCommits: initialCommits.length >= state.commitPageSize,
            });
            return;
          }

          // Find new commits by checking what's not in our existing list
          const existingHashes = new Set(existingCommits.map((c) => c.hash));
          const newCommits = recentCommits.filter((commit) => !existingHashes.has(commit.hash));

          if (newCommits.length > 0) {
            // Prepend new commits to existing ones
            const updatedCommits = [...newCommits, ...existingCommits];
            set({
              gitStatus: data.gitStatus,
              branches: data.branches,
              commits: updatedCommits,
            });
          } else {
            // No new commits, just update status and branches
            set({
              gitStatus: data.gitStatus,
              branches: data.branches,
            });
          }
        } catch (error) {
          console.error("Failed to refresh git data:", error);
          // Fall back to just updating status and branches
          set({
            gitStatus: data.gitStatus,
            branches: data.branches,
          });
        }
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
