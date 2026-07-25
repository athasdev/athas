import { useCallback, useEffect, useRef } from "react";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { getBranches } from "../api/git-branches-api";
import { getGitLog } from "../api/git-commits-api";
import { getStashes } from "../api/git-stash-api";
import { getGitStatus } from "../api/git-status-api";
import {
  isGitChangeRelevant,
  isPassiveGitChange,
  subscribeToGitChanges,
  type GitChangeScope,
} from "../events/git-events";
import { useRepositoryStore } from "../stores/git-repository.store";
import { useGitStore } from "../stores/git.store";

interface GitDataControllerOptions {
  workspacePath?: string | null;
  isActive?: boolean;
}

export function useGitDataController({ workspacePath, isActive }: GitDataControllerOptions) {
  const activeRepoPath = useRepositoryStore.use.activeRepoPath();
  const { syncWorkspaceRepositories, refreshWorkspaceRepositories } =
    useRepositoryStore.use.actions();
  const gitActions = useGitStore((state) => state.actions);
  const gitStatus = useGitStore((state) => state.gitStatus);
  const autoRefreshGitStatus = useSettingsStore((state) => state.settings.autoRefreshGitStatus);
  const requestIdRef = useRef(0);
  const refreshPromisesRef = useRef(new Map<string, Promise<void>>());
  const wasActiveRef = useRef(isActive);

  const loadInitialGitData = useCallback(async () => {
    const repoPath = activeRepoPath;
    if (!repoPath) {
      return;
    }

    const requestId = ++requestIdRef.current;
    gitActions.prepareRepositoryLoad(repoPath);
    gitActions.setIsLoadingGitData(true);

    try {
      const [status, commits, branches, stashes] = await Promise.all([
        getGitStatus(repoPath),
        getGitLog(repoPath, 50, 0),
        getBranches(repoPath),
        getStashes(repoPath),
      ]);

      if (
        requestId !== requestIdRef.current ||
        useRepositoryStore.getState().activeRepoPath !== repoPath
      ) {
        return;
      }

      gitActions.loadFreshGitData({
        gitStatus: status,
        commits,
        branches,
        stashes,
        repoPath,
      });
    } catch (error) {
      if (requestId === requestIdRef.current) {
        console.error("Failed to load initial git data:", error);
      }
    } finally {
      if (requestId === requestIdRef.current) {
        gitActions.setIsLoadingGitData(false);
      }
    }
  }, [activeRepoPath, gitActions]);

  const refreshGitData = useCallback(
    async (scopes?: GitChangeScope[]) => {
      const repoPath = activeRepoPath;
      if (!repoPath) return;

      const refreshKey = `${repoPath}\0${scopes?.slice().sort().join(",") || "*"}`;
      const existingRequest = refreshPromisesRef.current.get(refreshKey);
      if (existingRequest) return existingRequest;

      const requestId = requestIdRef.current;
      const request = (async () => {
        try {
          const refreshAll = !scopes?.length;
          const shouldRefreshHistory = refreshAll || scopes.includes("history");
          const shouldRefreshRefs =
            refreshAll || scopes.includes("refs") || scopes.includes("repository");
          const shouldRefreshStashes =
            refreshAll || scopes.includes("stashes") || scopes.includes("repository");
          const [status, branches, stashes, commits] = await Promise.all([
            getGitStatus(repoPath),
            shouldRefreshRefs ? getBranches(repoPath) : Promise.resolve(undefined),
            shouldRefreshStashes ? getStashes(repoPath) : Promise.resolve(undefined),
            shouldRefreshHistory ? getGitLog(repoPath, 50, 0) : Promise.resolve(undefined),
          ]);

          if (
            requestId !== requestIdRef.current ||
            useRepositoryStore.getState().activeRepoPath !== repoPath
          ) {
            return;
          }

          gitActions.refreshGitData({
            gitStatus: status,
            branches,
            commits,
            repoPath,
          });

          if (
            stashes &&
            requestId === requestIdRef.current &&
            useRepositoryStore.getState().activeRepoPath === repoPath
          ) {
            gitActions.setStashes(stashes);
          }
        } catch (error) {
          if (requestId === requestIdRef.current) {
            console.error("Failed to refresh git data:", error);
          }
        }
      })().finally(() => {
        if (refreshPromisesRef.current.get(refreshKey) === request) {
          refreshPromisesRef.current.delete(refreshKey);
        }
      });

      refreshPromisesRef.current.set(refreshKey, request);
      return request;
    },
    [activeRepoPath, gitActions],
  );

  const refresh = useCallback(async () => {
    gitActions.setIsRefreshing(true);
    try {
      await Promise.all([refreshGitData(), refreshWorkspaceRepositories()]);
    } finally {
      gitActions.setIsRefreshing(false);
    }
  }, [gitActions, refreshGitData, refreshWorkspaceRepositories]);

  useEffect(() => {
    void syncWorkspaceRepositories(workspacePath ?? null);
  }, [syncWorkspaceRepositories, workspacePath]);

  useEffect(() => {
    requestIdRef.current += 1;
    refreshPromisesRef.current.clear();
    void loadInitialGitData();

    return () => {
      requestIdRef.current += 1;
    };
  }, [loadInitialGitData]);

  useEffect(() => {
    if (autoRefreshGitStatus && isActive && !wasActiveRef.current && gitStatus) {
      void refreshGitData();
    }
    wasActiveRef.current = isActive;
  }, [autoRefreshGitStatus, gitStatus, isActive, refreshGitData]);

  useEffect(() => {
    if (!activeRepoPath) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToGitChanges((change) => {
      if (!isGitChangeRelevant(change, activeRepoPath)) return;
      if (!autoRefreshGitStatus && isPassiveGitChange(change)) return;
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => void refreshGitData(change.scopes), 100);
    });

    return () => {
      unsubscribe();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [activeRepoPath, autoRefreshGitStatus, refreshGitData]);

  return {
    activeRepoPath,
    refreshGitData,
    refresh,
  };
}
