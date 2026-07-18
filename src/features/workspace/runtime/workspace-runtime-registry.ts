import type { StoreApi } from "zustand";
import {
  WELCOME_WORKSPACE_ID,
  type WorkspaceRuntime,
  type WorkspaceRuntimeDescriptor,
  type WorkspaceRuntimeStatus,
} from "@/features/workspace/types/workspace-runtime.types";

type WorkspaceStoreFactory = () => StoreApi<unknown>;
type WorkspaceChangeListener = () => void;

const welcomeWorkspace: WorkspaceRuntimeDescriptor = {
  id: WELCOME_WORKSPACE_ID,
  name: "Files",
};

export class WorkspaceRuntimeRegistry {
  private activeWorkspaceId = WELCOME_WORKSPACE_ID;
  private readonly runtimes = new Map<string, WorkspaceRuntime>();
  private readonly storeFactories = new Map<string, WorkspaceStoreFactory>();
  private readonly listeners = new Set<WorkspaceChangeListener>();

  constructor() {
    this.ensureWorkspace(welcomeWorkspace, "empty");
  }

  registerStore<T>(key: string, factory: () => StoreApi<T>) {
    this.storeFactories.set(key, factory as WorkspaceStoreFactory);
  }

  ensureWorkspace(
    descriptor: WorkspaceRuntimeDescriptor,
    status: WorkspaceRuntimeStatus = "opening",
  ) {
    const existing = this.runtimes.get(descriptor.id);
    if (existing) {
      existing.descriptor = { ...existing.descriptor, ...descriptor };
      return existing;
    }

    const runtime: WorkspaceRuntime = {
      descriptor,
      status,
      stores: new Map(),
    };
    this.runtimes.set(descriptor.id, runtime);
    return runtime;
  }

  activateWorkspace(
    descriptor: WorkspaceRuntimeDescriptor,
    status: WorkspaceRuntimeStatus = "opening",
  ) {
    this.ensureWorkspace(descriptor, status);
    if (this.activeWorkspaceId === descriptor.id) {
      return;
    }

    this.activeWorkspaceId = descriptor.id;
    this.emitChange();
  }

  updateWorkspaceStatus(id: string, status: WorkspaceRuntimeStatus, error?: string) {
    const runtime = this.runtimes.get(id);
    if (!runtime) {
      return;
    }

    runtime.status = status;
    runtime.error = error;
  }

  removeWorkspace(id: string) {
    if (id === WELCOME_WORKSPACE_ID) {
      return;
    }

    if (this.runtimes.delete(id) && this.activeWorkspaceId !== id) {
      this.emitChange();
    }
  }

  hasWorkspace(id: string) {
    return this.runtimes.has(id);
  }

  isWorkspaceReady(id: string) {
    return this.runtimes.get(id)?.status === "ready";
  }

  getWorkspace(id: string) {
    return this.runtimes.get(id);
  }

  getExistingStores<T>(key: string) {
    return [...this.runtimes.values()]
      .map((runtime) => runtime.stores.get(key))
      .filter((store): store is StoreApi<unknown> => !!store) as StoreApi<T>[];
  }

  getActiveWorkspaceId = () => this.activeWorkspaceId;

  getActiveWorkspace() {
    return this.runtimes.get(this.activeWorkspaceId);
  }

  getStore<T>(key: string, workspaceId = this.activeWorkspaceId): StoreApi<T> {
    const runtime =
      this.runtimes.get(workspaceId) ??
      this.ensureWorkspace({ id: workspaceId, name: workspaceId }, "opening");
    const existing = runtime.stores.get(key);
    if (existing) {
      return existing as StoreApi<T>;
    }

    const factory = this.storeFactories.get(key);
    if (!factory) {
      throw new Error(`Workspace store is not registered: ${key}`);
    }

    const store = factory();
    runtime.stores.set(key, store);
    return store as StoreApi<T>;
  }

  subscribe = (listener: WorkspaceChangeListener) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  subscribeToStoreKey(key: string, listener: WorkspaceChangeListener) {
    let storeUnsubscribers: Array<() => void> = [];

    const bindStores = () => {
      for (const unsubscribe of storeUnsubscribers) {
        unsubscribe();
      }
      storeUnsubscribers = this.getExistingStores(key).map((store) => store.subscribe(listener));
    };

    bindStores();
    const unsubscribeRegistry = this.subscribe(() => {
      bindStores();
      listener();
    });

    return () => {
      unsubscribeRegistry();
      for (const unsubscribe of storeUnsubscribers) {
        unsubscribe();
      }
    };
  }

  resetForTests() {
    this.activeWorkspaceId = WELCOME_WORKSPACE_ID;
    this.runtimes.clear();
    this.ensureWorkspace(welcomeWorkspace, "empty");
    this.emitChange();
  }

  private emitChange() {
    for (const listener of this.listeners) {
      listener();
    }
  }
}

export const workspaceRuntimeRegistry = new WorkspaceRuntimeRegistry();
