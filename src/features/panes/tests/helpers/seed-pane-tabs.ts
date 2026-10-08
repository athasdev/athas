import { BOTTOM_PANE_ID, ROOT_PANE_ID } from "@/features/panes/constants/pane";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";

/**
 * Shows `bufferIds` as the root pane's tabs with `activeBufferId` active and focused, the state the
 * workbench reaches after opening them. The active buffer is derived from it.
 */
export function seedPaneTabs(
  bufferIds: readonly string[],
  activeBufferId: string | null = bufferIds[0] ?? null,
  workspaceId?: string,
) {
  const store = workspaceId ? usePaneStore.getStore(workspaceId) : usePaneStore;
  const ids =
    activeBufferId && !bufferIds.includes(activeBufferId)
      ? [...bufferIds, activeBufferId]
      : [...bufferIds];
  store.getState().actions.restoreLayout({
    root: { id: ROOT_PANE_ID, type: "group", bufferIds: ids, activeBufferId },
    bottomRoot: { id: BOTTOM_PANE_ID, type: "group", bufferIds: [], activeBufferId: null },
    activePaneId: ROOT_PANE_ID,
    fullscreenPaneId: null,
  });
}

/** Shows every open buffer in the root pane and makes `activeBufferId` the active tab. */
export function seedActiveBuffer(activeBufferId: string | null | undefined, workspaceId?: string) {
  // Read through the registry so this helper never loads the buffer store module itself.
  const bufferStore = workspaceRuntimeRegistry.getStore<{ buffers: { id: string }[] }>(
    "editor-buffer",
    workspaceId,
  );
  seedPaneTabs(
    bufferStore.getState().buffers.map((buffer) => buffer.id),
    activeBufferId ?? null,
    workspaceId,
  );
}
