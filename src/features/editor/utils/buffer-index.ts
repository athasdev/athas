import type { PaneContent } from "@/features/panes/types/pane-content.types";

interface BufferIndexes {
  byId: Map<string, PaneContent>;
  byPath: Map<string, PaneContent>;
  indexById: Map<string, number>;
}

const indexCache = new WeakMap<readonly PaneContent[], BufferIndexes>();

export function getBufferIndexes(buffers: readonly PaneContent[]): BufferIndexes {
  const cached = indexCache.get(buffers);
  if (cached) return cached;

  const byId = new Map<string, PaneContent>();
  const byPath = new Map<string, PaneContent>();
  const indexById = new Map<string, number>();

  for (let index = 0; index < buffers.length; index += 1) {
    const buffer = buffers[index];
    byId.set(buffer.id, buffer);
    indexById.set(buffer.id, index);
    if (!byPath.has(buffer.path)) {
      byPath.set(buffer.path, buffer);
    }
  }

  const indexes = { byId, byPath, indexById };
  indexCache.set(buffers, indexes);
  return indexes;
}

export function getBufferById(
  buffers: readonly PaneContent[],
  bufferId: string | null | undefined,
): PaneContent | null {
  if (!bufferId) return null;
  return getBufferIndexes(buffers).byId.get(bufferId) ?? null;
}

export function getBufferByPath(
  buffers: readonly PaneContent[],
  path: string | null | undefined,
): PaneContent | null {
  if (!path) return null;
  return getBufferIndexes(buffers).byPath.get(path) ?? null;
}

export function getBufferIndexById(buffers: readonly PaneContent[], bufferId: string): number {
  return getBufferIndexes(buffers).indexById.get(bufferId) ?? -1;
}
