import {
  flushPendingBufferHistory,
  syncBufferHistoryContent,
} from "../stores/buffer-history-tracking";
import { useHistoryStore } from "../stores/history.store";
import type { HistoryEntry } from "../types/history.types";
import { getBufferById } from "../stores/buffer-index";
import { isBufferStoreOwnerLive, type BufferStoreOwner } from "./buffer-store-owner";
import { readBufferText } from "./buffer-text";

export function applyBufferHistory(
  owner: BufferStoreOwner,
  bufferId: string,
  direction: "undo" | "redo",
  view: Pick<HistoryEntry, "cursorPosition" | "selection"> = {},
): HistoryEntry | null {
  if (!isBufferStoreOwnerLive(owner)) return null;
  const buffer = getBufferById(owner.store.getState().buffers, bufferId);
  if (!buffer || buffer.type !== "editor" || buffer.readOnly || buffer.isVirtual) return null;

  const content = readBufferText(buffer);
  flushPendingBufferHistory(bufferId, content, owner.workspaceId);
  const entry = useHistoryStore
    .getStore(owner.workspaceId)
    .getState()
    .actions[direction](bufferId, {
      content,
      ...view,
      timestamp: Date.now(),
    });
  if (!entry) return null;

  owner.store.getState().actions.updateBufferContent(bufferId, entry.content);
  if (isBufferStoreOwnerLive(owner))
    syncBufferHistoryContent(bufferId, entry.content, owner.workspaceId);
  return entry;
}
