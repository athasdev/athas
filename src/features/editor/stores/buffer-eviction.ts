import type { PaneContent } from "@/features/panes/types/pane-content";

const AUTO_EVICTION_PROTECTED_TYPES = new Set<PaneContent["type"]>([
  "agent",
  "externalEditor",
  "terminal",
  "webViewer",
]);

export interface AutoEvictionOptions {
  includePreviews?: boolean;
}

export function canAutoEvictBuffer(
  buffer: PaneContent,
  { includePreviews = true }: AutoEvictionOptions = {},
): boolean {
  if (buffer.isPinned) return false;
  if (!includePreviews && buffer.isPreview) return false;
  return !AUTO_EVICTION_PROTECTED_TYPES.has(buffer.type);
}

export function evictLeastRecentAutoClosableBuffer(
  buffers: PaneContent[],
  maxOpenTabs: number,
  options: AutoEvictionOptions = {},
): { buffers: PaneContent[]; evictedBuffer: PaneContent | null } {
  const candidates = buffers.filter((buffer) => canAutoEvictBuffer(buffer, options));
  if (candidates.length < maxOpenTabs) {
    return { buffers, evictedBuffer: null };
  }

  const evictedBuffer = candidates[0] ?? null;
  if (!evictedBuffer) {
    return { buffers, evictedBuffer: null };
  }

  return {
    buffers: buffers.filter((buffer) => buffer.id !== evictedBuffer.id),
    evictedBuffer,
  };
}
