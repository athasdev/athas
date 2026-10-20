import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { PROJECT_TAB_SET, type TabSetOwner, useTabSetsStore } from "../stores/tab-sets.store";

/** Shows `owner`'s tabs in the active workspace's centre. Returns whether the owner changed. */
export function showTabSet(owner: TabSetOwner): boolean {
  const openBufferIds = new Set(useBufferStore.getState().buffers.map((buffer) => buffer.id));
  return useTabSetsStore.getState().actions.switchTo(owner, {
    isOpenBuffer: (bufferId) => openBufferIds.has(bufferId),
  });
}

/** Shows the project's own tabs, its classic view without a session. */
export function showProjectTabSet(): boolean {
  return showTabSet(PROJECT_TAB_SET);
}
