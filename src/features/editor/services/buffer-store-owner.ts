import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { useBufferStore } from "../stores/buffer.store";

export interface BufferStoreOwner {
  workspaceId: string;
  store: ReturnType<typeof useBufferStore.getStore>;
}
export function captureBufferStoreOwner(
  workspaceId = workspaceRuntimeRegistry.getActiveWorkspaceId(),
): BufferStoreOwner {
  if (!workspaceRuntimeRegistry.hasWorkspace(workspaceId))
    throw new Error("The workspace is no longer available");
  return { workspaceId, store: useBufferStore.getStore(workspaceId) };
}
export function isBufferStoreOwnerLive(owner: BufferStoreOwner): boolean {
  return (
    workspaceRuntimeRegistry.getWorkspace(owner.workspaceId)?.stores.get("editor-buffer") ===
    owner.store
  );
}
