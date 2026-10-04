import { savePaneContent } from "@/features/panes/services/pane-content-save-service";
import {
  isBufferStoreOwnerLive,
  type BufferStoreOwner,
} from "@/features/editor/services/buffer-store-owner";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferById } from "@/features/editor/utils/buffer-index";
import {
  isDirtyContent,
  type EditorContent,
  type ImageContent,
} from "@/features/panes/types/pane-content.types";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";

export interface PendingWindowClose {
  owner: BufferStoreOwner;
  buffer: EditorContent | ImageContent;
}

function sameDraft(current: EditorContent | ImageContent, original: EditorContent | ImageContent) {
  if (
    current.id !== original.id ||
    current.path !== original.path ||
    current.type !== original.type
  )
    return false;
  if (current.type === "editor" && original.type === "editor")
    return (
      current.content === original.content &&
      (current.contentRevision ?? 0) === (original.contentRevision ?? 0)
    );
  if (current.type === "image" && original.type === "image")
    return (
      current.imageDraft?.revision === original.imageDraft?.revision &&
      current.imageDraft?.processing === original.imageDraft?.processing &&
      current.imageDraft?.history[current.imageDraft.index] ===
        original.imageDraft?.history[original.imageDraft.index]
    );
  return false;
}

export class WindowCloseSession {
  private revision = 0;
  private discarded = new WeakMap<
    BufferStoreOwner["store"],
    Map<string, EditorContent | ImageContent>
  >();

  reset() {
    this.revision++;
    this.discarded = new WeakMap();
  }

  findBlockingDraft(): PendingWindowClose | null {
    const activeId = workspaceRuntimeRegistry.getActiveWorkspaceId();
    const entries =
      workspaceRuntimeRegistry.getExistingStoreEntries<ReturnType<typeof useBufferStore.getState>>(
        "editor-buffer",
      );
    entries.sort((a, b) => Number(b.workspaceId === activeId) - Number(a.workspaceId === activeId));
    for (const { workspaceId, store } of entries) {
      for (const buffer of store.getState().buffers) {
        if ((buffer.type !== "editor" && buffer.type !== "image") || !isDirtyContent(buffer))
          continue;
        const discarded = this.discarded.get(store)?.get(buffer.id);
        if (discarded && sameDraft(buffer, discarded)) continue;
        return { owner: { workspaceId, store }, buffer };
      }
    }
    return null;
  }

  isDraftPresent(request: PendingWindowClose): boolean {
    if (!isBufferStoreOwnerLive(request.owner)) return false;
    const buffer = getBufferById(request.owner.store.getState().buffers, request.buffer.id);
    return !!buffer && buffer.type === request.buffer.type && buffer.path === request.buffer.path;
  }

  discard(request: PendingWindowClose): boolean {
    if (!isBufferStoreOwnerLive(request.owner)) return false;
    const current = getBufferById(request.owner.store.getState().buffers, request.buffer.id);
    if (
      !current ||
      (current.type !== "editor" && current.type !== "image") ||
      !sameDraft(current, request.buffer)
    )
      return false;
    let discarded = this.discarded.get(request.owner.store);
    if (!discarded) {
      discarded = new Map();
      this.discarded.set(request.owner.store, discarded);
    }
    discarded.set(current.id, current);
    return true;
  }

  async save(request: PendingWindowClose): Promise<boolean> {
    const revision = this.revision;
    if (!this.isDraftPresent(request)) return false;
    const saved = await savePaneContent(request.owner, request.buffer.id);
    if (!saved || revision !== this.revision || !isBufferStoreOwnerLive(request.owner))
      return false;
    const current = getBufferById(request.owner.store.getState().buffers, request.buffer.id);
    return !current || !isDirtyContent(current);
  }
}
