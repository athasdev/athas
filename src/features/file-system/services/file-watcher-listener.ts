import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  WORKSPACE_FILE_CHANGES_EVENT,
  type WorkspaceFileChangeKind,
  type WorkspaceFileChanges,
} from "@/bindings/commands";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { getBufferByPath } from "@/features/editor/stores/buffer-index";
import { emitGitChanged } from "@/features/git/events/git-events";
import { invalidateFileTreeGitIgnoreCache } from "@/features/file-explorer/services/file-tree-gitignore";
import { showToast } from "@/utils/toast";
import { workspaceRuntimeRegistry } from "@/features/workspace/services/workspace-runtime-registry";
import { readFileContent } from "../api/file-operations";
import { useFileSystemStore } from "../stores/file-system.store";
import { useFileWatcherStore } from "../stores/file-watcher.store";
import {
  cancelFileWatcherRefreshes,
  scheduleFileWatcherRefresh,
} from "./file-watcher-refresh-scheduler";
import { getDirName } from "@/utils/path-helpers";
import { readBufferText } from "@/features/editor/services/buffer-text";
import { emitAppEvent } from "@/utils/app-events";

/** The `file-changed` payload, from the project file watcher and from agent writes alike. */
interface FileChangeEvent {
  path: string;
  event_type: "opened" | "reloaded" | "deleted";
  /** Set when an agent write made the change: the id of its `agent_file_write` event. */
  agent_write_id?: number;
}

let unlistenFileChanged: UnlistenFn | null = null;
let unlistenWorkspaceChanges: UnlistenFn | null = null;

const EVENT_TYPE_BY_KIND: Record<WorkspaceFileChangeKind, FileChangeEvent["event_type"]> = {
  created: "opened",
  modified: "reloaded",
  removed: "deleted",
};

interface WorkspaceRoots {
  rootFolderPath?: string;
  workspaceFolders?: { path: string }[];
}

/** The workspace whose root folder a watcher batch belongs to, else the active one. */
function findWorkspaceForRoot(root: string) {
  for (const {
    workspaceId,
    store,
  } of workspaceRuntimeRegistry.getExistingStoreEntries<WorkspaceRoots>("project")) {
    const { rootFolderPath, workspaceFolders } = store.getState();
    if (rootFolderPath === root || workspaceFolders?.some((folder) => folder.path === root)) {
      return workspaceId;
    }
  }
  return workspaceRuntimeRegistry.getActiveWorkspaceId();
}

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
async function syncOpenBuffer(workspaceId: string, path: string): Promise<void> {
  const bufferState = useBufferStore.getStore(workspaceId).getState();
  const buffer = getBufferByPath(bufferState.buffers, path);
  if (!buffer) {
    return;
  }

  if (buffer.type !== "editor" || !buffer.isDirty) {
    await bufferState.actions.reloadBufferFromDisk(buffer.id);
    return;
  }

  const diskContent = await readFileContent(path).catch(() => null);
  if (diskContent === null) {
    return;
  }
  // The user may have saved or closed the file while the disk was read.
  const current = getBufferByPath(useBufferStore.getStore(workspaceId).getState().buffers, path);
  if (current?.type !== "editor") {
    return;
  }
  if (!current.isDirty) {
    await bufferState.actions.reloadBufferFromDisk(current.id);
    return;
  }
  if (readBufferText(current) === diskContent) {
    bufferState.actions.markBufferDirty(current.id, false);
    return;
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
          .actions.reloadBufferFromDisk(current.id);
      },
    },
  });
}

/**
 * Applies one file change to the file tree and open editors. Returns whether the change can move
 * Git status: every change except the echo of our own save, which reports itself to Git.
 */
async function applyFileChange(
  { path, event_type, agent_write_id }: FileChangeEvent,
  workspaceId: string,
): Promise<boolean> {
  invalidateFileTreeGitIgnoreCache(path);

  emitAppEvent("file:external-change", { path, agentWriteId: agent_write_id });

  const isOwnSave = useFileWatcherStore.getStore(workspaceId).getState().pendingSaves.has(path);

  if (event_type === "deleted" || event_type === "opened") {
    // Computed here rather than over IPC: bursts of watcher events each paid a round trip.
    scheduleDirectoryRefresh(workspaceId, getDirName(path));
    return !isOwnSave;
  }

  if (isOwnSave) {
    return false;
  }

  await syncOpenBuffer(workspaceId, path);
  return true;
}

/** Handles one `file-changed` event: an agent write or delete, reported file by file. */
export async function handleFileChange(
  change: FileChangeEvent,
  workspaceId = workspaceRuntimeRegistry.getActiveWorkspaceId(),
) {
  if (!(await applyFileChange(change, workspaceId))) {
    return;
  }

  emitGitChanged({
    filePath: change.path,
    scopes: ["working-tree"],
    source: change.agent_write_id === undefined ? "external-file-change" : "agent-write",
  });
}

/**
 * Applies one watcher batch: every change under one workspace root from one debounce window,
 * already filtered by the ignore rules in Rust.
 */
export async function handleWorkspaceFileChanges(batch: WorkspaceFileChanges) {
  const workspaceId = findWorkspaceForRoot(batch.root);

  if (batch.rescan) {
    invalidateFileTreeGitIgnoreCache(batch.root);
    scheduleDirectoryRefresh(workspaceId, batch.root);
  }

  const outcomes = await Promise.all(
    batch.changes.map((change) =>
      applyFileChange(
        { path: change.path, event_type: EVENT_TYPE_BY_KIND[change.kind] },
        workspaceId,
      ),
    ),
  );

  if (batch.git_changed || batch.rescan) {
    emitGitChanged({
      repoPath: batch.root,
      scopes: ["working-tree", "history", "refs", "stashes"],
      source: "external-file-change",
    });
  } else if (outcomes.some(Boolean)) {
    // One refresh for the whole batch: a burst of writes to files that are not open in an
    // editor still changes Git status.
    emitGitChanged({
      repoPath: batch.root,
      scopes: ["working-tree"],
      source: "external-file-change",
    });
  }
}

export async function initializeFileWatcherListener() {
  await cleanupFileWatcherListener();

  // Agent writes still report each file on its own; the project watcher sends batches.
  unlistenFileChanged = await listen<FileChangeEvent>("file-changed", (event) =>
    handleFileChange(event.payload),
  );
  unlistenWorkspaceChanges = await listen<WorkspaceFileChanges>(
    WORKSPACE_FILE_CHANGES_EVENT,
    (event) => handleWorkspaceFileChanges(event.payload),
  );
}

export async function cleanupFileWatcherListener() {
  cancelFileWatcherRefreshes();

  for (const unlisten of [unlistenFileChanged, unlistenWorkspaceChanges]) {
    try {
      unlisten?.();
    } catch (error) {
      console.error("Error cleaning up file change listener:", error);
    }
  }
  unlistenFileChanged = null;
  unlistenWorkspaceChanges = null;
}
