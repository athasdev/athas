import { isSingletonToolBuffer } from "@/features/panes/constants/tool-buffers";
import { isDirtyContent, type PaneContent } from "@/features/panes/types/pane-content.types";

const AUTO_EVICTION_PROTECTED_TYPES = new Set<PaneContent["type"]>([
  "agent",
  "browser",
  "externalEditor",
  "terminal",
]);

interface AutoEvictionOptions {
  includePreviews?: boolean;
  /** Pane-owned tab state; pinned buffers are never evicted, previews only when allowed. */
  pinnedBufferIds?: ReadonlySet<string>;
  previewBufferIds?: ReadonlySet<string>;
}

function canAutoEvictBuffer(
  buffer: PaneContent,
  { includePreviews = true, pinnedBufferIds, previewBufferIds }: AutoEvictionOptions = {},
): boolean {
  if (pinnedBufferIds?.has(buffer.id) || isDirtyContent(buffer)) return false;
  if (!includePreviews && previewBufferIds?.has(buffer.id)) return false;
  if (isSingletonToolBuffer(buffer)) return false;
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
