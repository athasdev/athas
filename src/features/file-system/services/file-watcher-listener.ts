import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { dirname } from "@tauri-apps/api/path";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferByPath } from "@/features/editor/utils/buffer-index";
import { emitGitChanged } from "@/features/git/events/git-events";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { useFileSystemStore } from "../stores/file-system.store";
import { useFileWatcherStore } from "../stores/file-watcher.store";
import {
  cancelFileWatcherRefreshes,
  scheduleFileWatcherRefresh,
} from "./file-watcher-refresh-scheduler";

interface FileChangeEvent {
  path: string;
  event_type: "opened" | "reloaded" | "deleted";
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

export async function initializeFileWatcherListener() {
  await cleanupFileWatcherListener();

  unlistenFileChanged = await listen<FileChangeEvent>("file-changed", async (event) => {
    const { path, event_type } = event.payload;
    const workspaceId = workspaceRuntimeRegistry.getActiveWorkspaceId();
    const parentDirectory = await dirname(path);

    window.dispatchEvent(
      new CustomEvent("file-external-change", {
        detail: { path, event_type },
      }),
    );

    if (event_type === "deleted" || event_type === "opened") {
      scheduleDirectoryRefresh(workspaceId, parentDirectory);
      return;
    }

    const fileWatcherState = useFileWatcherStore.getStore(workspaceId).getState();
    if (fileWatcherState.pendingSaves.has(path)) {
      return;
    }

    const bufferState = useBufferStore.getStore(workspaceId).getState();
    const buffer = getBufferByPath(bufferState.buffers, path);
    if (!buffer) {
      return;
    }

    await bufferState.actions.reloadBufferFromDisk(buffer.id);
    window.dispatchEvent(new CustomEvent("file-reloaded", { detail: { path } }));
    emitGitChanged({
      filePath: path,
      scopes: ["working-tree"],
      source: "external-file-change",
    });
  });
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
