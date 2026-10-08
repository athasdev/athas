import { hasTextContent, type PaneContent } from "@/features/panes/types/pane-content.types";
import { useBufferStore } from "../stores/buffer.store";
import { getBufferById } from "../stores/buffer-index";
import { readBufferText } from "./buffer-text";

function storeFor(workspaceId?: string | null) {
  return workspaceId ? useBufferStore.getStore(workspaceId) : useBufferStore;
}

/** The current text of an open buffer, or null when it is not open or holds no text. */
export function getBufferText(bufferId: string, workspaceId?: string | null): string | null {
  const buffer = getBufferById(storeFor(workspaceId).getState().buffers, bufferId);
  return buffer && hasTextContent(buffer) ? readBufferText(buffer) : null;
}

/**
 * The current text of `buffer`, looked up again by id so an object kept from an earlier store
 * state still yields today's text. Falls back to the object when the buffer is not in the active
 * workspace.
 */
export function resolveBufferText(buffer: PaneContent): string {
  return getBufferText(buffer.id) ?? readBufferText(buffer);
}
