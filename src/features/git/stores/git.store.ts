import { createStore } from "zustand/vanilla";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";
import { getGitLog } from "../api/git-commits-api";
import { getGitStatus } from "../api/git-status-api";
import type { GitCommit, GitStash, GitStatus } from "../types/git.types";

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
  workspaceGitStatusUpdatedAt: number;

  actions: {
    prepareRepositoryLoad: (repoPath: string) => void;
    loadFreshGitData: (data: {
      gitStatus: GitStatus | null;
      commits: GitCommit[];
      branches: string[];
      stashes: GitStash[];
      repoPath: string;
    }) => void;
    refreshGitData: (data: {
      gitStatus: GitStatus | null;
      branches?: string[];
      commits?: GitCommit[];
      repoPath: string;
    }) => void;
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

export const createGitStore = () =>
  createStore<GitState>()((set, get) => ({
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
    workspaceGitStatusUpdatedAt: 0,

    actions: {
      prepareRepositoryLoad: (repoPath) => {
        const state = get();
        if (state.currentRepoPath === repoPath) return;

        set({
          gitStatus: null,
          commits: [],
          branches: [],
          stashes: [],
          hasMoreCommits: true,
          isLoadingMoreCommits: false,
          currentRepoPath: repoPath,
        });
      },

      loadFreshGitData: ({ gitStatus, commits, branches, stashes, repoPath }) => {
        if (get().currentRepoPath !== repoPath) {
          return;
        }

        set({
          gitStatus,
          commits,
          branches,
          stashes,
          hasMoreCommits: commits.length >= COMMITS_PER_PAGE,
          currentRepoPath: repoPath,
        });
      },

      refreshGitData: ({ gitStatus, branches, commits, repoPath }) => {
        if (get().currentRepoPath !== repoPath) {
          return;
        }

        set({
          gitStatus,
          ...(branches ? { branches } : {}),
          ...(commits
            ? {
                commits,
                hasMoreCommits: commits.length >= COMMITS_PER_PAGE,
              }
            : {}),
        });
      },

      refreshWorkspaceGitStatus: async (repoPath) => {
        const status = await getGitStatus(repoPath);

        if (get().currentWorkspaceRepoPath !== repoPath) {
          return;
        }

        set({
          workspaceGitStatus: status,
          workspaceGitStatusUpdatedAt: Date.now(),
        });
      },

      loadMoreCommits: async (repoPath) => {
        const { commits, currentRepoPath, hasMoreCommits, isLoadingMoreCommits } = get();

        if (currentRepoPath !== repoPath || !hasMoreCommits || isLoadingMoreCommits) return;

        set({ isLoadingMoreCommits: true });

        try {
          const newCommits = await getGitLog(repoPath, COMMITS_PER_PAGE, commits.length);
          if (get().currentRepoPath !== repoPath) {
            return;
          }

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
          workspaceGitStatus: status,
          currentWorkspaceRepoPath: repoPath,
          workspaceGitStatusUpdatedAt: Date.now(),
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
          workspaceGitStatusUpdatedAt: 0,
        }),
    },
  }));

export const useGitStore = createWorkspaceScopedStore("git", createGitStore);
