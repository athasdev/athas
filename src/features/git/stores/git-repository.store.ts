import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";
import { discoverWorkspaceRepositories, normalizeRepositoryPath } from "../api/git-repo-api";

interface RepositoryState {
  workspaceRootPath: string | null;
  workspaceRepoPaths: string[];
  manualRepoPath: string | null;
  manualRepoPaths: string[];
  activeRepoPath: string | null;
  availableRepoPaths: string[];
  isDiscovering: boolean;
  error: string | null;

  actions: {
    syncWorkspaceRepositories: (
      workspaceRootPath?: string | null,
      options?: { force?: boolean },
    ) => Promise<void>;
    refreshWorkspaceRepositories: () => Promise<void>;
    selectRepository: (repoPath: string | null) => void;
    setManualRepository: (repoPath: string) => void;
    clearManualRepository: () => void;
    reset: () => void;
  };
}

const mergeRepositoryPaths = (workspaceRepos: string[], manualRepoPaths: string[]): string[] => {
  const result = [...workspaceRepos];
  const resultSet = new Set(result);

  for (const manualRepoPath of manualRepoPaths) {
    if (!resultSet.has(manualRepoPath)) {
      resultSet.add(manualRepoPath);
      result.push(manualRepoPath);
    }
  }
  return result;
};

const getWorkspaceDefaultRepo = (workspaceRepos: string[]): string | null => {
  return workspaceRepos[0] ?? null;
};

const initialState = {
  workspaceRootPath: null,
  workspaceRepoPaths: [],
  manualRepoPath: null,
  manualRepoPaths: [],
  activeRepoPath: null,
  availableRepoPaths: [],
  isDiscovering: false,
  error: null,
};

export const useRepositoryStore = createSelectors(
  create<RepositoryState>((set, get) => ({
    ...initialState,

    actions: {
      syncWorkspaceRepositories: async (workspaceRootPath, options) => {
        const force = options?.force ?? false;
        const normalizedRoot = workspaceRootPath
          ? normalizeRepositoryPath(workspaceRootPath)
          : null;

        if (!normalizedRoot) {
          set((state) => {
            const availableRepoPaths = mergeRepositoryPaths([], state.manualRepoPaths);
            const activeRepoPath = state.activeRepoPath ?? state.manualRepoPath ?? null;
            return {
              workspaceRootPath: null,
              workspaceRepoPaths: [],
              availableRepoPaths,
              activeRepoPath,
              isDiscovering: false,
              error: null,
            };
          });
          return;
        }

        const current = get();
        if (
          !force &&
          current.workspaceRootPath === normalizedRoot &&
          (current.workspaceRepoPaths.length > 0 || current.isDiscovering)
        ) {
          return;
        }

        set({
          workspaceRootPath: normalizedRoot,
          isDiscovering: true,
          error: null,
        });

        try {
          const discoveredRepos = await discoverWorkspaceRepositories(normalizedRoot, { force });

          set((state) => {
            const availableRepoPaths = mergeRepositoryPaths(discoveredRepos, state.manualRepoPaths);
            const availableRepoPathSet = new Set(availableRepoPaths);
            const previousActive = state.activeRepoPath;
            const hasPreviousActive = !!previousActive && availableRepoPathSet.has(previousActive);
            const nextActiveRepoPath = hasPreviousActive
              ? previousActive
              : state.manualRepoPath && availableRepoPathSet.has(state.manualRepoPath)
                ? state.manualRepoPath
                : getWorkspaceDefaultRepo(discoveredRepos);

            return {
              workspaceRootPath: normalizedRoot,
              workspaceRepoPaths: discoveredRepos,
              availableRepoPaths,
              activeRepoPath: nextActiveRepoPath,
              isDiscovering: false,
              error: null,
            };
          });
        } catch (error) {
          set({
            isDiscovering: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      },

      refreshWorkspaceRepositories: async () => {
        const { workspaceRootPath, actions } = get();
        await actions.syncWorkspaceRepositories(workspaceRootPath, { force: true });
      },

      selectRepository: (repoPath) => {
        const normalizedRepoPath = repoPath ? normalizeRepositoryPath(repoPath) : null;
        set((state) => {
          const workspaceRepoPathSet = new Set(state.workspaceRepoPaths);
          const manualRepoPathSet = new Set(state.manualRepoPaths);
          const hasInWorkspace =
            !!normalizedRepoPath && workspaceRepoPathSet.has(normalizedRepoPath);
          const nextManualRepoPaths =
            normalizedRepoPath && !hasInWorkspace && !manualRepoPathSet.has(normalizedRepoPath)
              ? [...state.manualRepoPaths, normalizedRepoPath]
              : state.manualRepoPaths;
          const nextManualRepoPath = hasInWorkspace
            ? state.manualRepoPath
            : (normalizedRepoPath ?? state.manualRepoPath);
          const availableRepoPaths = mergeRepositoryPaths(
            state.workspaceRepoPaths,
            nextManualRepoPaths,
          );

          return {
            manualRepoPath: nextManualRepoPath,
            manualRepoPaths: nextManualRepoPaths,
            activeRepoPath: normalizedRepoPath,
            availableRepoPaths,
            error: null,
          };
        });
      },

      setManualRepository: (repoPath) => {
        const normalizedRepoPath = normalizeRepositoryPath(repoPath);
        set((state) => {
          const manualRepoPathSet = new Set(state.manualRepoPaths);
          const manualRepoPaths = manualRepoPathSet.has(normalizedRepoPath)
            ? state.manualRepoPaths
            : [...state.manualRepoPaths, normalizedRepoPath];
          const availableRepoPaths = mergeRepositoryPaths(
            state.workspaceRepoPaths,
            manualRepoPaths,
          );
          return {
            manualRepoPath: normalizedRepoPath,
            manualRepoPaths,
            activeRepoPath: normalizedRepoPath,
            availableRepoPaths,
            error: null,
          };
        });
      },

      clearManualRepository: () => {
        set((state) => {
          const availableRepoPaths = mergeRepositoryPaths(state.workspaceRepoPaths, []);
          const availableRepoPathSet = new Set(availableRepoPaths);
          const manualRepoPathSet = new Set(state.manualRepoPaths);
          const shouldResetActive =
            !!state.activeRepoPath && manualRepoPathSet.has(state.activeRepoPath);
          const nextActiveRepoPath = shouldResetActive
            ? getWorkspaceDefaultRepo(state.workspaceRepoPaths)
            : state.activeRepoPath && availableRepoPathSet.has(state.activeRepoPath)
              ? state.activeRepoPath
              : getWorkspaceDefaultRepo(state.workspaceRepoPaths);

          return {
            manualRepoPath: null,
            manualRepoPaths: [],
            activeRepoPath: nextActiveRepoPath,
            availableRepoPaths,
            error: null,
          };
        });
      },

      reset: () => set(initialState),
    },
  })),
);
