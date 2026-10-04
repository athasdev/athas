import { trackImmediateBufferHistoryChange } from "@/features/editor/stores/buffer-history-tracking";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getSourceEditorBufferByPath } from "@/features/editor/utils/buffer-index";
import { getWorkspaceResourceProvider } from "@/features/file-system/services/workspace-resource-provider";
import { useFileWatcherStore } from "@/features/file-system/stores/file-watcher.store";
import { emitGitChanged } from "@/features/git/events/git-events";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { showConfirmDialog } from "@/ui/dialog";
import { readLocalHistoryEntry, recordLocalHistoryFile } from "../api/local-history-api";

const restores = new WeakMap<
  ReturnType<typeof useBufferStore.getStore>,
  Map<string, Promise<boolean>>
>();

export function restoreLocalHistorySnapshot({
  path,
  entryId,
  workspaceId,
  signal,
}: {
  path: string;
  entryId: string;
  workspaceId: string;
  signal?: AbortSignal;
}): Promise<boolean> {
  if (signal?.aborted || !workspaceRuntimeRegistry.hasWorkspace(workspaceId))
    return Promise.resolve(false);
  const owner = useBufferStore.getStore(workspaceId);
  let pending = restores.get(owner);
  if (!pending) {
    pending = new Map();
    restores.set(owner, pending);
  }
  const existing = pending.get(path);
  if (existing) return existing;
  const tasks = pending;
  const original = getSourceEditorBufferByPath(owner.getState().buffers, path);
  const isOwnerLive = () =>
    workspaceRuntimeRegistry.getWorkspace(workspaceId)?.stores.get("editor-buffer") === owner;
  const isLive = () => !signal?.aborted && isOwnerLive();
  const getCurrent = () => getSourceEditorBufferByPath(owner.getState().buffers, path);
  const matchesOriginal = () => {
    const current = getCurrent();
    return original
      ? current?.id === original.id &&
          !current.readOnly &&
          current.content === original.content &&
          current.savedContent === original.savedContent &&
          (current.contentRevision ?? 0) === (original.contentRevision ?? 0)
      : !current;
  };
  const task = Promise.resolve()
    .then(async () => {
      if (!isLive()) return false;
      if (path.includes("://")) throw new Error("Local history can only restore local files.");
      if (original?.readOnly) throw new Error("This file is read-only.");
      if (original?.isDirty) {
        const approved = await showConfirmDialog(
          `Replace the unsaved changes in ${original.name} with this snapshot? Your draft will remain available through Undo.`,
          { title: "Restore snapshot", confirmLabel: "Restore", cancelLabel: "Cancel", signal },
        );
        if (!approved || !isLive()) return false;
      }
      if (!matchesOriginal())
        throw new Error("The file changed while preparing restoration. Review it and try again.");
      const provider = getWorkspaceResourceProvider(path);
      const [content, diskContent] = await Promise.all([
        readLocalHistoryEntry(path, entryId),
        provider.readText(path),
      ]);
      if (!isLive()) return false;
      if (!matchesOriginal())
        throw new Error("The file changed while preparing restoration. Review it and try again.");
      if (original && original.savedContent !== diskContent)
        throw new Error("The file changed on disk. Reload it before restoring a snapshot.");
      await recordLocalHistoryFile(path, "restore");
      if (!isLive()) return false;
      if (!matchesOriginal())
        throw new Error("The file changed while preparing restoration. Review it and try again.");
      const watcher = useFileWatcherStore.getStore(workspaceId).getState().actions;
      watcher.markPendingSave(path);
      try {
        await provider.writeText(path, content, diskContent);
      } catch (error) {
        watcher.clearPendingSave(path);
        throw error;
      }
      emitGitChanged({ filePath: path, scopes: ["working-tree"], source: "restore-local-history" });
      if (!isOwnerLive()) return true;
      const current = getCurrent();
      if (current && (current.savedContent === diskContent || current.savedContent === content)) {
        const unchanged =
          original &&
          current.id === original.id &&
          current.content === original.content &&
          (current.contentRevision ?? 0) === (original.contentRevision ?? 0);
        if (
          !signal?.aborted &&
          !current.readOnly &&
          (unchanged || (!original && !current.isDirty && current.content === diskContent))
        ) {
          trackImmediateBufferHistoryChange({
            workspaceId: workspaceId,
            bufferId: current.id,
            currentContent: current.content,
            nextContent: content,
          });
          owner.getState().actions.updateBufferContent(current.id, content, false);
        }
        owner.getState().actions.markBufferSaved(current.id, content);
      }
      return true;
    })
    .finally(() => {
      if (tasks.get(path) === task) tasks.delete(path);
    });
  tasks.set(path, task);
  return task;
}
