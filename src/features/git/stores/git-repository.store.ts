import { createStore } from "zustand/vanilla";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";
import { createSelectors } from "@/utils/zustand-selectors";
import { discoverWorkspaceRepositories, normalizeRepositoryPath } from "../api/git-repo-api";

interface RepositoryState {
  workspaceRepoPaths: string[];
  manualRepoPath: string | null;
  manualRepoPaths: string[];
  activeRepoPath: string | null;
  availableRepoPaths: string[];
  isDiscovering: boolean;
  hasDiscoveredWorkspace: boolean;
  discoveryRequestId: number;
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
  workspaceRepoPaths: [],
  manualRepoPath: null,
  manualRepoPaths: [],
  activeRepoPath: null,
  availableRepoPaths: [],
  isDiscovering: false,
  hasDiscoveredWorkspace: false,
  discoveryRequestId: 0,
  error: null,
};

/**
 * The workspace root itself is owned by the project store; callers pass it in. The store only
 * remembers which root its repository list was discovered for, so a sync for the same root is
 * skipped and a scan for a root that was since replaced is dropped.
 */
export const createGitRepositoryStore = () => {
  let discoveredRootPath: string | null = null;
  return createStore<RepositoryState>()((set, get) => ({
    ...initialState,

    actions: {
      syncWorkspaceRepositories: async (workspaceRootPath, options) => {
        const force = options?.force ?? false;
        const normalizedRoot = workspaceRootPath
          ? normalizeRepositoryPath(workspaceRootPath)
          : null;

        if (!normalizedRoot) {
          discoveredRootPath = null;
          set((state) => {
            const availableRepoPaths = mergeRepositoryPaths([], state.manualRepoPaths);
            const activeRepoPath = state.activeRepoPath ?? state.manualRepoPath ?? null;
            return {
              workspaceRepoPaths: [],
              availableRepoPaths,
              activeRepoPath,
              isDiscovering: false,
              hasDiscoveredWorkspace: true,
              discoveryRequestId: state.discoveryRequestId + 1,
              error: null,
            };
          });
          return;
        }

        const current = get();
        if (
          !force &&
          discoveredRootPath === normalizedRoot &&
          (current.hasDiscoveredWorkspace || current.isDiscovering)
        ) {
          return;
        }

        const requestId = current.discoveryRequestId + 1;
        discoveredRootPath = normalizedRoot;
        set({
          isDiscovering: true,
          discoveryRequestId: requestId,
          error: null,
        });

        try {
          const discoveredRepos = await discoverWorkspaceRepositories(normalizedRoot, { force });

          set((state) => {
            if (state.discoveryRequestId !== requestId || discoveredRootPath !== normalizedRoot) {
              return state;
            }

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
              workspaceRepoPaths: discoveredRepos,
              availableRepoPaths,
              activeRepoPath: nextActiveRepoPath,
              isDiscovering: false,
              hasDiscoveredWorkspace: true,
              error: null,
            };
          });
        } catch (error) {
          set((state) =>
            state.discoveryRequestId === requestId && discoveredRootPath === normalizedRoot
              ? {
                  isDiscovering: false,
                  hasDiscoveredWorkspace: true,
                  error: error instanceof Error ? error.message : String(error),
                }
              : state,
          );
        }
      },

      refreshWorkspaceRepositories: async () => {
        await get().actions.syncWorkspaceRepositories(discoveredRootPath, { force: true });
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

      reset: () => {
        discoveredRootPath = null;
        set(initialState);
      },
    },
  }));
};

export const useRepositoryStore = createSelectors(
  createWorkspaceScopedStore("git-repository", createGitRepositoryStore),
);
