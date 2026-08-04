import { createContext, useContext, useMemo, useSyncExternalStore } from "react";
import type { StoreApi, UseBoundStore } from "zustand";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { createSelectors, type WithSelectors } from "@/utils/zustand-selectors";

type WorkspaceStoreHook<T> = UseBoundStore<StoreApi<T>> & {
  getStore: (workspaceId: string) => StoreApi<T>;
};

export type WorkspaceScopedStore<T extends object> = WithSelectors<WorkspaceStoreHook<T>>;

type EqualityFn = (left: unknown, right: unknown) => boolean;
const subscribeToNothing = () => () => {};

export const WorkspaceStoreScopeContext = createContext<string | null>(null);

export function useWorkspaceStoreScopeId() {
  return useContext(WorkspaceStoreScopeContext);
}

export function useActiveWorkspaceId() {
  return useSyncExternalStore(
    workspaceRuntimeRegistry.subscribe,
    workspaceRuntimeRegistry.getActiveWorkspaceId,
    workspaceRuntimeRegistry.getActiveWorkspaceId,
  );
}

export function createWorkspaceScopedStore<T extends object>(
  key: string,
  factory: (workspaceId: string) => StoreApi<T>,
  equalityFn?: EqualityFn,
): WorkspaceScopedStore<T> {
  workspaceRuntimeRegistry.registerStore(key, factory);

  const useWorkspaceStore = (<U>(selector?: (state: T) => U): U => {
    const scopedWorkspaceId = useWorkspaceStoreScopeId();
    const getScopedWorkspaceId = useMemo(
      () => () => scopedWorkspaceId ?? workspaceRuntimeRegistry.getActiveWorkspaceId(),
      [scopedWorkspaceId],
    );
    const workspaceId = useSyncExternalStore(
      scopedWorkspaceId ? subscribeToNothing : workspaceRuntimeRegistry.subscribe,
      scopedWorkspaceId ? getScopedWorkspaceId : workspaceRuntimeRegistry.getActiveWorkspaceId,
      scopedWorkspaceId ? getScopedWorkspaceId : workspaceRuntimeRegistry.getActiveWorkspaceId,
    );
    const store = workspaceRuntimeRegistry.getStore<T>(key, workspaceId);
    return useStoreWithEqualityFn(
      store,
      selector ?? ((state: T) => state as unknown as U),
      equalityFn,
    );
  }) as WorkspaceStoreHook<T>;

  useWorkspaceStore.getState = () => workspaceRuntimeRegistry.getStore<T>(key).getState();
  useWorkspaceStore.getInitialState = () =>
    workspaceRuntimeRegistry.getStore<T>(key).getInitialState();
  useWorkspaceStore.setState = ((...args: unknown[]) => {
    const setState = workspaceRuntimeRegistry.getStore<T>(key).setState as (
      ...setStateArgs: unknown[]
    ) => void;
    setState(...args);
  }) as WorkspaceStoreHook<T>["setState"];
  useWorkspaceStore.subscribe = ((listener: (state: T, previousState: T) => void) => {
    let store = workspaceRuntimeRegistry.getStore<T>(key);
    let currentState = store.getState();
    let unsubscribeStore = store.subscribe((state, previousState) => {
      currentState = state;
      listener(state, previousState);
    });

    const unsubscribeRegistry = workspaceRuntimeRegistry.subscribe(() => {
      const nextStore = workspaceRuntimeRegistry.getStore<T>(key);
      if (nextStore === store) {
        return;
      }

      const previousState = currentState;
      unsubscribeStore();
      store = nextStore;
      currentState = store.getState();
      unsubscribeStore = store.subscribe((state, previousStoreState) => {
        currentState = state;
        listener(state, previousStoreState);
      });
      listener(currentState, previousState);
    });

    return () => {
      unsubscribeStore();
      unsubscribeRegistry();
    };
  }) as WorkspaceStoreHook<T>["subscribe"];
  useWorkspaceStore.getStore = (workspaceId) =>
    workspaceRuntimeRegistry.getStore<T>(key, workspaceId);

  return createSelectors(useWorkspaceStore) as WorkspaceScopedStore<T>;
}
