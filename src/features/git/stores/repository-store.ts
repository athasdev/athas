import { create } from "zustand";
import { createSelectors } from "@/utils/zustand-selectors";
import { discoverWorkspaceRepositories, normalizeRepositoryPath } from "../api/repo";

interface RepositoryState {
  workspaceRootPath: string | null;
  workspaceRepoPaths: string[];
  manualRepoPath: string | null;
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

const mergeRepositoryPaths = (
  workspaceRepos: string[],
  manualRepoPath: string | null,
): string[] => {
  const result = [...workspaceRepos];
  if (manualRepoPath && !result.includes(manualRepoPath)) {
    result.push(manualRepoPath);
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
            const availableRepoPaths = mergeRepositoryPaths([], state.manualRepoPath);
            const activeRepoPath = state.manualRepoPath ?? null;
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
            const availableRepoPaths = mergeRepositoryPaths(discoveredRepos, state.manualRepoPath);
            const previousActive = state.activeRepoPath;
            const hasPreviousActive =
              !!previousActive && availableRepoPaths.includes(previousActive);
            const nextActiveRepoPath = hasPreviousActive
              ? previousActive
              : state.manualRepoPath && availableRepoPaths.includes(state.manualRepoPath)
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
          const hasInWorkspace =
            !!normalizedRepoPath && state.workspaceRepoPaths.includes(normalizedRepoPath);
          const nextManualRepoPath = hasInWorkspace ? state.manualRepoPath : normalizedRepoPath;
          const availableRepoPaths = mergeRepositoryPaths(
            state.workspaceRepoPaths,
            nextManualRepoPath,
          );

          return {
            manualRepoPath: nextManualRepoPath,
            activeRepoPath: normalizedRepoPath,
            availableRepoPaths,
            error: null,
          };
        });
      },

      setManualRepository: (repoPath) => {
        const normalizedRepoPath = normalizeRepositoryPath(repoPath);
        set((state) => {
          const availableRepoPaths = mergeRepositoryPaths(
            state.workspaceRepoPaths,
            normalizedRepoPath,
          );
          return {
            manualRepoPath: normalizedRepoPath,
            activeRepoPath: normalizedRepoPath,
            availableRepoPaths,
            error: null,
          };
        });
      },

      clearManualRepository: () => {
        set((state) => {
          const availableRepoPaths = mergeRepositoryPaths(state.workspaceRepoPaths, null);
          const currentManual = state.manualRepoPath;
          const shouldResetActive = !!currentManual && state.activeRepoPath === currentManual;
          const nextActiveRepoPath = shouldResetActive
            ? getWorkspaceDefaultRepo(state.workspaceRepoPaths)
            : state.activeRepoPath && availableRepoPaths.includes(state.activeRepoPath)
              ? state.activeRepoPath
              : getWorkspaceDefaultRepo(state.workspaceRepoPaths);

          return {
            manualRepoPath: null,
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
