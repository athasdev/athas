import { useSyncExternalStore } from "react";
import type { StoreApi, UseBoundStore } from "zustand";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";

export type WorkspaceScopedStore<T> = UseBoundStore<StoreApi<T>> & {
  getStore: (workspaceId: string) => StoreApi<T>;
};

type EqualityFn = (left: unknown, right: unknown) => boolean;

export function createWorkspaceScopedStore<T>(
  key: string,
  factory: () => StoreApi<T>,
  equalityFn?: EqualityFn,
): WorkspaceScopedStore<T> {
  workspaceRuntimeRegistry.registerStore(key, factory);

  const useWorkspaceStore = (<U>(selector?: (state: T) => U): U => {
    const workspaceId = useSyncExternalStore(
      workspaceRuntimeRegistry.subscribe,
      workspaceRuntimeRegistry.getActiveWorkspaceId,
      workspaceRuntimeRegistry.getActiveWorkspaceId,
    );
    const store = workspaceRuntimeRegistry.getStore<T>(key, workspaceId);
    return useStoreWithEqualityFn(
      store,
      selector ?? ((state: T) => state as unknown as U),
      equalityFn,
    );
  }) as WorkspaceScopedStore<T>;

  useWorkspaceStore.getState = () => workspaceRuntimeRegistry.getStore<T>(key).getState();
  useWorkspaceStore.getInitialState = () =>
    workspaceRuntimeRegistry.getStore<T>(key).getInitialState();
  useWorkspaceStore.setState = ((...args: unknown[]) => {
    const setState = workspaceRuntimeRegistry.getStore<T>(key).setState as (
      ...setStateArgs: unknown[]
    ) => void;
    setState(...args);
  }) as WorkspaceScopedStore<T>["setState"];
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
  }) as WorkspaceScopedStore<T>["subscribe"];
  useWorkspaceStore.getStore = (workspaceId) =>
    workspaceRuntimeRegistry.getStore<T>(key, workspaceId);

  return useWorkspaceStore;
}
