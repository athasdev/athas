import { createStore } from "zustand/vanilla";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";
import { getResolvedGitBlame } from "../api/git-blame-api";
import type { GitBlame, GitBlameLine } from "../types/git.types";
import { findGitBlameLine } from "../utils/git-blame-lines";

interface GitBlameState {
  blameData: Map<string, GitBlame>;
  blameContent: Map<string, string>;
  requestedContent: Map<string, string>;
  requestIds: Map<string, number>;
  nextRequestId: number;
  revision: number;
  isLoading: Map<string, boolean>;
  errors: Map<string, string>;
  fileToRepo: Map<string, string>;

  actions: {
    loadBlameForFile: (repoPath: string, filePath: string, content: string) => Promise<void>;
    clearBlameForFile: (filePath: string) => void;
    clearAllBlame: () => void;
    getBlameForLine: (filePath: string, lineNumber: number) => GitBlameLine | null;
    getRepoPath: (filePath: string) => string | null;
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
    nextRequestId: 0,
    revision: 0,
    isLoading: new Map(),
    errors: new Map(),
    fileToRepo: new Map(),

    actions: {
      loadBlameForFile: async (repoPath: string, filePath: string, content: string) => {
        const state = get();
        const cacheKey = getGitBlameCacheKey(repoPath, filePath);
        const contentIsCurrent = state.requestedContent.get(cacheKey) === content;
        const contentIsLoaded =
          state.blameContent.get(cacheKey) === content && state.blameData.has(cacheKey);

        if (contentIsCurrent && (state.isLoading.get(cacheKey) || contentIsLoaded)) {
          return;
        }

        const requestId = state.nextRequestId + 1;
        const errors = new Map(state.errors);
        errors.delete(cacheKey);

        set({
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
            fileToRepo: new Map(get().fileToRepo).set(filePath, result.repoPath),
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

      clearBlameForFile: (filePath: string) => {
        const state = get();
        const blameData = new Map(state.blameData);
        const blameContent = new Map(state.blameContent);
        const requestedContent = new Map(state.requestedContent);
        const requestIds = new Map(state.requestIds);
        const isLoading = new Map(state.isLoading);
        const errors = new Map(state.errors);
        const fileToRepo = new Map(state.fileToRepo);

        const suffix = `\0${filePath}`;
        for (const key of new Set([
          ...blameData.keys(),
          ...blameContent.keys(),
          ...requestedContent.keys(),
          ...requestIds.keys(),
          ...isLoading.keys(),
          ...errors.keys(),
        ])) {
          if (!key.endsWith(suffix)) continue;
          blameData.delete(key);
          blameContent.delete(key);
          requestedContent.delete(key);
          requestIds.delete(key);
          isLoading.delete(key);
          errors.delete(key);
        }
        fileToRepo.delete(filePath);

        set({
          blameData,
          blameContent,
          requestedContent,
          requestIds,
          revision: state.revision + 1,
          isLoading,
          errors,
          fileToRepo,
        });
      },

      clearAllBlame: () => {
        set({
          blameData: new Map(),
          blameContent: new Map(),
          requestedContent: new Map(),
          requestIds: new Map(),
          revision: get().revision + 1,
          isLoading: new Map(),
          errors: new Map(),
          fileToRepo: new Map(),
        });
      },

      getBlameForLine: (filePath: string, lineNumber: number) => {
        const suffix = `\0${filePath}`;
        const cacheKeys = Array.from(get().blameData.keys());
        let cacheKey: string | undefined;
        for (let index = cacheKeys.length - 1; index >= 0; index--) {
          if (cacheKeys[index].endsWith(suffix)) {
            cacheKey = cacheKeys[index];
            break;
          }
        }
        const blame = cacheKey ? get().blameData.get(cacheKey) : undefined;

        if (!blame) return null;

        return findGitBlameLine(blame.lines, lineNumber);
      },

      getRepoPath: (filePath: string) => {
        return get().fileToRepo.get(filePath) ?? null;
      },
    },
  }));

export const useGitBlameStore = createWorkspaceScopedStore("git-blame", createGitBlameStore);
