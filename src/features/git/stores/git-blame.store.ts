import { createStore } from "zustand/vanilla";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";
import { getGitBlame } from "../api/git-blame-api";
import type { GitBlame, GitBlameLine } from "../types/git.types";

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
        const contentIsCurrent = state.requestedContent.get(filePath) === content;
        const contentIsLoaded =
          state.blameContent.get(filePath) === content && state.blameData.has(filePath);

        if (contentIsCurrent && (state.isLoading.get(filePath) || contentIsLoaded)) {
          return;
        }

        const requestId = state.nextRequestId + 1;
        const errors = new Map(state.errors);
        errors.delete(filePath);

        set({
          requestedContent: new Map(state.requestedContent).set(filePath, content),
          requestIds: new Map(state.requestIds).set(filePath, requestId),
          nextRequestId: requestId,
          isLoading: new Map(state.isLoading).set(filePath, true),
          errors,
        });

        const blame = await getGitBlame(repoPath, filePath, content);
        if (get().requestIds.get(filePath) !== requestId) {
          return;
        }

        if (blame) {
          set({
            blameData: new Map(get().blameData).set(filePath, blame),
            blameContent: new Map(get().blameContent).set(filePath, content),
            fileToRepo: new Map(get().fileToRepo).set(filePath, repoPath),
            isLoading: new Map(get().isLoading).set(filePath, false),
          });
        } else {
          const blameData = new Map(get().blameData);
          const blameContent = new Map(get().blameContent);
          blameData.delete(filePath);
          blameContent.delete(filePath);
          set({
            blameData,
            blameContent,
            errors: new Map(get().errors).set(filePath, "Failed to load blame data"),
            isLoading: new Map(get().isLoading).set(filePath, false),
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

        blameData.delete(filePath);
        blameContent.delete(filePath);
        requestedContent.delete(filePath);
        requestIds.delete(filePath);
        isLoading.delete(filePath);
        errors.delete(filePath);
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
        const blame = get().blameData.get(filePath);

        if (!blame) return null;

        for (const line of blame.lines) {
          const start = line.line_number;
          const end = start + line.total_lines - 1;
          if (lineNumber >= start && lineNumber <= end) {
            return line;
          }
        }

        return null;
      },

      getRepoPath: (filePath: string) => {
        return get().fileToRepo.get(filePath) ?? null;
      },
    },
  }));

export const useGitBlameStore = createWorkspaceScopedStore("git-blame", createGitBlameStore);
