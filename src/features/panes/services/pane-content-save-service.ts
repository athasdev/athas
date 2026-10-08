import { captureBufferStoreOwner } from "@/features/editor/services/buffer-store-owner";
import type { useBufferStore } from "@/features/editor/stores/buffer.store";
import {
  saveEditorBufferById,
  saveEditorBufferAsById,
} from "@/features/editor/services/editor-save-service";
import { saveImageBufferById } from "@/features/viewer/image/editor/services/image-buffer-session";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
export function savePaneContent(
  owner: ReturnType<typeof captureBufferStoreOwner>,
  bufferId: string,
  saveAs = false,
) {
  const buffer = owner.store.getState().buffers.find((item) => item.id === bufferId);
  return buffer?.type === "image"
    ? saveImageBufferById(owner, bufferId)
    : saveAs
      ? saveEditorBufferAsById(owner, bufferId)
      : saveEditorBufferById(owner, bufferId);
}
export async function savePendingPaneClose(
  workspaceId: string,
  request: NonNullable<ReturnType<typeof useBufferStore.getState>["pendingClose"]>,
) {
  if (!workspaceRuntimeRegistry.hasWorkspace(workspaceId)) return false;
  const owner = captureBufferStoreOwner(workspaceId);
  if (owner.store.getState().pendingClose !== request) return false;
  const saved = await savePaneContent(owner, request.bufferId);
  if (
    !saved ||
    workspaceRuntimeRegistry.getWorkspace(workspaceId)?.stores.get("editor-buffer") !== owner.store
  )
    return false;
  return owner.store.getState().actions.confirmCloseAfterSaving(request);
}
