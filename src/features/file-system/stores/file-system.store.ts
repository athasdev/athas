import { invoke } from "@tauri-apps/api/core";
import { basename, dirname, extname, join } from "@tauri-apps/api/path";
import { copyFile, readFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { immer } from "zustand/middleware/immer";
import type { StoreApi } from "zustand";
import { createStore } from "zustand/vanilla";
import { useAIChatStore } from "@/features/ai/stores/ai-chat.store";
import type { CodeEditorRef } from "@/features/editor/components/code-editor";
import {
  buildPersistedEditorViewState,
  restorePersistedEditorViewState,
} from "@/features/editor/stores/editor-session-state";
import {
  clearQueuedWorkspaceSessionSave,
  useBufferStore,
} from "@/features/editor/stores/buffer.store";
import { getBufferById, getBufferByPath } from "@/features/editor/utils/buffer-index";
import { fileOpenBenchmark } from "@/features/editor/utils/file-open-benchmark";
import { getLineSlice } from "@/features/editor/utils/large-file";
import { getAncestorDirectoryPaths } from "@/features/file-explorer/utils/file-explorer-tree-utils";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-explorer-tree.store";
import { getGitStatus } from "@/features/git/api/git-status-api";
import { useGitBlameStore } from "@/features/git/stores/git-blame.store";
import { useGitStore } from "@/features/git/stores/git.store";
import { gitDiffCache } from "@/features/git/utils/git-diff-cache";
import { connectionStore } from "@/features/remote/stores/remote-connection.store";
import { buildRemoteRootPath, parseRemotePath } from "@/features/remote/utils/remote-path";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useSidebarStore } from "@/features/layout/stores/sidebar.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import type { BufferSession } from "@/features/window/stores/session.store";
import {
  persistCurrentProjectUiState,
  restoreProjectPaneState,
  restoreProjectUiState,
} from "@/features/window/stores/workspace-ui-session";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import { serializeTerminals } from "@/features/terminal/lib/terminal-session-storage";
import { useTerminalTabsStore } from "@/features/terminal/stores/terminal-tabs.store";
import { useTerminalStore } from "@/features/terminal/stores/terminal.store";
import { createTerminalEventChannel } from "@/features/terminal/utils/terminal-protocol";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { showAlertDialog, showPromptDialog } from "@/features/dialogs/services/dialog-service";
import { workspaceRuntimeRegistry } from "@/features/workspace/runtime/workspace-runtime-registry";
import { workspaceSessionRepository } from "@/features/workspace/persistence/workspace-session-repository";
import {
  createWorkspaceScopedStore,
  type WorkspaceScopedStore,
} from "@/features/workspace/stores/create-workspace-scoped-store";
import { toast } from "sonner";
import { frontendTrace } from "@/utils/frontend-trace";
import {
  ensureTrailingPathSeparator,
  getBaseName,
  getDirName,
  getFolderName,
  joinPath,
} from "@/utils/path-helpers";
import { createSelectors } from "@/utils/zustand-selectors";
import type { FileEntry } from "../types/app.types";
import type { FsActions, FsState } from "../types/interface.types";
import {
  createNewDirectory,
  createNewFile,
  deleteFileOrDirectory,
  readDirectoryContents,
  readFileContent,
} from "../controllers/file-operations";
import {
  addFileToTree,
  findFileInTree,
  removeFileFromTree,
  sortFileEntries,
  updateFileInTree,
} from "../controllers/file-tree-utils";
import {
  getDatabaseTypeFromPath,
  getFilenameFromPath,
  isBinaryContent,
  isBinaryFile,
  isKnownTextFile,
  isImageFile,
  isPdfFile,
} from "../controllers/file-utils";
import { useFileWatcherStore } from "../stores/file-watcher.store";
import { fffListFiles, fffTrackAccess } from "@/features/file-search/lib/file-search-api";
import { canUseNativeFileSearch } from "@/features/file-search/utils/file-search-paths";
import { ensureWorkspaceFileSearch } from "@/features/file-search/services/workspace-file-search";
import { getSymlinkInfo, openFolder, readDirectory, renameFile } from "../controllers/platform";
import { useRecentFoldersStore } from "../stores/recent-folders.store";
import { useRecentFilesStore } from "../stores/recent-files.store";
import {
  buildRemoteWorkspaceTree,
  type RemoteDirectoryEntry,
} from "../controllers/remote-workspace";
import {
  buildWslWorkspaceTree,
  getWslProjectName,
  type WslDirectoryEntry,
} from "@/features/wsl/controllers/wsl-workspace";
import { buildWslPath, parseWslPath, resolveWslTargetPath } from "@/features/wsl/utils/wsl-path";
import { shouldIgnore, updateDirectoryContents } from "../controllers/utils";
import {
  getDirtyEditorBuffers,
  prepareProjectTransitionWithUnsavedBuffers,
} from "../controllers/workspace-project-transition";
import {
  buildWorkspaceRestoreBatch,
  buildWorkspaceRestorePlan,
  getEditorWorkspaceScope,
  isLocalFileInWorkspace,
  isWorkspaceFolderPath,
  normalizeWorkspaceFolders,
} from "../controllers/workspace-session";
import type { WorkspaceSessionBuffer } from "../controllers/workspace-session";

const logWorkspaceOpenStep = (
  phase: "start" | "end" | "error",
  label: string,
  path: string,
  startedAt?: number,
) => {
  if (phase === "start") {
    frontendTrace("info", "workspace-open", `${label}:start`, { path });
    return;
  }

  const durationMs =
    typeof startedAt === "number" ? Math.round((performance.now() - startedAt) * 100) / 100 : null;
  const payload = { path, durationMs };

  if (phase === "end") {
    frontendTrace("info", "workspace-open", `${label}:end`, payload);
    return;
  }

  frontendTrace("error", "workspace-open", `${label}:error`, payload);
};

const inFlightFileReads = new Map<string, Promise<unknown>>();

function readFileOnce<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const existing = inFlightFileReads.get(key) as Promise<T> | undefined;
  if (existing) return existing;

  const promise = loader().finally(() => {
    inFlightFileReads.delete(key);
  });
  inFlightFileReads.set(key, promise);
  return promise;
}

/**
 * Wraps the file tree with a root folder entry
 */
const wrapWithRootFolder = (
  files: FileEntry[],
  rootPath: string,
  rootName: string,
): FileEntry[] => {
  return [
    {
      name: rootName,
      path: rootPath,
      isDir: true,
      children: files,
    },
  ];
};

const getWorkspaceFolderPaths = (get: FileSystemGet) =>
  normalizeWorkspaceFolders(get().rootFolderPath, get().workspaceFolders).map(
    (folder) => folder.path,
  );

const syncFffWorkspace = async (get: FileSystemGet): Promise<void> => {
  try {
    await ensureWorkspaceFileSearch(getWorkspaceFolderPaths(get));
  } catch (error) {
    console.error("[fff] workspace sync failed:", error);
  }
};

const readWorkspaceRootEntry = async (path: string): Promise<FileEntry> => {
  const projectName = getFolderName(path);
  const entries = await readProviderDirectoryEntries(path);
  const fileTree = sortFileEntries(entries);
  return wrapWithRootFolder(fileTree, path, projectName)[0];
};

const toRemoteFileEntries = (
  connectionId: string,
  entries: Array<{ name: string; path: string; is_dir: boolean }>,
): FileEntry[] =>
  entries.map((entry) => ({
    name: entry.name,
    path: `remote://${connectionId}${entry.path}`,
    isDir: entry.is_dir,
    children: entry.is_dir ? [] : undefined,
  }));

const toWslFileEntries = (entries: WslDirectoryEntry[]): FileEntry[] =>
  entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
    isDir: entry.is_dir,
    children: entry.is_dir ? [] : undefined,
    isSymlink: entry.is_symlink,
    symlinkTarget: entry.target ?? undefined,
  }));

const readProviderDirectoryEntries = async (
  path: string,
  workspaceRoot = path,
): Promise<FileEntry[]> => {
  const remoteInfo = parseRemotePath(path);
  if (remoteInfo) {
    const entries = await invoke<
      Array<{ name: string; path: string; is_dir: boolean; size: number }>
    >("ssh_read_directory", {
      connectionId: remoteInfo.connectionId,
      path: remoteInfo.remotePath,
    });
    return toRemoteFileEntries(remoteInfo.connectionId, entries);
  }

  const wslInfo = parseWslPath(path);
  if (wslInfo) {
    const entries = await invoke<WslDirectoryEntry[]>("wsl_read_directory", {
      distro: wslInfo.distro,
      path: wslInfo.linuxPath,
    });
    return toWslFileEntries(entries);
  }

  return sortFileEntries(await readDirectoryContents(path, workspaceRoot));
};

let latestFileOpenRequestId = 0;
const textFileDecoder = new TextDecoder("utf-8");
const MAX_SESSION_BUFFERS_TO_RESTORE = 8;

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error || "Unknown error");

const readPersistedAiWorkspaceSession = () =>
  useAIChatStore.getState().getWorkspaceSessionSnapshot(useBufferStore.getState().buffers);

const recordLocalFileAccess = (
  path: string,
  name: string,
  workspaceRootPath: string | undefined,
  workspaceFolderPaths: string[] = [],
) => {
  if (path.startsWith("remote://") || path.startsWith("wsl://") || path.startsWith("diff://")) {
    return;
  }

  useRecentFilesStore.getState().addOrUpdateRecentFile(path, name, {
    workspacePath: workspaceRootPath ?? null,
    external: !isLocalFileInWorkspace(path, workspaceRootPath, workspaceFolderPaths),
  });
};

const serializeWorkspaceBuffer = (
  buffer: PaneContent,
  workspaceRootPath: string | undefined,
  workspaceFolderPaths: string[] = [],
): BufferSession | null => {
  if (buffer.type === "editor" && !buffer.isVirtual) {
    return {
      type: "editor",
      id: buffer.id,
      name: buffer.name,
      path: buffer.path,
      isPinned: buffer.isPinned,
      isPreview: buffer.isPreview,
      workspaceScope: getEditorWorkspaceScope(buffer.path, workspaceRootPath, workspaceFolderPaths),
      editorState: buildPersistedEditorViewState(buffer),
    };
  }

  if (buffer.type === "terminal") {
    return {
      type: "terminal",
      path: buffer.path,
      name: buffer.name,
      isPinned: buffer.isPinned,
      sessionId: buffer.sessionId,
      initialCommand: buffer.initialCommand,
      workingDirectory: buffer.workingDirectory,
      remoteConnectionId: buffer.remoteConnectionId,
    };
  }

  if (buffer.type === "webViewer") {
    return {
      type: "webViewer",
      path: buffer.path,
      name: buffer.name,
      isPinned: buffer.isPinned,
      url: buffer.url,
      zoomLevel: buffer.zoomLevel,
      profileKey: buffer.profileKey,
      history: buffer.history,
      historyIndex: buffer.historyIndex,
    };
  }

  return null;
};

const restoreEditorSessionStateForPath = (
  bufferSession: BufferSession | WorkspaceSessionBuffer,
  workspaceId?: string,
) => {
  if (bufferSession.type !== "editor" || !bufferSession.editorState) {
    return;
  }

  const bufferState = workspaceId
    ? useBufferStore.getStore(workspaceId).getState()
    : useBufferStore.getState();
  const openedBuffer = getBufferByPath(bufferState.buffers, bufferSession.path);

  if (openedBuffer?.type === "editor") {
    restorePersistedEditorViewState(openedBuffer, bufferSession.editorState);
  }
};

const reconnectRemoteConnection = async (connectionId: string) => {
  const connection = await connectionStore.getConnection(connectionId);
  if (!connection) {
    throw new Error("Remote connection not found.");
  }

  if (connection.isConnected) {
    return connection;
  }

  await invoke("ssh_connect", {
    connectionId: connection.id,
    host: connection.host,
    port: connection.port,
    username: connection.username,
    password: connection.password || null,
    keyPath: connection.keyPath || null,
    useSftp: connection.type === "sftp",
  });

  await connectionStore.updateConnectionStatus(connection.id, true, new Date().toISOString());
  return connection;
};

type FileSystemStoreState = FsState & FsActions;
type FileSystemGet = () => FileSystemStoreState;

interface OpenLocalWorkspaceOptions {
  workspaceId: string;
  path: string;
  traceLabel: "handleOpenFolder" | "handleOpenFolderByPath";
  treeState: "expand-root" | "collapse-all";
  restoreUiState: boolean;
}

interface WorkspaceInitializationActions {
  initializeLocalWorkspace: (options: OpenLocalWorkspaceOptions) => Promise<boolean>;
  initializeRemoteWorkspace: (connectionId: string) => Promise<boolean>;
  initializeWslWorkspace: (distro: string, linuxPath: string) => Promise<boolean>;
}

type ScopedFileSystemStoreState = FileSystemStoreState & WorkspaceInitializationActions;
type ScopedFileSystemSet = (updater: (state: ScopedFileSystemStoreState) => void) => void;
type ScopedFileSystemGet = () => ScopedFileSystemStoreState;

let scopedFileSystemStore: WorkspaceScopedStore<ScopedFileSystemStoreState>;
const getScopedFileSystemStore = (workspaceId: string) =>
  scopedFileSystemStore.getStore(workspaceId);

const initializeLocalWorkspaceInBackground = (
  workspaceId: string,
  path: string,
  get: FileSystemGet,
  errorContext: string,
) => {
  const gitStore = useGitStore.getStore(workspaceId);
  gitStore.getState().actions.setWorkspaceGitStatus(null, path);

  void (async () => {
    const backgroundInitStartedAt = performance.now();
    logWorkspaceOpenStep("start", "backgroundInit", path);
    try {
      const watcherStartedAt = performance.now();
      logWorkspaceOpenStep("start", "setProjectRoot", path);
      await useFileWatcherStore.getStore(workspaceId).getState().setProjectRoot(path);
      logWorkspaceOpenStep("end", "setProjectRoot", path, watcherStartedAt);

      if (workspaceRuntimeRegistry.getActiveWorkspaceId() === workspaceId) {
        void syncFffWorkspace(get);
      }

      const gitStatusStartedAt = performance.now();
      logWorkspaceOpenStep("start", "getGitStatus", path);
      const gitStatus = await getGitStatus(path);
      logWorkspaceOpenStep("end", "getGitStatus", path, gitStatusStartedAt);

      if (get().rootFolderPath !== path) {
        return;
      }

      gitStore.getState().actions.setWorkspaceGitStatus(gitStatus, path);
      logWorkspaceOpenStep("end", "backgroundInit", path, backgroundInitStartedAt);
    } catch (error) {
      if (get().rootFolderPath === path) {
        gitStore.getState().actions.setWorkspaceGitStatus(null, path);
      }
      logWorkspaceOpenStep("error", "backgroundInit", path, backgroundInitStartedAt);
      console.error(errorContext, error);
    }
  })();
};

const openLocalWorkspace = async (
  options: OpenLocalWorkspaceOptions,
  set: ScopedFileSystemSet,
  get: ScopedFileSystemGet,
) => {
  const { workspaceId, path, traceLabel, treeState, restoreUiState } = options;
  const openStartedAt = performance.now();
  logWorkspaceOpenStep("start", traceLabel, path);
  const currentRootPath = get().rootFolderPath;
  const isReplacingCurrentWorkspace = !!currentRootPath && currentRootPath !== path;
  const currentBufferIds = isReplacingCurrentWorkspace
    ? useBufferStore.getState().buffers.map((buffer) => buffer.id)
    : [];

  try {
    if (isReplacingCurrentWorkspace) {
      const currentBuffers = [...useBufferStore.getState().buffers];
      if (
        !(await prepareProjectTransitionWithUnsavedBuffers("switching projects", currentBuffers))
      ) {
        logWorkspaceOpenStep("end", traceLabel, path, openStartedAt);
        return false;
      }

      get().persistActiveProjectSession();
      if (currentBufferIds.length > 0) {
        useBufferStore.getState().actions.closeBuffersBatch(currentBufferIds, true);
      }
    } else {
      persistCurrentProjectUiState(currentRootPath);
    }

    set((state) => {
      state.isFileTreeLoading = true;
    });

    const projectName = getFolderName(path);

    const readDirectoryStartedAt = performance.now();
    logWorkspaceOpenStep("start", "readDirectoryContents", path);
    const entries = await readDirectoryContents(path);
    logWorkspaceOpenStep("end", "readDirectoryContents", path, readDirectoryStartedAt);

    const fileTree = sortFileEntries(entries);
    const wrappedFileTree = wrapWithRootFolder(fileTree, path, projectName);

    if (treeState === "expand-root") {
      useFileTreeStore.getState().setExpandedPaths(new Set([path]));
    } else {
      useFileTreeStore.getState().collapseAll();
    }

    const { setRootFolderPath, setProjectName, setActiveProjectId } = useProjectStore.getState();
    setRootFolderPath(path);
    setProjectName(projectName);

    if (restoreUiState) {
      restoreProjectUiState(path);
    }

    const activeProjectTab = useWorkspaceTabsStore.getState().getActiveProjectTab();
    setActiveProjectId(activeProjectTab?.id);
    useRecentFoldersStore.getState().addToRecents(path, {
      activeProjectTabId: activeProjectTab?.id,
      customIcon: activeProjectTab?.customIcon,
      missing: false,
    });
    gitDiffCache.clear();

    set((state) => {
      state.isFileTreeLoading = false;
      state.files = wrappedFileTree;
      state.rootFolderPath = path;
      state.workspaceFolders = [{ path, name: projectName, isPrimary: true }];
      state.filesVersion++;
      state.projectFilesCache = undefined;
    });
  } catch (error) {
    set((state) => {
      state.isFileTreeLoading = false;
    });
    logWorkspaceOpenStep("error", traceLabel, path, openStartedAt);
    console.error(`Failed to open folder: ${path}`, error);
    toast.error(`Failed to open folder: ${path}`);
    return false;
  }

  try {
    const restoreStartedAt = performance.now();
    logWorkspaceOpenStep("start", "restoreSession", path);
    await get().restoreSession(path);
    logWorkspaceOpenStep("end", "restoreSession", path, restoreStartedAt);
  } catch (error) {
    logWorkspaceOpenStep("error", "restoreSession", path);
    console.error("Failed to restore workspace session:", error);
    toast.warning("Workspace opened, but saved tabs could not be restored.");
  }

  initializeLocalWorkspaceInBackground(
    workspaceId,
    path,
    get,
    traceLabel === "handleOpenFolder"
      ? "Failed to initialize workspace after opening folder:"
      : "Failed to initialize workspace after opening folder by path:",
  );

  logWorkspaceOpenStep("end", traceLabel, path, openStartedAt);
  return true;
};

const initializeRemoteWorkspaceSession = async (remotePath: string, get: FileSystemGet) => {
  await useFileWatcherStore.getState().setProjectRoot("");
  useGitStore.getState().actions.setWorkspaceGitStatus(null, null);

  try {
    const restoreStartedAt = performance.now();
    logWorkspaceOpenStep("start", "remoteWorkspace:restoreSession", remotePath);
    await get().restoreSession(remotePath);
    logWorkspaceOpenStep("end", "remoteWorkspace:restoreSession", remotePath, restoreStartedAt);
  } catch (error) {
    logWorkspaceOpenStep("error", "remoteWorkspace:restoreSession", remotePath);
    console.error("Failed to restore remote workspace session:", error);
    toast.warning("Remote workspace opened, but saved tabs could not be restored.");
    frontendTrace("warn", "workspace-open", "remoteWorkspace:restoreSession:error", {
      path: remotePath,
      error: getErrorMessage(error),
    });
  }
};

const initializeWslWorkspaceSession = async (wslPath: string, get: FileSystemGet) => {
  await useFileWatcherStore.getState().setProjectRoot("");
  useGitStore.getState().actions.setWorkspaceGitStatus(null, null);

  try {
    const restoreStartedAt = performance.now();
    logWorkspaceOpenStep("start", "wslWorkspace:restoreSession", wslPath);
    await get().restoreSession(wslPath);
    logWorkspaceOpenStep("end", "wslWorkspace:restoreSession", wslPath, restoreStartedAt);
  } catch (error) {
    logWorkspaceOpenStep("error", "wslWorkspace:restoreSession", wslPath);
    console.error("Failed to restore WSL workspace session:", error);
    toast.warning("WSL workspace opened, but saved tabs could not be restored.");
    frontendTrace("warn", "workspace-open", "wslWorkspace:restoreSession:error", {
      path: wslPath,
      error: getErrorMessage(error),
    });
  }
};

const createFileSystemStore = (): StoreApi<ScopedFileSystemStoreState> =>
  createStore<ScopedFileSystemStoreState>()(
    immer((set, get) => ({
      // State
      files: [],
      rootFolderPath: undefined,
      workspaceFolders: [],
      filesVersion: 0,
      isFileTreeLoading: false,
      isSwitchingProject: false,
      projectFilesCache: undefined,

      // Actions
      handleOpenFolder: async (): Promise<boolean> => {
        const selected = await openFolder();
        if (!selected) return false;

        const { settings } = useSettingsStore.getState();
        const hasOpenWorkspace =
          !!get().rootFolderPath || useWorkspaceTabsStore.getState().projectTabs.length > 0;

        if (settings.openFoldersInNewWindow && hasOpenWorkspace) {
          await createAppWindow({
            path: selected,
            isDirectory: true,
          });
          return true;
        }

        const { openWorkspaceRuntime } =
          await import("@/features/workspace/services/workspace-lifecycle");
        return await openWorkspaceRuntime({
          descriptor: { path: selected, name: getFolderName(selected) },
          persistCurrent: () => get().persistActiveProjectSession(),
          initialize: (workspaceId): Promise<boolean> =>
            getScopedFileSystemStore(workspaceId).getState().initializeLocalWorkspace({
              workspaceId,
              path: selected,
              traceLabel: "handleOpenFolder",
              treeState: "expand-root",
              restoreUiState: false,
            }),
          resume: async (workspaceId) => {
            await useFileWatcherStore.getStore(workspaceId).getState().setProjectRoot(selected);
            void syncFffWorkspace(get);
          },
        });
      },

      initializeLocalWorkspace: (options: OpenLocalWorkspaceOptions) =>
        openLocalWorkspace(options, set, get),

      resetWorkspace: async () => {
        // Reset all project-related state to return to welcome screen
        set((state) => {
          state.files = [];
          state.isFileTreeLoading = false;
          state.filesVersion++;
          state.rootFolderPath = undefined;
          state.workspaceFolders = [];
          state.projectFilesCache = undefined;
        });

        // Clear tree UI state
        useFileTreeStore.getState().collapseAll();

        // Reset project store
        const { setRootFolderPath, setProjectName } = useProjectStore.getState();
        setRootFolderPath("");
        setProjectName("");

        // Close all buffers
        const { buffers, actions: bufferActions } = useBufferStore.getState();
        buffers.forEach((buffer) => bufferActions.closeBuffer(buffer.id));

        // Stop file watching
        await useFileWatcherStore.getState().setProjectRoot("");

        // Reset git store completely
        const { actions: gitActions } = useGitStore.getState();
        gitActions.reset();

        // Clear git diff cache
        gitDiffCache.clear();

        // Clear git blame data
        useGitBlameStore.getState().actions.clearAllBlame();
      },

      restoreSession: async (projectPath: string, skipBufferPath?: string) => {
        const workspaceId = workspaceRuntimeRegistry.getActiveWorkspaceId();
        const { session, terminals } = workspaceSessionRepository.load(projectPath);
        if (session?.workspaceFolders && session.workspaceFolders.length > 1) {
          const foldersToRestore = normalizeWorkspaceFolders(projectPath, session.workspaceFolders);
          const currentRootPaths = new Set(
            get()
              .files.filter((file) => file.isDir)
              .map((file) => file.path),
          );
          const restoredRootEntries = (
            await Promise.all(
              foldersToRestore.map(async (folder) => {
                if (folder.path === projectPath || currentRootPaths.has(folder.path)) {
                  return null;
                }

                try {
                  return await readWorkspaceRootEntry(folder.path);
                } catch (error) {
                  console.warn("Failed to restore workspace folder:", folder.path, error);
                  toast.warning(`Could not restore workspace folder "${folder.name}".`);
                  return null;
                }
              }),
            )
          ).filter((entry): entry is FileEntry => entry !== null);

          if (restoredRootEntries.length > 0) {
            set((state) => {
              state.files = [...state.files, ...restoredRootEntries];
              state.workspaceFolders = foldersToRestore;
              state.filesVersion++;
              state.projectFilesCache = undefined;
            });
          } else {
            set((state) => {
              state.workspaceFolders = foldersToRestore;
            });
          }
          void syncFffWorkspace(get);
        }

        useTerminalTabsStore.getStore(workspaceId).getState().dispatch({
          type: "RESTORE_TERMINALS",
          payload: { terminals },
        });

        if (session) {
          const bufferStore = useBufferStore.getStore(workspaceId);
          const { actions: bufferActions } = bufferStore.getState();
          const restorePlan = buildWorkspaceRestorePlan(session);

          const candidateBuffersToRestore = [
            restorePlan.initialBuffer,
            ...restorePlan.remainingBuffers,
          ].filter(
            (buffer): buffer is NonNullable<typeof buffer> =>
              !!buffer && buffer.path !== skipBufferPath,
          );

          const { buffersToRestore, deferredBuffers } = buildWorkspaceRestoreBatch(
            candidateBuffersToRestore,
            MAX_SESSION_BUFFERS_TO_RESTORE,
          );

          const restoreBuffers = async (buffers: typeof buffersToRestore) => {
            for (const buffer of buffers) {
              if (buffer.type === "terminal") {
                const restoredBufferId = bufferActions.openContent({
                  type: "terminal",
                  name: buffer.name,
                  command: buffer.initialCommand,
                  workingDirectory: buffer.workingDirectory,
                  remoteConnectionId: buffer.remoteConnectionId,
                  sessionId: buffer.sessionId,
                  path: buffer.path,
                });

                if (buffer.isPinned) {
                  bufferActions.handleTabPin(restoredBufferId);
                }

                continue;
              }

              if (buffer.type === "webViewer") {
                const restoredBufferId = bufferActions.openContent({
                  type: "webViewer",
                  url: buffer.url ?? "about:blank",
                  zoomLevel: buffer.zoomLevel,
                  profileKey: buffer.profileKey,
                  history: buffer.history,
                  historyIndex: buffer.historyIndex,
                });

                if (buffer.isPinned) {
                  bufferActions.handleTabPin(restoredBufferId);
                }

                continue;
              }

              frontendTrace("info", "workspace-open", "restoreSession:buffer:start", {
                projectPath,
                bufferPath: buffer.path,
              });
              // Use handleFileSelect to open the file (it handles reading content)
              await get().handleFileSelect(
                buffer.path,
                false,
                undefined,
                undefined,
                undefined,
                buffer.isPreview,
              );
              restoreEditorSessionStateForPath(buffer, workspaceId);
              frontendTrace("info", "workspace-open", "restoreSession:buffer:end", {
                projectPath,
                bufferPath: buffer.path,
              });

              // If it was pinned, we might need to handle that, but handleFileSelect doesn't support pinning arg.
              // We can pin it after opening if needed.
              if (buffer.isPinned) {
                const newBuffers = bufferStore.getState().buffers;
                const openedBuffer = getBufferByPath(newBuffers, buffer.path);
                if (openedBuffer) {
                  bufferActions.handleTabPin(openedBuffer.id);
                }
              }
            }
          };

          await restoreBuffers(buffersToRestore);

          // Restore active buffer
          if (restorePlan.activeBufferPath) {
            const { buffers } = bufferStore.getState();
            const activeBuffer = getBufferByPath(buffers, restorePlan.activeBufferPath);
            if (activeBuffer) {
              bufferStore.getState().actions.setActiveBuffer(activeBuffer.id);
            }
          }

          if (deferredBuffers.length > 0) {
            console.info("[workspace-open] restoreSession:deferred", {
              projectPath,
              totalBuffers: candidateBuffersToRestore.length,
              restoredBuffers: buffersToRestore.length,
              deferredBuffers: deferredBuffers.length,
            });
            frontendTrace("info", "workspace-open", "restoreSession:deferred", {
              projectPath,
              totalBuffers: candidateBuffersToRestore.length,
              restoredBuffers: buffersToRestore.length,
              deferredBuffers: deferredBuffers.length,
            });

            window.setTimeout(() => {
              void (async () => {
                if (
                  get().rootFolderPath !== projectPath ||
                  workspaceRuntimeRegistry.getActiveWorkspaceId() !== workspaceId
                ) {
                  return;
                }

                await restoreBuffers(deferredBuffers);
                restoreProjectPaneState(projectPath, workspaceId);
                frontendTrace("info", "workspace-open", "restoreSession:deferred:end", {
                  projectPath,
                  restoredBuffers: deferredBuffers.length,
                });
              })().catch((error) => {
                console.warn("[workspace-open] failed to restore deferred saved tabs", error);
                frontendTrace("warn", "workspace-open", "restoreSession:deferred:error", {
                  projectPath,
                  error: getErrorMessage(error),
                });
              });
            }, 250);
          }
        }

        restoreProjectPaneState(projectPath, workspaceId);

        useAIChatStore
          .getState()
          .restoreWorkspaceSession(
            session?.aiSession,
            useBufferStore.getStore(workspaceId).getState().buffers,
          );
      },

      persistActiveProjectSession: () => {
        const currentRootPath = get().rootFolderPath;
        if (!currentRootPath) {
          return;
        }

        persistCurrentProjectUiState(currentRootPath);

        const { buffers, activeBufferId } = useBufferStore.getState();
        const activeBuffer = getBufferById(buffers, activeBufferId);
        const workspaceFolders = normalizeWorkspaceFolders(currentRootPath, get().workspaceFolders);
        const workspaceFolderPaths = workspaceFolders.map((folder) => folder.path);

        clearQueuedWorkspaceSessionSave(currentRootPath);
        workspaceSessionRepository.save({
          projectPath: currentRootPath,
          buffers: buffers
            .map((buffer) =>
              serializeWorkspaceBuffer(buffer, currentRootPath, workspaceFolderPaths),
            )
            .filter((buffer): buffer is BufferSession => buffer !== null),
          activeBufferPath: activeBuffer?.path || null,
          terminals: serializeTerminals(useTerminalTabsStore.getState().terminals),
          aiSession: readPersistedAiWorkspaceSession(),
          workspaceFolders,
        });
      },

      closeFolder: async () => {
        // Find the active project tab
        const activeTab = useWorkspaceTabsStore.getState().getActiveProjectTab();

        if (activeTab) {
          // If we have an active tab, close it properly via closeProject
          // This will handle removing the tab and if it's the last one, it will clear the file system
          return await get().closeProject(activeTab.id);
        }

        // Fallback: Reset all project-related state to return to welcome screen
        await get().resetWorkspace();

        return true;
      },

      handleOpenFolderByPath: async (path: string) => {
        const wslInfo = parseWslPath(path);
        if (wslInfo) {
          return await get().handleOpenWslProject(wslInfo.distro, wslInfo.linuxPath);
        }

        const { openWorkspaceRuntime } =
          await import("@/features/workspace/services/workspace-lifecycle");
        return await openWorkspaceRuntime({
          descriptor: { path, name: getFolderName(path) },
          persistCurrent: () => get().persistActiveProjectSession(),
          initialize: (workspaceId) =>
            getScopedFileSystemStore(workspaceId).getState().initializeLocalWorkspace({
              workspaceId,
              path,
              traceLabel: "handleOpenFolderByPath",
              treeState: "collapse-all",
              restoreUiState: true,
            }),
          resume: async (workspaceId) => {
            await useFileWatcherStore.getStore(workspaceId).getState().setProjectRoot(path);
            void syncFffWorkspace(get);
          },
        });
      },

      addFolderToWorkspace: async (path?: string) => {
        const selectedPath = path ?? (await openFolder());
        if (!selectedPath) return false;

        const rootFolderPath = get().rootFolderPath;
        if (!rootFolderPath) {
          return await get().handleOpenFolderByPath(selectedPath);
        }

        if (selectedPath.startsWith("remote://") || selectedPath.startsWith("wsl://")) {
          toast.warning("Add Folder to Workspace is only available for local folders.");
          return false;
        }

        const workspaceFolders = normalizeWorkspaceFolders(rootFolderPath, get().workspaceFolders);
        if (isWorkspaceFolderPath(selectedPath, rootFolderPath, workspaceFolders)) {
          toast.info("Folder is already in this workspace.");
          return true;
        }

        set((state) => {
          state.isFileTreeLoading = true;
        });

        try {
          const rootEntry = await readWorkspaceRootEntry(selectedPath);
          const nextFolders = normalizeWorkspaceFolders(rootFolderPath, [
            ...workspaceFolders,
            { path: selectedPath, name: rootEntry.name },
          ]);

          set((state) => {
            state.files = [...state.files, rootEntry];
            state.workspaceFolders = nextFolders;
            state.filesVersion++;
            state.isFileTreeLoading = false;
            state.projectFilesCache = undefined;
          });
          void syncFffWorkspace(get);

          const expandedPaths = new Set(useFileTreeStore.getState().getExpandedPaths());
          expandedPaths.add(selectedPath);
          useFileTreeStore.getState().setExpandedPaths(expandedPaths);
          useRecentFoldersStore.getState().addToRecents(selectedPath, {
            missing: false,
          });
          get().persistActiveProjectSession();
          toast.success(`Added "${rootEntry.name}" to workspace.`);
          return true;
        } catch (error) {
          console.error("Failed to add folder to workspace:", error);
          toast.error(`Failed to add folder to workspace: ${selectedPath}`);
          set((state) => {
            state.isFileTreeLoading = false;
          });
          return false;
        }
      },

      removeFolderFromWorkspace: async (path: string) => {
        const rootFolderPath = get().rootFolderPath;
        if (!rootFolderPath) {
          return false;
        }

        const workspaceFolders = normalizeWorkspaceFolders(rootFolderPath, get().workspaceFolders);
        const folder = workspaceFolders.find((workspaceFolder) =>
          isWorkspaceFolderPath(path, workspaceFolder.path, [workspaceFolder]),
        );

        if (!folder) {
          return false;
        }

        if (folder.isPrimary || folder.path === rootFolderPath) {
          toast.warning("Primary workspace folder cannot be removed.");
          return false;
        }

        set((state) => {
          state.files = state.files.filter((file) => file.path !== folder.path);
          state.workspaceFolders = workspaceFolders.filter(
            (workspaceFolder) => workspaceFolder.path !== folder.path,
          );
          state.filesVersion++;
          state.projectFilesCache = undefined;
        });
        void syncFffWorkspace(get);

        useFileTreeStore.getState().collapsePath(folder.path);
        get().persistActiveProjectSession();
        toast.success(`Removed "${folder.name}" from workspace.`);
        return true;
      },

      handleOpenRemoteProject: async (connectionId: string, connectionName: string) => {
        const path = buildRemoteRootPath(connectionId);
        const { openWorkspaceRuntime } =
          await import("@/features/workspace/services/workspace-lifecycle");
        return await openWorkspaceRuntime({
          descriptor: { path, name: connectionName },
          persistCurrent: () => get().persistActiveProjectSession(),
          initialize: (workspaceId) =>
            getScopedFileSystemStore(workspaceId)
              .getState()
              .initializeRemoteWorkspace(connectionId),
          resume: async (workspaceId) => {
            await useFileWatcherStore.getStore(workspaceId).getState().setProjectRoot("");
          },
        });
      },

      initializeRemoteWorkspace: async (connectionId: string) => {
        persistCurrentProjectUiState(get().rootFolderPath);

        set((state) => {
          state.isFileTreeLoading = true;
        });

        try {
          const connection = await reconnectRemoteConnection(connectionId);

          // Read remote root directory
          const entries = await invoke<RemoteDirectoryEntry[]>("ssh_read_directory", {
            connectionId,
            path: "/",
          });

          const { remotePath, wrappedFileTree } = buildRemoteWorkspaceTree(
            connectionId,
            connection.name,
            entries,
          );

          // Add project to workspace tabs
          useWorkspaceTabsStore.getState().addProjectTab(remotePath, connection.name);
          const activeProjectTab = useWorkspaceTabsStore.getState().getActiveProjectTab();

          // Initialize tree UI state: expand remote root
          useFileTreeStore.getState().setExpandedPaths(new Set([remotePath]));

          // Update project store
          const { setRootFolderPath, setProjectName, setActiveProjectId } =
            useProjectStore.getState();
          setRootFolderPath(remotePath);
          setProjectName(connection.name);
          setActiveProjectId(activeProjectTab?.id);
          restoreProjectUiState(remotePath);

          set((state) => {
            state.isFileTreeLoading = false;
            state.files = wrappedFileTree;
            state.rootFolderPath = remotePath;
            state.workspaceFolders = [{ path: remotePath, name: connection.name, isPrimary: true }];
            state.filesVersion++;
            state.projectFilesCache = undefined;
          });

          await initializeRemoteWorkspaceSession(remotePath, get);

          return true;
        } catch (error) {
          console.error("Failed to open remote project:", error);
          toast.error(error instanceof Error ? error.message : "Failed to open remote project.");
          set((state) => {
            state.isFileTreeLoading = false;
          });
          return false;
        }
      },

      handleOpenWslProject: async (distro: string, linuxPath: string) => {
        const normalizedLinuxPath = linuxPath || "/";
        const path = buildWslPath(distro, normalizedLinuxPath);
        const name = getWslProjectName(distro, normalizedLinuxPath);
        const { openWorkspaceRuntime } =
          await import("@/features/workspace/services/workspace-lifecycle");
        return await openWorkspaceRuntime({
          descriptor: { path, name },
          persistCurrent: () => get().persistActiveProjectSession(),
          initialize: (workspaceId) =>
            getScopedFileSystemStore(workspaceId)
              .getState()
              .initializeWslWorkspace(distro, normalizedLinuxPath),
          resume: async (workspaceId) => {
            await useFileWatcherStore.getStore(workspaceId).getState().setProjectRoot("");
          },
        });
      },

      initializeWslWorkspace: async (distro: string, linuxPath: string) => {
        persistCurrentProjectUiState(get().rootFolderPath);

        set((state) => {
          state.isFileTreeLoading = true;
        });

        try {
          const normalizedLinuxPath = linuxPath || "/";
          const entries = await invoke<WslDirectoryEntry[]>("wsl_read_directory", {
            distro,
            path: normalizedLinuxPath,
          });
          const { wslPath, wrappedFileTree } = buildWslWorkspaceTree(
            distro,
            normalizedLinuxPath,
            entries,
          );
          const projectName = getWslProjectName(distro, normalizedLinuxPath);

          useWorkspaceTabsStore.getState().addProjectTab(wslPath, projectName);
          const activeProjectTab = useWorkspaceTabsStore.getState().getActiveProjectTab();
          useFileTreeStore.getState().setExpandedPaths(new Set([wslPath]));

          const { setRootFolderPath, setProjectName, setActiveProjectId } =
            useProjectStore.getState();
          setRootFolderPath(wslPath);
          setProjectName(projectName);
          setActiveProjectId(activeProjectTab?.id);
          restoreProjectUiState(wslPath);

          set((state) => {
            state.isFileTreeLoading = false;
            state.files = wrappedFileTree;
            state.rootFolderPath = wslPath;
            state.workspaceFolders = [{ path: wslPath, name: projectName, isPrimary: true }];
            state.filesVersion++;
            state.projectFilesCache = undefined;
          });

          useRecentFoldersStore.getState().addToRecents(wslPath, {
            activeProjectTabId: activeProjectTab?.id,
            missing: false,
          });

          await initializeWslWorkspaceSession(wslPath, get);

          return true;
        } catch (error) {
          console.error("Failed to open WSL project:", error);
          toast.error(error instanceof Error ? error.message : "Failed to open WSL project.");
          set((state) => {
            state.isFileTreeLoading = false;
          });
          return false;
        }
      },

      handleFileSelect: async (
        path: string,
        isDir: boolean,
        line?: number,
        column?: number,
        codeEditorRef?: React.RefObject<CodeEditorRef | null>,
        isPreview = false,
      ) => {
        if (isDir) {
          await get().toggleFolder(path);
          return;
        }

        const selectedWslInfo = parseWslPath(path);

        if (!isPreview && !selectedWslInfo) {
          fffTrackAccess(path).catch((error) => {
            console.error("[fff] track_access failed:", error);
          });
        }

        fileOpenBenchmark.ensureStarted(path, isPreview ? "preview" : "definite");
        fileOpenBenchmark.mark(path, "file-select-handler");

        const {
          buffers,
          activeBufferId,
          actions: { convertPreviewToDefinite, setActiveBuffer },
        } = useBufferStore.getState();
        const workspaceRootPath = get().rootFolderPath;
        const fileName = getFilenameFromPath(path);
        const existingBuffer = getBufferByPath(buffers, path);
        if (existingBuffer) {
          const wasAlreadyActive = existingBuffer.id === activeBufferId;
          setActiveBuffer(existingBuffer.id);
          recordLocalFileAccess(path, fileName, workspaceRootPath, getWorkspaceFolderPaths(get));

          if (existingBuffer.isPreview && !isPreview) {
            convertPreviewToDefinite(existingBuffer.id);
          }
          if (wasAlreadyActive || existingBuffer.type !== "editor") {
            fileOpenBenchmark.finish(path, "existing-buffer");
          } else {
            fileOpenBenchmark.mark(path, "existing-buffer-activated");
          }

          if (line) {
            setTimeout(() => {
              window.dispatchEvent(
                new CustomEvent("menu-go-to-line", {
                  detail: { line, column, path },
                }),
              );
            }, 0);
          }

          return;
        }

        const requestId = ++latestFileOpenRequestId;
        const isStaleRequest = () => {
          const stale = requestId !== latestFileOpenRequestId;
          if (stale) {
            fileOpenBenchmark.cancel(path, "stale-request");
          }
          return stale;
        };

        let resolvedPath = path;

        const isKnownTextPath = isKnownTextFile(path);
        const selectedFileEntry = findFileInTree(get().files, path);
        const shouldResolveSymlink =
          selectedFileEntry?.isSymlink === true &&
          !path.startsWith("diff://") &&
          !path.startsWith("remote://");
        if (shouldResolveSymlink) {
          try {
            const workspaceRoot = get().rootFolderPath;
            const symlinkInfo = selectedFileEntry.symlinkTarget
              ? { is_symlink: true, target: selectedFileEntry.symlinkTarget }
              : await getSymlinkInfo(path, workspaceRoot);

            if (symlinkInfo.is_symlink && symlinkInfo.target) {
              const wslTargetPath = resolveWslTargetPath(path, symlinkInfo.target);
              if (wslTargetPath) {
                resolvedPath = wslTargetPath;
              } else {
                const pathSeparator = path.includes("\\") ? "\\" : "/";
                const pathParts = path.split(pathSeparator);
                pathParts.pop();
                const parentDir = pathParts.join(pathSeparator);

                if (
                  symlinkInfo.target.startsWith(pathSeparator) ||
                  symlinkInfo.target.match(/^[a-zA-Z]:/)
                ) {
                  resolvedPath = symlinkInfo.target;
                } else {
                  resolvedPath = workspaceRoot
                    ? `${workspaceRoot}${pathSeparator}${symlinkInfo.target}`
                    : `${parentDir}${pathSeparator}${symlinkInfo.target}`;
                }
              }
            }
          } catch (error) {
            console.error("Failed to resolve symlink:", error);
          }
        }
        fileOpenBenchmark.mark(path, shouldResolveSymlink ? "symlink-resolved" : "symlink-skipped");

        if (isStaleRequest()) return;
        const { openBuffer } = useBufferStore.getState().actions;

        // Handle virtual diff files
        if (path.startsWith("diff://")) {
          if (isStaleRequest()) return;

          const match = path.match(/^diff:\/\/(staged|unstaged)\/(.+)$/);
          let displayName = getFilenameFromPath(path);
          if (match) {
            const [, diffType, encodedPath] = match;
            const decodedPath = decodeURIComponent(encodedPath);
            displayName = `${getFilenameFromPath(decodedPath)} (${diffType})`;
          }

          const diffContent = localStorage.getItem(`diff-content-${path}`);
          if (diffContent) {
            openBuffer(path, displayName, diffContent, false, undefined, true, true);
          } else {
            openBuffer(
              path,
              displayName,
              "No diff content available",
              false,
              undefined,
              true,
              true,
            );
          }
          fileOpenBenchmark.finish(path, "diff-buffer-opened");
          return;
        }

        // Handle special file types
        const dbType = getDatabaseTypeFromPath(resolvedPath);
        if (dbType) {
          if (isStaleRequest()) return;
          openBuffer(path, fileName, "", false, dbType, false, false);
          fileOpenBenchmark.finish(path, "database-buffer-opened");
        } else if (isImageFile(resolvedPath)) {
          if (isStaleRequest()) return;
          openBuffer(path, fileName, "", true, undefined, false, false);
          fileOpenBenchmark.finish(path, "image-buffer-opened");
        } else if (isPdfFile(resolvedPath)) {
          if (isStaleRequest()) return;
          openBuffer(
            path,
            fileName,
            "",
            false,
            undefined,
            false,
            false,
            undefined,
            false,
            false,
            false,
            undefined,
            isPreview,
            true,
          );
          fileOpenBenchmark.finish(path, "pdf-buffer-opened");
        } else if (isBinaryFile(resolvedPath)) {
          if (isStaleRequest()) return;
          openBuffer(
            path,
            fileName,
            "",
            false,
            undefined,
            false,
            false,
            undefined,
            false,
            false,
            false,
            undefined,
            false,
            false,
            true,
          );
          fileOpenBenchmark.finish(path, "binary-buffer-opened");
        } else {
          let preloadedLocalText: string | null = null;

          const wslInfo = parseWslPath(path);

          const resolvedKnownTextPath =
            resolvedPath === path ? isKnownTextPath : isKnownTextFile(resolvedPath);

          if (!path.startsWith("remote://") && !wslInfo && !resolvedKnownTextPath) {
            try {
              const fileData = await readFileOnce(`local-bytes:${resolvedPath}`, () =>
                readFile(resolvedPath),
              );

              if (isStaleRequest()) return;

              if (isBinaryContent(fileData)) {
                openBuffer(
                  path,
                  fileName,
                  "",
                  false,
                  undefined,
                  false,
                  false,
                  undefined,
                  false,
                  false,
                  false,
                  undefined,
                  false,
                  false,
                  true,
                );
                recordLocalFileAccess(
                  path,
                  fileName,
                  workspaceRootPath,
                  getWorkspaceFolderPaths(get),
                );
                fileOpenBenchmark.finish(path, "binary-sniff-buffer-opened");
                return;
              }

              preloadedLocalText = textFileDecoder.decode(fileData);
            } catch (error) {
              console.error("Failed to inspect file bytes before opening:", error);
            }
          } else if (wslInfo && !resolvedKnownTextPath) {
            try {
              const fileData = await readFileOnce(
                `wsl-bytes:${wslInfo.distro}:${wslInfo.linuxPath}`,
                () =>
                  invoke<number[]>("wsl_read_file_bytes", {
                    distro: wslInfo.distro,
                    filePath: wslInfo.linuxPath,
                  }),
              );

              if (isStaleRequest()) return;

              const bytes = new Uint8Array(fileData);
              if (isBinaryContent(bytes)) {
                openBuffer(
                  path,
                  fileName,
                  "",
                  false,
                  undefined,
                  false,
                  false,
                  undefined,
                  false,
                  false,
                  false,
                  undefined,
                  false,
                  false,
                  true,
                );
                fileOpenBenchmark.finish(path, "binary-sniff-buffer-opened");
                return;
              }

              preloadedLocalText = textFileDecoder.decode(bytes);
            } catch (error) {
              console.error("Failed to inspect WSL file bytes before opening:", error);
            }
          }

          // Check if external editor is enabled for text files
          const { settings } = useSettingsStore.getState();
          const { openExternalEditorBuffer } = useBufferStore.getState().actions;
          const hasExternalEditorCommand =
            settings.externalEditor !== "custom" || settings.customEditorCommand.trim().length > 0;

          if (settings.externalEditor !== "none" && hasExternalEditorCommand && !wslInfo) {
            if (isStaleRequest()) return;
            try {
              const { rootFolderPath } = get();
              const events = createTerminalEventChannel();
              // Create terminal connection for external editor
              const connectionId = await invoke<string>("create_terminal", {
                config: {
                  workingDirectory: rootFolderPath || undefined,
                  size: { rows: 24, cols: 80, pixelWidth: 0, pixelHeight: 0 },
                },
                onEvent: events.channel,
              });
              events.bind(connectionId);

              if (isStaleRequest()) return;

              // Open external editor buffer
              openExternalEditorBuffer(resolvedPath, fileName, connectionId);
              recordLocalFileAccess(
                path,
                fileName,
                workspaceRootPath,
                getWorkspaceFolderPaths(get),
              );
              fileOpenBenchmark.finish(path, "external-editor-buffer-opened");
              return;
            } catch (error) {
              console.error("Failed to create external editor terminal:", error);
            }
          }

          let content: string;

          // Check if this is a remote file
          if (path.startsWith("remote://")) {
            const match = path.match(/^remote:\/\/([^/]+)(\/.*)?$/);
            if (!match) return;

            const connectionId = match[1];
            const remotePath = match[2] || "/";

            content = await readFileOnce(`remote-text:${connectionId}:${remotePath}`, () =>
              invoke<string>("ssh_read_file", {
                connectionId,
                filePath: remotePath,
              }),
            );
          } else if (wslInfo) {
            content =
              preloadedLocalText ??
              (await readFileOnce(`wsl-text:${wslInfo.distro}:${wslInfo.linuxPath}`, () =>
                invoke<string>("wsl_read_file", {
                  distro: wslInfo.distro,
                  filePath: wslInfo.linuxPath,
                }),
              ));
          } else {
            content =
              preloadedLocalText ??
              (await readFileOnce(`local-text:${resolvedPath}`, () =>
                readFileContent(resolvedPath),
              ));
          }
          fileOpenBenchmark.mark(path, "file-read", `${content.length} chars`);

          if (isStaleRequest()) return;

          openBuffer(
            path,
            fileName,
            content,
            false,
            undefined,
            false,
            false,
            undefined,
            undefined,
            false,
            false,
            undefined,
            isPreview,
          );
          fileOpenBenchmark.mark(path, "buffer-opened");

          // Handle navigation to specific line/column
          if (line && column && codeEditorRef?.current?.textarea) {
            requestAnimationFrame(() => {
              if (codeEditorRef.current?.textarea) {
                const textarea = codeEditorRef.current.textarea;
                const targetLine = Math.max(0, (line ?? 1) - 1);
                const targetLineSlice = getLineSlice(content, targetLine);
                const targetPosition =
                  targetLineSlice.offset +
                  (column ? Math.min(column - 1, targetLineSlice.line.length) : 0);

                textarea.focus();
                if (
                  "setSelectionRange" in textarea &&
                  typeof textarea.setSelectionRange === "function"
                ) {
                  (textarea as unknown as HTMLTextAreaElement).setSelectionRange(
                    targetPosition,
                    targetPosition,
                  );
                }

                const lineHeight = 20;
                const scrollTop = line
                  ? Math.max(0, (line - 1) * lineHeight - textarea.clientHeight / 2)
                  : 0;
                textarea.scrollTop = scrollTop;
              }
            });
          }
        }

        recordLocalFileAccess(path, fileName, workspaceRootPath, getWorkspaceFolderPaths(get));

        // Dispatch go-to-line event to center the line in viewport
        if (line) {
          setTimeout(() => {
            window.dispatchEvent(
              new CustomEvent("menu-go-to-line", {
                detail: { line, column, path },
              }),
            );
          }, 100);
        }
      },

      // Open file in definite mode (not preview) - for double-click
      handleFileOpen: async (path: string, isDir: boolean) => {
        await get().handleFileSelect(path, isDir, undefined, undefined, undefined, false);
      },

      toggleFolder: async (path: string) => {
        const folder = findFileInTree(get().files, path);
        if (!folder || !folder.isDir) return;

        const uiStore = useFileTreeStore.getState();
        const isCurrentlyExpanded = uiStore.isExpanded(path);

        if (!isCurrentlyExpanded) {
          // Expand: load children if not present
          if (!folder.children || folder.children.length === 0) {
            const childEntries = await readProviderDirectoryEntries(
              folder.path,
              get().rootFolderPath ?? folder.path,
            );

            const updatedFiles = updateFileInTree(get().files, path, (item) => ({
              ...item,
              children: childEntries,
            }));

            set((state) => {
              state.files = updatedFiles;
              state.filesVersion++;
            });
          }
          uiStore.toggleFolder(path);
          // Preload deeper children in background for snappier navigation
          get()
            .preloadSubtree(path, 2, 80)
            .catch(() => {});
        } else {
          // Collapse: only toggle UI state; keep children cached
          uiStore.toggleFolder(path);
        }
      },

      revealPathInTree: async (targetPath: string) => {
        const { rootFolderPath } = get();
        const ancestorPaths = getAncestorDirectoryPaths(targetPath, rootFolderPath);

        for (const ancestorPath of ancestorPaths) {
          const node = findFileInTree(get().files, ancestorPath);
          if (!node || !node.isDir) continue;
          if (!useFileTreeStore.getState().isExpanded(ancestorPath)) {
            await get().toggleFolder(ancestorPath);
          } else if (!node.children || node.children.length === 0) {
            const childEntries = await readProviderDirectoryEntries(
              ancestorPath,
              get().rootFolderPath ?? ancestorPath,
            );

            set((state) => {
              state.files = updateFileInTree(state.files, ancestorPath, (item) => ({
                ...item,
                children: childEntries,
              }));
              state.filesVersion++;
            });
          }
        }
      },

      // Preload subtree children up to a depth and directory budget
      preloadSubtree: async (rootPath: string, maxDepth = 2, maxDirs = 80) => {
        const visited = new Set<string>();
        type QueueItem = {
          path: string;
          depth: number;
        };
        const q: QueueItem[] = [];

        q.push({
          path: rootPath,
          depth: 0,
        });
        let processed = 0;

        while (q.length && processed < maxDirs) {
          const batch = q.splice(0, 8);
          await Promise.all(
            batch.map(async (item) => {
              if (visited.has(item.path) || item.depth >= maxDepth) return;
              visited.add(item.path);
              processed++;

              try {
                // Skip if children already present
                const node = findFileInTree(get().files, item.path);
                if (!node || !node.isDir) return;
                if (node.children && node.children.length > 0) {
                  // Still enqueue subdirs to continue traversal
                  node.children
                    ?.filter((c) => c.isDir)
                    .forEach((c) =>
                      q.push({
                        path: c.path,
                        depth: item.depth + 1,
                      }),
                    );
                  return;
                }

                const children = await readProviderDirectoryEntries(
                  item.path,
                  get().rootFolderPath ?? item.path,
                );

                set((state) => {
                  state.files = updateFileInTree(state.files, item.path, (it) => ({
                    ...it,
                    children,
                  }));
                  state.filesVersion++;
                });

                // Enqueue subdirs
                children
                  .filter((c) => c.isDir)
                  .forEach((c) =>
                    q.push({
                      path: c.path,
                      depth: item.depth + 1,
                    }),
                  );
              } catch {}
            }),
          );

          // Yield to UI
          await new Promise((r) => setTimeout(r, 0));
        }
      },

      handleCreateNewFile: async () => {
        const { rootFolderPath } = get();
        const { activePath } = useSidebarStore.getState();

        if (!rootFolderPath) {
          const buffers = useBufferStore.getState().buffers;
          const untitledCount = buffers.filter((b) => b.path.startsWith("untitled:")).length;
          const name = untitledCount === 0 ? "Untitled" : `Untitled-${untitledCount + 1}`;
          const path = `untitled:${name}`;
          useBufferStore
            .getState()
            .actions.openBuffer(path, name, "", false, undefined, false, true);
          return;
        }

        let effectiveRootPath = activePath || rootFolderPath;

        // Active path maybe is a file
        if (activePath) {
          try {
            await extname(activePath);
            effectiveRootPath = await dirname(activePath);
          } catch {}
        }

        if (!effectiveRootPath) {
          await showAlertDialog("Unable to determine root folder path", "New File");
          return;
        }

        // Create a temporary new file item for inline editing
        const newItem: FileEntry = {
          name: "",
          path: ensureTrailingPathSeparator(effectiveRootPath),
          isDir: false,
          isEditing: true,
          isNewItem: true,
        };

        // Add the new item to the root level of the file tree
        set((state) => {
          state.files = addFileToTree(state.files, effectiveRootPath, newItem);
          state.filesVersion++;
        });
      },

      handleCreateNewFileInDirectory: async (dirPath: string, fileName?: string) => {
        if (!fileName) {
          fileName =
            (await showPromptDialog("Enter the name for the new file:", {
              title: "New File",
              placeholder: "File name",
            })) ?? undefined;
          if (!fileName) return;
        }
        // Split the input path into parts
        const parts = fileName.split("/").filter(Boolean);
        // Validate input
        if (parts.length === 0) {
          await showAlertDialog("Invalid file name", "New File");
          return;
        }

        const finalFileName = parts.pop()!;

        // Block path traversal and illegal separators
        const hasIllegalCharacters = (segment: string) =>
          segment === ".." || segment === "." || segment.includes("\\") || segment.includes("/");

        // Check all directory parts AND the final filename
        if (parts.some(hasIllegalCharacters) || hasIllegalCharacters(finalFileName)) {
          await showAlertDialog(
            "Invalid file name: path traversal and special characters are not allowed",
            "New File",
          );
          return;
        }

        let currentPath = dirPath;
        // Create intermediate folders if they don't exist
        try {
          for (const folder of parts) {
            const potentialPath = joinPath(currentPath, folder);
            // Check if directory already exists in the file tree
            const existingFolder = findFileInTree(get().files, potentialPath);

            if (existingFolder?.isDir) {
              // Directory already exists, just use its path
              currentPath = potentialPath;
            } else {
              // Create the directory if it doesn't exist
              currentPath = await get().createDirectory(currentPath, folder);
            }
          }
          // Finally create the file inside the deepest folder
          return await get().createFile(currentPath, finalFileName);
        } catch (error) {
          console.error("Failed to create nested file:", error);
          await showAlertDialog(
            `Failed to create file: ${error instanceof Error ? error.message : "Unknown error"}`,
            "New File",
          );
          return;
        }
      },

      handleCreateNewFolder: async () => {
        const { rootFolderPath } = get();
        const { activePath } = useSidebarStore.getState();

        if (!rootFolderPath) {
          await showAlertDialog("Please open a folder first", "New Folder");
          return;
        }

        let effectiveRootPath = activePath || rootFolderPath;

        // Active path maybe is a file
        if (activePath) {
          try {
            await extname(activePath);
            effectiveRootPath = await dirname(activePath);
          } catch {}
        }

        if (!effectiveRootPath) {
          await showAlertDialog("Unable to determine root folder path", "New Folder");
          return;
        }

        const newFolder: FileEntry = {
          name: "",
          path: ensureTrailingPathSeparator(effectiveRootPath),
          isDir: true,
          isEditing: true,
          isNewItem: true,
        };

        set((state) => {
          state.files = addFileToTree(state.files, effectiveRootPath, newFolder);
          state.filesVersion++;
        });
      },

      handleCreateNewFolderInDirectory: async (dirPath: string, folderName?: string) => {
        if (!folderName) {
          folderName =
            (await showPromptDialog("Enter the name for the new folder:", {
              title: "New Folder",
              placeholder: "Folder name",
            })) ?? undefined;
          if (!folderName) return;
        }

        return get().createDirectory(dirPath, folderName);
      },

      handleDeletePath: async (targetPath: string, _isDirectory: boolean) => {
        return get().deleteFile(targetPath);
      },

      refreshDirectory: async (directoryPath: string, options?: { force?: boolean }) => {
        const dirNode = findFileInTree(get().files, directoryPath);

        if (!dirNode || !dirNode.isDir) {
          return;
        }

        // Check if directory is expanded using the file tree store
        // Root folder is always considered expanded since it's always visible
        const isRoot = directoryPath === get().rootFolderPath;
        const isExpanded = isRoot || useFileTreeStore.getState().isExpanded(directoryPath);

        if (!isExpanded && !options?.force) {
          return;
        }

        const entries = (
          await readProviderDirectoryEntries(directoryPath, get().rootFolderPath ?? directoryPath)
        ).map((entry) => ({
          name: entry.name,
          path: entry.path,
          is_dir: entry.isDir,
          is_symlink: entry.isSymlink,
          target: entry.symlinkTarget,
        }));

        set((state) => {
          const updated = updateDirectoryContents(state.files, directoryPath, entries as any[]);

          if (updated) {
            state.filesVersion++;
          }
        });
      },

      handleCollapseAllFolders: async () => {
        // Only collapse UI, do not mutate file data
        useFileTreeStore.getState().collapseAll();
      },

      handleFileMove: async (oldPath: string, newPath: string) => {
        const movedFile = findFileInTree(get().files, oldPath);
        if (!movedFile) {
          return;
        }

        const remoteSource = parseRemotePath(oldPath);
        const remoteTarget = parseRemotePath(newPath);
        const wslSource = parseWslPath(oldPath);
        const wslTarget = parseWslPath(newPath);
        if (
          remoteSource &&
          remoteTarget &&
          remoteSource.connectionId === remoteTarget.connectionId
        ) {
          await invoke("ssh_rename_path", {
            connectionId: remoteSource.connectionId,
            sourcePath: remoteSource.remotePath,
            targetPath: remoteTarget.remotePath,
          });
        } else if (wslSource || wslTarget) {
          if (!wslSource || !wslTarget || wslSource.distro !== wslTarget.distro) {
            toast.error(
              "Moving files between WSL distributions or local folders is not supported.",
            );
            return;
          }

          await invoke("wsl_rename_path", {
            distro: wslSource.distro,
            sourcePath: wslSource.linuxPath,
            targetPath: wslTarget.linuxPath,
          });
        }

        // Remove from old location
        let updatedFiles = removeFileFromTree(get().files, oldPath);

        // Update the file's path and name
        const updatedMovedFile = {
          ...movedFile,
          path: newPath,
          name: getBaseName(newPath, movedFile.name),
        };

        // Determine target directory from the new path
        const targetDir = getDirName(newPath) || get().rootFolderPath || "/";

        // Add to new location
        updatedFiles = addFileToTree(updatedFiles, targetDir, updatedMovedFile);

        set((state) => {
          state.files = updatedFiles;
          state.filesVersion = state.filesVersion + 1;
          state.projectFilesCache = undefined;
        });

        // Update open buffers
        const { buffers } = useBufferStore.getState();
        const { updateBuffer } = useBufferStore.getState().actions;
        const buffer = getBufferByPath(buffers, oldPath);
        if (buffer) {
          const fileName = getBaseName(newPath, buffer.name);
          updateBuffer({
            ...buffer,
            path: newPath,
            name: fileName,
          });
        }

        // Invalidate git diff cache for moved files
        const { rootFolderPath } = get();
        if (rootFolderPath) {
          gitDiffCache.invalidate(rootFolderPath, oldPath);
          gitDiffCache.invalidate(rootFolderPath, newPath);
        }
      },

      getAllProjectFiles: async (): Promise<FileEntry[]> => {
        const { rootFolderPath, projectFilesCache } = get();
        if (!rootFolderPath) return [];
        const workspaceFolderPaths = getWorkspaceFolderPaths(get);
        const cachePath = workspaceFolderPaths.join("\n");
        const scanStartedAt = performance.now();
        frontendTrace("info", "project-files", "getAllProjectFiles:start", {
          rootFolderPath,
          workspaceFolders: workspaceFolderPaths,
        });

        if (canUseNativeFileSearch(rootFolderPath)) {
          const nativeRootPaths = await ensureWorkspaceFileSearch(workspaceFolderPaths);
          const indexedFiles = await fffListFiles(nativeRootPaths);
          const files = indexedFiles.map<FileEntry>((file) => ({
            name: file.name,
            path: file.path,
            isDir: false,
          }));
          frontendTrace("info", "project-files", "getAllProjectFiles:end", {
            rootFolderPath,
            workspaceFolders: workspaceFolderPaths,
            files: files.length,
            source: "fff",
            durationMs: Math.round((performance.now() - scanStartedAt) * 100) / 100,
          });
          return files;
        }

        // Check cache first (cache for 5 minutes for better UX)
        const now = Date.now();
        if (
          projectFilesCache &&
          projectFilesCache.path === cachePath &&
          now - projectFilesCache.timestamp < 300000 // 5 minutes
        ) {
          frontendTrace("info", "project-files", "getAllProjectFiles:cache-hit", {
            rootFolderPath,
            workspaceFolders: workspaceFolderPaths,
            files: projectFilesCache.files.length,
            durationMs: Math.round((performance.now() - scanStartedAt) * 100) / 100,
          });
          return projectFilesCache.files;
        }

        // If we have cached files for this path (even if old), return them and update in background
        const hasCachedFiles = projectFilesCache?.files && projectFilesCache.files.length > 0;

        const scanFiles = async () => {
          try {
            const allFiles: FileEntry[] = [];
            let processedFiles = 0;
            const visitedDirectories = new Set<string>();

            const yieldToBrowser = () =>
              new Promise((resolve) => {
                if ("requestIdleCallback" in window) {
                  requestIdleCallback(resolve, { timeout: 4 });
                } else {
                  setTimeout(resolve, 1);
                }
              });

            const scanDirectory = async (directoryPath: string): Promise<void> => {
              if (visitedDirectories.has(directoryPath)) {
                return;
              }
              visitedDirectories.add(directoryPath);

              try {
                const entries = await readDirectory(directoryPath);

                for (const entry of entries as any[]) {
                  const name = entry.name || "Unknown";
                  const isDir = entry.is_dir || false;

                  if (shouldIgnore(name, isDir)) {
                    continue;
                  }

                  processedFiles++;

                  const fileEntry: FileEntry = {
                    name,
                    path: entry.path,
                    isDir,
                    children: undefined,
                  };

                  if (!fileEntry.isDir) {
                    allFiles.push(fileEntry);
                  } else {
                    await scanDirectory(fileEntry.path);
                  }

                  if (processedFiles % 100 === 0) {
                    await yieldToBrowser();
                  }
                }
              } catch (error) {
                console.warn(`Failed to scan directory ${directoryPath}:`, error);
              }
            };

            for (const workspaceFolderPath of workspaceFolderPaths) {
              await scanDirectory(workspaceFolderPath);
            }

            // Update cache with new results
            set((state) => {
              state.projectFilesCache = {
                path: cachePath,
                files: allFiles,
                timestamp: now,
              };
            });
            frontendTrace("info", "project-files", "getAllProjectFiles:end", {
              rootFolderPath,
              workspaceFolders: workspaceFolderPaths,
              files: allFiles.length,
              processedFiles,
              durationMs: Math.round((performance.now() - scanStartedAt) * 100) / 100,
            });
          } catch (error) {
            console.error("Failed to index project files:", error);
            frontendTrace("error", "project-files", "getAllProjectFiles:error", {
              rootFolderPath,
              workspaceFolders: workspaceFolderPaths,
              durationMs: Math.round((performance.now() - scanStartedAt) * 100) / 100,
            });
          }
        };

        // If we don't have cached files, wait for the scan to complete
        if (!hasCachedFiles) {
          await scanFiles();
          return get().projectFilesCache?.files || [];
        }

        // Otherwise, return cached files and update in background
        setTimeout(scanFiles, 0);
        return projectFilesCache?.files || [];
      },

      createFile: async (directoryPath: string, fileName: string) => {
        const remoteInfo = parseRemotePath(directoryPath);
        const filePath = remoteInfo
          ? (() => {
              const normalizedDirectory = directoryPath.endsWith("/")
                ? directoryPath.slice(0, -1)
                : directoryPath;
              return `${normalizedDirectory}/${fileName}`;
            })()
          : await createNewFile(directoryPath, fileName);

        if (remoteInfo) {
          await invoke("ssh_create_file", {
            connectionId: remoteInfo.connectionId,
            filePath: `${remoteInfo.remotePath.replace(/\/$/, "")}/${fileName}`,
          });
        }

        const newFile: FileEntry = {
          name: fileName,
          path: filePath,
          isDir: false,
        };

        set((state) => {
          state.files = addFileToTree(state.files, directoryPath, newFile);
          state.filesVersion++;
        });

        await get().handleFileSelect(filePath, false);

        return filePath;
      },

      createDirectory: async (parentPath: string, folderName: string) => {
        const remoteInfo = parseRemotePath(parentPath);
        const folderPath = remoteInfo
          ? (() => {
              const normalizedParent = parentPath.endsWith("/")
                ? parentPath.slice(0, -1)
                : parentPath;
              return `${normalizedParent}/${folderName}`;
            })()
          : await createNewDirectory(parentPath, folderName);

        if (remoteInfo) {
          await invoke("ssh_create_directory", {
            connectionId: remoteInfo.connectionId,
            directoryPath: `${remoteInfo.remotePath.replace(/\/$/, "")}/${folderName}`,
          });
        }

        const newFolder: FileEntry = {
          name: folderName,
          path: folderPath,
          isDir: true,
          children: [],
        };

        set((state) => {
          state.files = addFileToTree(state.files, parentPath, newFolder);
          state.filesVersion++;
        });

        return folderPath;
      },

      deleteFile: async (path: string) => {
        const remoteInfo = parseRemotePath(path);
        const entry = findFileInTree(get().files, path);

        if (remoteInfo) {
          await invoke("ssh_delete_path", {
            connectionId: remoteInfo.connectionId,
            targetPath: remoteInfo.remotePath,
            isDirectory: !!entry?.isDir,
          });
        } else {
          await deleteFileOrDirectory(path);
        }

        const { buffers, actions } = useBufferStore.getState();
        buffers
          .filter((buffer) => buffer.path === path)
          .forEach((buffer) => actions.closeBuffer(buffer.id));

        // Invalidate git diff cache for deleted file
        const { rootFolderPath } = get();
        if (rootFolderPath) {
          gitDiffCache.invalidate(rootFolderPath, path);
        }

        set((state) => {
          state.files = removeFileFromTree(state.files, path);
          state.filesVersion++;
        });
      },

      handleRevealInFolder: async (path: string) => {
        if (parseRemotePath(path)) {
          toast.info("Reveal in folder is only available for local workspaces.");
          return;
        }

        const wslInfo = parseWslPath(path);
        if (wslInfo) {
          const windowsPath = await invoke<string>("wsl_resolve_windows_path", { path });
          await revealItemInDir(windowsPath);
          return;
        }

        await revealItemInDir(path);
      },

      handleDuplicatePath: async (path: string) => {
        const remoteInfo = parseRemotePath(path);
        if (remoteInfo) {
          const fileEntry = findFileInTree(get().files, path);
          if (!fileEntry) return;

          const remotePath = remoteInfo.remotePath;
          const pathParts = remotePath.split("/");
          const base = pathParts.pop() || "";
          const dir = pathParts.join("/") || "/";
          const extMatch = base.match(/(\.[^.]*)$/);
          const ext = extMatch?.[1] ?? "";
          const nameWithoutExt = ext ? base.slice(0, -ext.length) : base;

          let counter = 0;
          let finalName = "";
          let finalPath = "";

          do {
            finalName =
              counter === 0
                ? `${nameWithoutExt}_copy${ext}`
                : `${nameWithoutExt}_copy_${counter}${ext}`;
            finalPath = dir === "/" ? `/${finalName}` : `${dir}/${finalName}`;
            counter++;
          } while (findFileInTree(get().files, `remote://${remoteInfo.connectionId}${finalPath}`));

          await invoke("ssh_copy_path", {
            connectionId: remoteInfo.connectionId,
            sourcePath: remoteInfo.remotePath,
            targetPath: finalPath,
            isDirectory: fileEntry.isDir,
          });

          const newEntry: FileEntry = {
            name: finalName,
            path: `remote://${remoteInfo.connectionId}${finalPath}`,
            isDir: fileEntry.isDir,
            children: fileEntry.isDir ? [] : undefined,
          };

          set((state) => {
            state.files = addFileToTree(
              state.files,
              `remote://${remoteInfo.connectionId}${dir === "/" ? "/" : dir}`,
              newEntry,
            );
            state.filesVersion++;
          });
          return;
        }

        const wslInfo = parseWslPath(path);
        if (wslInfo) {
          const fileEntry = findFileInTree(get().files, path);
          if (!fileEntry) return;

          const pathParts = wslInfo.linuxPath.split("/");
          const base = pathParts.pop() || "";
          const dir = pathParts.join("/") || "/";
          const extMatch = base.match(/(\.[^.]*)$/);
          const ext = extMatch?.[1] ?? "";
          const nameWithoutExt = ext ? base.slice(0, -ext.length) : base;

          let counter = 0;
          let finalName = "";
          let finalLinuxPath = "";
          let finalPath = "";

          do {
            finalName =
              counter === 0
                ? `${nameWithoutExt}_copy${ext}`
                : `${nameWithoutExt}_copy_${counter}${ext}`;
            finalLinuxPath = dir === "/" ? `/${finalName}` : `${dir}/${finalName}`;
            finalPath = buildWslPath(wslInfo.distro, finalLinuxPath);
            counter++;
          } while (findFileInTree(get().files, finalPath));

          await invoke("wsl_copy_path", {
            distro: wslInfo.distro,
            sourcePath: wslInfo.linuxPath,
            targetPath: finalLinuxPath,
            isDirectory: fileEntry.isDir,
          });

          const newEntry: FileEntry = {
            name: finalName,
            path: finalPath,
            isDir: fileEntry.isDir,
            children: fileEntry.isDir ? [] : undefined,
            isSymlink: fileEntry.isSymlink,
            symlinkTarget: fileEntry.symlinkTarget,
          };

          set((state) => {
            state.files = addFileToTree(state.files, buildWslPath(wslInfo.distro, dir), newEntry);
            state.filesVersion++;
          });
          return;
        }

        const dir = await dirname(path);
        const base = await basename(path);
        const ext = await extname(path);

        const originalFile = findFileInTree(get().files, path);
        if (!originalFile) return;

        const nameWithoutExt = base.slice(0, base.length - ext.length);
        let counter = 0;
        let finalName = "";
        let finalPath = "";

        const generateCopyName = () => {
          if (counter === 0) {
            return `${nameWithoutExt}_copy.${ext}`;
          }
          return `${nameWithoutExt}_copy_${counter}.${ext}`;
        };

        do {
          finalName = generateCopyName();
          finalPath = joinPath(dir, finalName);
          counter++;
        } while (findFileInTree(get().files, finalPath));

        await copyFile(path, finalPath);

        const newFile: FileEntry = {
          name: finalName,
          path: finalPath,
          isDir: false,
        };

        set((state) => {
          state.files = addFileToTree(state.files, dir, newFile);
          state.filesVersion++;
        });
      },

      handleRenamePath: async (path: string, newName?: string) => {
        if (newName) {
          const remoteInfo = parseRemotePath(path);
          const wslInfo = parseWslPath(path);

          try {
            let targetPath: string;

            if (remoteInfo) {
              const segments = remoteInfo.remotePath.split("/");
              segments.pop();
              const remoteDir = segments.join("/") || "/";
              const nextRemotePath = remoteDir === "/" ? `/${newName}` : `${remoteDir}/${newName}`;
              targetPath = `remote://${remoteInfo.connectionId}${nextRemotePath}`;
              await invoke("ssh_rename_path", {
                connectionId: remoteInfo.connectionId,
                sourcePath: remoteInfo.remotePath,
                targetPath: nextRemotePath,
              });
            } else if (wslInfo) {
              const segments = wslInfo.linuxPath.split("/");
              segments.pop();
              const wslDir = segments.join("/") || "/";
              const nextLinuxPath = wslDir === "/" ? `/${newName}` : `${wslDir}/${newName}`;
              targetPath = buildWslPath(wslInfo.distro, nextLinuxPath);
              await invoke("wsl_rename_path", {
                distro: wslInfo.distro,
                sourcePath: wslInfo.linuxPath,
                targetPath: nextLinuxPath,
              });
            } else {
              const dir = await dirname(path);
              targetPath = await join(dir, newName);
              await renameFile(path, targetPath);
            }

            set((state) => {
              state.files = updateFileInTree(state.files, path, (item) => ({
                ...item,
                name: newName,
                path: targetPath,
                isRenaming: false,
              }));
              state.filesVersion++;
            });

            const { buffers, actions } = useBufferStore.getState();
            const buffer = getBufferByPath(buffers, path);
            if (buffer) {
              actions.updateBuffer({
                ...buffer,
                path: targetPath,
                name: newName,
              });
            }
          } catch (error) {
            console.error("Failed to rename file:", error);
            set((state) => {
              state.files = updateFileInTree(state.files, path, (item) => ({
                ...item,
                isRenaming: false,
              }));
              state.filesVersion++;
            });
          }
        } else {
          set((state) => {
            state.files = updateFileInTree(state.files, path, (item) => ({
              ...item,
              isRenaming: !item.isRenaming,
            }));
            state.filesVersion++;
          });
        }
      },

      // Setter methods
      setFiles: (newFiles: FileEntry[]) => {
        set((state) => {
          state.files = newFiles;
          state.filesVersion++;
        });
      },

      setIsSwitchingProject: (value: boolean) => {
        set((state) => {
          state.isSwitchingProject = value;
        });
      },

      switchToProject: async (projectId: string) => {
        const currentStore = get();
        currentStore.setIsSwitchingProject(true);

        const { switchWorkspaceRuntime } =
          await import("@/features/workspace/services/workspace-lifecycle");
        const switched = await switchWorkspaceRuntime(projectId, {
          persistCurrent: () => currentStore.persistActiveProjectSession(),
          initialize: async (workspaceId, path, name) => {
            const targetStore = getScopedFileSystemStore(workspaceId).getState();
            targetStore.setIsSwitchingProject(true);

            const remote = parseRemotePath(path);
            const wsl = parseWslPath(path);
            const initialized = remote
              ? await targetStore.handleOpenRemoteProject(remote.connectionId, name)
              : wsl
                ? await targetStore.handleOpenWslProject(wsl.distro, wsl.linuxPath)
                : await targetStore.handleOpenFolderByPath(path);

            targetStore.setIsSwitchingProject(false);
            return initialized;
          },
          resume: async (workspaceId, path) => {
            const targetStore = getScopedFileSystemStore(workspaceId).getState();
            const projectStore = useProjectStore.getStore(workspaceId).getState();
            targetStore.setIsSwitchingProject(true);
            projectStore.setActiveProjectId(workspaceId);

            if (parseRemotePath(path) || parseWslPath(path)) {
              await useFileWatcherStore.getStore(workspaceId).getState().setProjectRoot("");
            } else {
              await useFileWatcherStore.getStore(workspaceId).getState().setProjectRoot(path);
              void syncFffWorkspace(() => targetStore);
              void getGitStatus(path)
                .then((gitStatus) => {
                  useGitStore
                    .getStore(workspaceId)
                    .getState()
                    .actions.setWorkspaceGitStatus(gitStatus, path);
                })
                .catch((error) => {
                  console.error("Failed to refresh workspace git state:", error);
                });
            }

            targetStore.setIsSwitchingProject(false);
          },
        });

        currentStore.setIsSwitchingProject(false);
        if (!switched) {
          toast.error("Failed to switch project.");
        }
        return switched;
      },
      closeProject: async (projectId: string) => {
        const tab = useWorkspaceTabsStore
          .getState()
          .projectTabs.find((projectTab) => projectTab.id === projectId);
        if (!tab) {
          return false;
        }

        const workspaceBuffers = useBufferStore.getStore(projectId).getState().buffers;
        if (getDirtyEditorBuffers(workspaceBuffers).length > 0) {
          if (
            workspaceRuntimeRegistry.getActiveWorkspaceId() !== projectId &&
            !(await get().switchToProject(projectId))
          ) {
            return false;
          }

          if (
            !(await prepareProjectTransitionWithUnsavedBuffers(
              "closing this project",
              useBufferStore.getStore(projectId).getState().buffers,
            ))
          ) {
            return false;
          }
        }

        const { closeWorkspaceRuntime } =
          await import("@/features/workspace/services/workspace-lifecycle");
        return await closeWorkspaceRuntime(projectId, {
          persist: () =>
            getScopedFileSystemStore(projectId).getState().persistActiveProjectSession(),
          dispose: async (path) => {
            const terminalSessions = useTerminalStore.getStore(projectId).getState().sessions;
            await Promise.all(
              [...terminalSessions.values()].map(async (session) => {
                if (!session.connectionId) {
                  return;
                }

                const command = session.remoteConnectionId
                  ? "close_remote_terminal"
                  : "close_terminal";
                await invoke(command, { id: session.connectionId }).catch((error) => {
                  console.error("Failed to close terminal session:", error);
                });
              }),
            );

            const remote = parseRemotePath(path);
            if (!remote) {
              return;
            }

            await invoke("ssh_disconnect_only", {
              connectionId: remote.connectionId,
            }).catch((error) => {
              console.error("Failed to disconnect remote workspace:", error);
            });
            await connectionStore
              .updateConnectionStatus(remote.connectionId, false)
              .catch(() => {});
          },
          switchTo: (nextWorkspaceId) => get().switchToProject(nextWorkspaceId),
          showWelcome: async () => {
            await useFileWatcherStore.getState().setProjectRoot("");
            useProjectStore.getState().setRootFolderPath(undefined);
            useProjectStore.getState().setProjectName("Files");
            restoreProjectUiState(undefined);
          },
        });
      },
    })),
  );

scopedFileSystemStore = createWorkspaceScopedStore<ScopedFileSystemStoreState>(
  "file-system",
  createFileSystemStore,
);

export const useFileSystemStore = createSelectors(scopedFileSystemStore);
