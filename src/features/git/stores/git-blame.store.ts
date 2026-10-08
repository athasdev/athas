import { createStore } from "zustand/vanilla";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";
import { getResolvedGitBlame } from "../api/git-blame-api";
import type { GitBlame } from "../types/git.types";

interface GitBlameState {
  blameData: Map<string, GitBlame>;
  blameContent: Map<string, string>;
  requestedContent: Map<string, string>;
  requestIds: Map<string, number>;
  /** Keys whose committed blame may have moved; their next load always reaches the backend. */
  staleKeys: Set<string>;
  nextRequestId: number;
  revision: number;
  isLoading: Map<string, boolean>;
  errors: Map<string, string>;

  actions: {
    loadBlameForFile: (repoPath: string, filePath: string, content: string) => Promise<void>;
    /** Marks loaded blame as outdated; it stays visible until the next load replaces it. */
    invalidateBlameForFile: (repoPath: string, filePath: string) => void;
    clearAllBlame: () => void;
  };
}

export const getGitBlameCacheKey = (repoPath: string, filePath: string) =>
  `${repoPath}\0${filePath}`;

export const createGitBlameStore = () =>
  createStore<GitBlameState>()((set, get) => ({
    blameData: new Map(),
    blameContent: new Map(),
    requestedContent: new Map(),
    requestIds: new Map(),
    staleKeys: new Set(),
    nextRequestId: 0,
    revision: 0,
    isLoading: new Map(),
    errors: new Map(),

    actions: {
      loadBlameForFile: async (repoPath, filePath, content) => {
        const state = get();
        const cacheKey = getGitBlameCacheKey(repoPath, filePath);
        const contentIsCurrent = state.requestedContent.get(cacheKey) === content;
        const contentIsLoaded =
          state.blameContent.get(cacheKey) === content && state.blameData.has(cacheKey);

        const isStale = state.staleKeys.has(cacheKey);

        if (!isStale && contentIsCurrent && (state.isLoading.get(cacheKey) || contentIsLoaded)) {
          return;
        }

        const requestId = state.nextRequestId + 1;
        const errors = new Map(state.errors);
        errors.delete(cacheKey);
        const staleKeys = new Set(state.staleKeys);
        staleKeys.delete(cacheKey);

        set({
          staleKeys,
          requestedContent: new Map(state.requestedContent).set(cacheKey, content),
          requestIds: new Map(state.requestIds).set(cacheKey, requestId),
          nextRequestId: requestId,
          isLoading: new Map(state.isLoading).set(cacheKey, true),
          errors,
        });

        const result = await getResolvedGitBlame(repoPath, filePath, content);
        if (get().requestIds.get(cacheKey) !== requestId) {
          return;
        }

        if (result) {
          set({
            blameData: new Map(get().blameData).set(cacheKey, result.blame),
            blameContent: new Map(get().blameContent).set(cacheKey, content),
            isLoading: new Map(get().isLoading).set(cacheKey, false),
          });
        } else {
          const blameData = new Map(get().blameData);
          const blameContent = new Map(get().blameContent);
          blameData.delete(cacheKey);
          blameContent.delete(cacheKey);
          set({
            blameData,
            blameContent,
            errors: new Map(get().errors).set(cacheKey, "Failed to load blame data"),
            isLoading: new Map(get().isLoading).set(cacheKey, false),
          });
        }
      },

      invalidateBlameForFile: (repoPath, filePath) => {
        const cacheKey = getGitBlameCacheKey(repoPath, filePath);
        if (get().staleKeys.has(cacheKey)) return;
        set({ staleKeys: new Set(get().staleKeys).add(cacheKey) });
      },

      clearAllBlame: () => {
        set({
          blameData: new Map(),
          blameContent: new Map(),
          requestedContent: new Map(),
          requestIds: new Map(),
          staleKeys: new Set(),
          revision: get().revision + 1,
          isLoading: new Map(),
          errors: new Map(),
        });
      },
    },
  }));

export const useGitBlameStore = createWorkspaceScopedStore("git-blame", createGitBlameStore);
