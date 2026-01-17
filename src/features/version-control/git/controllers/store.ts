import { create } from "zustand";
import { combine } from "zustand/middleware";
import type { GitCommit, GitStash, GitStatus } from "../types/git";
import { getGitLog, getStashes } from "./git";

interface GitState {
  // Data
  gitStatus: GitStatus | null;
  commits: GitCommit[];
  stashes: GitStash[];
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
  stashes: [],
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
      setGitStatus: (gitStatus: GitStatus | null) => {
        set({ gitStatus });
        // Dispatch event for git gutter updates
        window.dispatchEvent(new CustomEvent("git-status-updated", { detail: { gitStatus } }));
      },
      setIsLoadingGitData: (isLoadingGitData: boolean) => set({ isLoadingGitData }),
      setIsRefreshing: (isRefreshing: boolean) => set({ isRefreshing }),
      updateGitData: (data: {
        gitStatus: GitStatus | null;
        commits: GitCommit[];
        stashes: GitStash[];
        branches: string[];
      }) => {
        const state = get();
        set({
          gitStatus: data.gitStatus,
          commits: data.commits,
          stashes: data.stashes,
          branches: data.branches,
          hasMoreCommits: data.commits.length >= state.commitPageSize,
        });
      },

      loadFreshGitData: (data: {
        gitStatus: GitStatus | null;
        commits: GitCommit[];
        stashes: GitStash[];
        branches: string[];
        repoPath?: string;
      }) => {
        const state = get();
        set({
          gitStatus: data.gitStatus,
          commits: data.commits,
          stashes: data.stashes,
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
        const currentRepoPath = state.currentRepoPath;
        const repoChanged = currentRepoPath !== data.repoPath;

        let stashes: GitStash[] = [];
        try {
          stashes = await getStashes(data.repoPath);
        } catch (e) {
          console.error("Failed to fetch stashes during refresh", e);
          stashes = [];
        }

        if (repoChanged) {
          set({
            gitStatus: data.gitStatus,
            branches: data.branches,
            stashes: stashes,
            commits: [],
            hasMoreCommits: true,
            currentRepoPath: data.repoPath,
          });
          // Dispatch event for git gutter updates
          window.dispatchEvent(
            new CustomEvent("git-status-updated", { detail: { gitStatus: data.gitStatus } }),
          );
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
              stashes: stashes,
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
              stashes: stashes,
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
              stashes: stashes,
              commits: updatedCommits,
            });
            // Dispatch event for git gutter updates
            window.dispatchEvent(
              new CustomEvent("git-status-updated", { detail: { gitStatus: data.gitStatus } }),
            );
          } else {
            // No new commits, just update status and branches
            set({
              gitStatus: data.gitStatus,
              branches: data.branches,
              stashes: stashes,
            });
            // Dispatch event for git gutter updates
            window.dispatchEvent(
              new CustomEvent("git-status-updated", { detail: { gitStatus: data.gitStatus } }),
            );
          }
        } catch (error) {
          console.error("Failed to refresh git data:", error);
          set({
            gitStatus: data.gitStatus,
            branches: data.branches,
            stashes: stashes,
          });
          // Dispatch event for git gutter updates
          window.dispatchEvent(
            new CustomEvent("git-status-updated", { detail: { gitStatus: data.gitStatus } }),
          );
        }
      },

      resetCommits: () => set({ commits: [], hasMoreCommits: true }),

      resetGitState: () => {
        set({
          gitStatus: null,
          commits: [],
          stashes: [],
          branches: [],
          currentRepoPath: null,
          hasMoreCommits: true,
          isLoadingGitData: false,
          isRefreshing: false,
        });
        window.dispatchEvent(
          new CustomEvent("git-status-updated", { detail: { gitStatus: null } }),
        );
      },

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
