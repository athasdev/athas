import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferByPath } from "@/features/editor/utils/buffer-index";
import { emitGitChanged } from "@/features/git/events/git-events";
import { showToast } from "@/features/layout/contexts/toast-context";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { readFileContent } from "../controllers/file-operations";
import { useFileSystemStore } from "../stores/file-system.store";
import { useFileWatcherStore } from "../stores/file-watcher.store";
import {
  cancelFileWatcherRefreshes,
  scheduleFileWatcherRefresh,
} from "./file-watcher-refresh-scheduler";
import { getDirName } from "@/utils/path-helpers";

/** The `file-changed` payload, from the project file watcher and from agent writes alike. */
export interface FileChangeEvent {
  path: string;
  event_type: "opened" | "reloaded" | "deleted";
  /** Set when an agent write made the change: the id of its `agent_file_write` event. */
  agent_write_id?: number;
}

let unlistenFileChanged: UnlistenFn | null = null;

function scheduleDirectoryRefresh(workspaceId: string, directoryPath: string) {
  scheduleFileWatcherRefresh(workspaceId, directoryPath, async () => {
    if (!workspaceRuntimeRegistry.hasWorkspace(workspaceId)) {
      return;
    }

    await useFileSystemStore.getStore(workspaceId).getState().refreshDirectory(directoryPath);
  });
}

/**
 * Brings an open editor up to date with a file that changed on disk. A clean buffer reloads. A
 * buffer with unsaved changes is never overwritten: if the disk now matches it (an agent wrote
 * back what it read from the buffer) it is simply marked saved, otherwise the user's edits stay
 * and a notice offers to reload.
 */
async function syncOpenBuffer(
  workspaceId: string,
  path: string,
): Promise<"not-open" | "synced" | "kept-unsaved"> {
  const bufferState = useBufferStore.getStore(workspaceId).getState();
  const buffer = getBufferByPath(bufferState.buffers, path);
  if (!buffer) {
    return "not-open";
  }

  if (buffer.type !== "editor" || !buffer.isDirty) {
    await bufferState.actions.reloadBufferFromDisk(buffer.id);
    return "synced";
  }

  const diskContent = await readFileContent(path).catch(() => null);
  if (diskContent === null) {
    return "kept-unsaved";
  }
  // The user may have saved or closed the file while the disk was read.
  const current = getBufferByPath(useBufferStore.getStore(workspaceId).getState().buffers, path);
  if (current?.type !== "editor") {
    return "not-open";
  }
  if (!current.isDirty) {
    await bufferState.actions.reloadBufferFromDisk(current.id);
    return "synced";
  }
  if (current.content === diskContent) {
    bufferState.actions.markBufferDirty(current.id, false);
    return "synced";
  }

  showToast({
    key: `file-changed-on-disk:${path}`,
    type: "warning",
    message: `${current.name} changed on disk`,
    description: "Your unsaved changes are kept. Reload to replace them with the file on disk.",
    duration: Infinity,
    action: {
      label: "Reload",
      onClick: () => {
        void useBufferStore
          .getStore(workspaceId)
          .getState()
          .actions.reloadBufferFromDisk(current.id)
          .then(() => {
            window.dispatchEvent(new CustomEvent("file-reloaded", { detail: { path } }));
          });
      },
    },
  });
  return "kept-unsaved";
}

export async function handleFileChange({ path, event_type, agent_write_id }: FileChangeEvent) {
  const workspaceId = workspaceRuntimeRegistry.getActiveWorkspaceId();

  window.dispatchEvent(
    new CustomEvent("file-external-change", {
      detail: { path, event_type, agentWriteId: agent_write_id },
    }),
  );

  if (event_type === "deleted" || event_type === "opened") {
    // Computed here rather than over IPC: bursts of watcher events each paid a round trip.
    scheduleDirectoryRefresh(workspaceId, getDirName(path));
    return;
  }

  const fileWatcherState = useFileWatcherStore.getStore(workspaceId).getState();
  if (fileWatcherState.pendingSaves.has(path)) {
    return;
  }

  const outcome = await syncOpenBuffer(workspaceId, path);
  if (outcome === "not-open") {
    return;
  }

  if (outcome === "synced") {
    window.dispatchEvent(new CustomEvent("file-reloaded", { detail: { path } }));
  }
  emitGitChanged({
    filePath: path,
    scopes: ["working-tree"],
    source: "external-file-change",
  });
}

export async function initializeFileWatcherListener() {
  await cleanupFileWatcherListener();

  unlistenFileChanged = await listen<FileChangeEvent>("file-changed", (event) =>
    handleFileChange(event.payload),
  );
}

export async function cleanupFileWatcherListener() {
  cancelFileWatcherRefreshes();

  if (!unlistenFileChanged) {
    return;
  }

  try {
    unlistenFileChanged();
  } catch (error) {
    console.error("Error cleaning up file change listener:", error);
  }
  unlistenFileChanged = null;
}
