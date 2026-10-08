import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-explorer-tree.store";
import { getBaseName } from "@/utils/path-helpers";
import { relocatePath } from "./file-tree-utils";

/**
 * After an entry was renamed or moved on disk, points what is open under it at the new path:
 * the buffers for it and every file inside it, and the explorer's expanded and selected rows.
 */
export function relocateOpenPaths(workspaceId: string, oldPath: string, newPath: string): void {
  if (oldPath === newPath) return;

  useFileTreeStore.getStore(workspaceId).getState().actions.relocatePath(oldPath, newPath);

  const bufferStore = useBufferStore.getStore(workspaceId);
  const { updateBuffer } = bufferStore.getState().actions;
  for (const buffer of bufferStore.getState().buffers) {
    const path = relocatePath(buffer.path, oldPath, newPath);
    if (path === null) continue;
    updateBuffer({
      ...buffer,
      path,
      name: buffer.path === oldPath ? getBaseName(newPath, buffer.name) : buffer.name,
    });
  }
}
