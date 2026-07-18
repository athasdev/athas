import type { StoreApi } from "zustand";

export const WELCOME_WORKSPACE_ID = "workspace:welcome";

export type WorkspaceRuntimeStatus = "empty" | "opening" | "ready" | "error";

export interface WorkspaceRuntimeDescriptor {
  id: string;
  name: string;
  path?: string;
}

export interface WorkspaceRuntime {
  descriptor: WorkspaceRuntimeDescriptor;
  status: WorkspaceRuntimeStatus;
  error?: string;
  stores: Map<string, StoreApi<unknown>>;
}
