import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { isVirtualContent } from "@/features/panes/types/pane-content.types";

const BUFFER_SEARCH_KEY_SEPARATOR = "\u0000";

export interface OpenBufferSearchSnapshot {
  activeBufferPath: string | undefined;
  openBufferPaths: ReadonlySet<string>;
  openBuffers: Array<{ name: string; path: string }>;
}

let lastBuffers: readonly PaneContent[] | null = null;
let lastActiveBufferId: string | null | undefined;
let lastSignature = "";
let lastSnapshot: OpenBufferSearchSnapshot | null = null;

function buildBufferSearchSignature(
  buffers: readonly PaneContent[],
  activeBufferId: string | null | undefined,
) {
  let signature = activeBufferId ?? "";

  for (const buffer of buffers) {
    signature +=
      BUFFER_SEARCH_KEY_SEPARATOR +
      buffer.id +
      BUFFER_SEARCH_KEY_SEPARATOR +
      buffer.path +
      BUFFER_SEARCH_KEY_SEPARATOR +
      (isVirtualContent(buffer) ? "1" : "0");
  }

  return signature;
}

export function getOpenBufferSearchSnapshot(
  buffers: readonly PaneContent[],
  activeBufferId: string | null | undefined,
): OpenBufferSearchSnapshot {
  if (buffers === lastBuffers && activeBufferId === lastActiveBufferId && lastSnapshot) {
    return lastSnapshot;
  }

  const signature = buildBufferSearchSignature(buffers, activeBufferId);
  if (signature === lastSignature && lastSnapshot) {
    lastBuffers = buffers;
    lastActiveBufferId = activeBufferId;
    return lastSnapshot;
  }

  let activeBufferPath: string | undefined;
  const openBufferPaths = new Set<string>();
  const openBuffers: Array<{ name: string; path: string }> = [];

  for (const buffer of buffers) {
    if (buffer.id === activeBufferId) {
      activeBufferPath = buffer.path;
    } else if (!isVirtualContent(buffer) && buffer.path) {
      openBufferPaths.add(buffer.path);
      openBuffers.push({ name: buffer.name, path: buffer.path });
    }
  }

  const snapshot = {
    activeBufferPath,
    openBufferPaths,
    openBuffers,
  };

  lastBuffers = buffers;
  lastActiveBufferId = activeBufferId;
  lastSignature = signature;
  lastSnapshot = snapshot;

  return snapshot;
}
