import { invoke } from "@tauri-apps/api/core";
import { basename, dirname, extname, join } from "@tauri-apps/api/path";
import { copyFile, readFile } from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
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
import { fileOpenBenchmark } from "@/features/editor/utils/file-open-benchmark";
import { getLineSlice } from "@/features/editor/utils/large-file";
import { getAncestorDirectoryPaths } from "@/features/file-explorer/utils/file-explorer-tree-utils";
import { useFileTreeStore } from "@/features/file-explorer/stores/file-explorer-tree.store";
import { getGitStatus } from "@/features/git/api/git-status-api";
import { useGitBlameStore } from "@/features/git/stores/git-blame.store";
import { useGitStore } from "@/features/git/stores/git.store";
import { gitDiffCache } from "@/features/git/utils/git-diff-cache";
import { connectionStore } from "@/features/remote/stores/remote-connection.store";
import { parseRemotePath } from "@/features/remote/utils/remote-path";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { useSidebarStore } from "@/features/layout/stores/sidebar.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import type { BufferSession } from "@/features/window/stores/session.store";
import { useSessionStore } from "@/features/window/stores/session.store";
import {
  persistCurrentProjectUiState,
  restoreProjectPaneState,
  restoreProjectUiState,
} from "@/features/window/stores/workspace-ui-session";
import { useWorkspaceTabsStore } from "@/features/window/stores/workspace-tabs.store";
import { createAppWindow } from "@/features/window/utils/create-app-window";
import {
  buildTerminalRestorePayload,
  loadWorkspaceTerminalsFromStorage,
} from "@/features/terminal/lib/terminal-session-storage";
import type { PaneContent } from "@/features/panes/types/pane-content.types";
import { showAlertDialog, showPromptDialog } from "@/features/dialogs/services/dialog-service";
import { toast } from "@/ui/toast";
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
import { fffSetWorkspace, fffTrackAccess } from "@/features/global-search/lib/rust-api/search";
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
import { switchToNextAvailableProjectAfterClose } from "../controllers/workspace-project-tabs";
import { prepareProjectTransitionWithUnsavedBuffers } from "../controllers/workspace-project-transition";
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

const readProviderDirectoryEntries = async (path: string): Promise<FileEntry[]> => {
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

  return sortFileEntries(await readDirectoryContents(path));
};

let latestFileOpenRequestId = 0;
const textFileDecoder = new TextDecoder("utf-8");
const MAX_SESSION_BUFFERS_TO_RESTORE = 8;

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error || "Unknown error");

const readPersistedTerminalSessions = (workspacePath: string | undefined) => {
  try {
    return loadWorkspaceTerminalsFromStorage(workspacePath);
  } catch (error) {
    console.error("Failed to read terminal sessions", error);
    return [];
  }
};

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
) => {
  if (bufferSession.type !== "editor" || !bufferSession.editorState) {
    return;
  }

  const openedBuffer = useBufferStore
    .getState()
    .buffers.find((buffer) => buffer.type === "editor" && buffer.path === bufferSession.path);

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
type FileSystemSet = (updater: (state: FileSystemStoreState) => void) => void;
type FileSystemGet = () => FileSystemStoreState;

interface OpenLocalWorkspaceOptions {
  path: string;
  traceLabel: "handleOpenFolder" | "handleOpenFolderByPath";
  treeState: "expand-root" | "collapse-all";
  restoreUiState: boolean;
}

const initializeLocalWorkspaceInBackground = (
  path: string,
  get: FileSystemGet,
  errorContext: string,
) => {
  useGitStore.getState().actions.setWorkspaceGitStatus(null, path);

  void (async () => {
    const backgroundInitStartedAt = performance.now();
    logWorkspaceOpenStep("start", "backgroundInit", path);
    try {
      const watcherStartedAt = performance.now();
      logWorkspaceOpenStep("start", "setProjectRoot", path);
      await useFileWatcherStore.getState().setProjectRoot(path);
      logWorkspaceOpenStep("end", "setProjectRoot", path, watcherStartedAt);

      fffSetWorkspace(path).catch((error) => {
        console.error("[fff] set_workspace failed:", error);
      });

      const gitStatusStartedAt = performance.now();
      logWorkspaceOpenStep("start", "getGitStatus", path);
      const gitStatus = await getGitStatus(path);
      logWorkspaceOpenStep("end", "getGitStatus", path, gitStatusStartedAt);

      if (get().rootFolderPath !== path) {
        return;
      }

      useGitStore.getState().actions.setWorkspaceGitStatus(gitStatus, path);

      const restoreStartedAt = performance.now();
      logWorkspaceOpenStep("start", "restoreSession", path);
      await get().restoreSession(path);
      logWorkspaceOpenStep("end", "restoreSession", path, restoreStartedAt);
      logWorkspaceOpenStep("end", "backgroundInit", path, backgroundInitStartedAt);
    } catch (error) {
      if (get().rootFolderPath === path) {
        useGitStore.getState().actions.setWorkspaceGitStatus(null, path);
      }
      logWorkspaceOpenStep("error", "backgroundInit", path, backgroundInitStartedAt);
      console.error(errorContext, error);
    }
  })();
};

const openLocalWorkspace = async (
  options: OpenLocalWorkspaceOptions,
  set: FileSystemSet,
  get: FileSystemGet,
) => {
  const { path, traceLabel, treeState, restoreUiState } = options;
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
    useWorkspaceTabsStore.getState().addProjectTab(path, projectName);

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

    const { setRootFolderPath, setProjectName } = useProjectStore.getState();
    setRootFolderPath(path);
    setProjectName(projectName);

    if (restoreUiState) {
      restoreProjectUiState(path);
    }

    const activeProjectTab = useWorkspaceTabsStore.getState().getActiveProjectTab();
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

  initializeLocalWorkspaceInBackground(
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

export const useFileSystemStore = createSelectors(
  create<FsState & FsActions>()(
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
      handleOpenFolder: async () => {
        const selected = await openFolder();
        if (!selected) return false;

        const { settings } = useSettingsStore.getState();
        const hasOpenWorkspace =
          !!get().rootFolderPath || useWorkspaceTabsStore.getState().projectTabs.length > 0;

        if (
          settings.openFoldersInNewWindow &&
          settings.titleBarProjectMode === "window" &&
          hasOpenWorkspace
        ) {
          await createAppWindow({
            path: selected,
            isDirectory: true,
          });
          return true;
        }

        return await openLocalWorkspace(
          {
            path: selected,
            traceLabel: "handleOpenFolder",
            treeState: "expand-root",
            restoreUiState: false,
          },
          set,
          get,
        );
      },

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
        useGitBlameStore.getState().clearAllBlame();
      },

      restoreSession: async (projectPath: string, skipBufferPath?: string) => {
        const session = useSessionStore.getState().getSession(projectPath);
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
        }

        const terminalsToRestore = buildTerminalRestorePayload({
          projectSessionTerminals: session?.terminals,
          storageTerminals: readPersistedTerminalSessions(projectPath),
          preferProjectSession: !!session,
        });
        window.dispatchEvent(
          new CustomEvent("restore-terminals", {
            detail: { terminals: terminalsToRestore },
          }),
        );

        if (session) {
          const { actions: bufferActions } = useBufferStore.getState();
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
              restoreEditorSessionStateForPath(buffer);
              frontendTrace("info", "workspace-open", "restoreSession:buffer:end", {
                projectPath,
                bufferPath: buffer.path,
              });

              // If it was pinned, we might need to handle that, but handleFileSelect doesn't support pinning arg.
              // We can pin it after opening if needed.
              if (buffer.isPinned) {
                const newBuffers = useBufferStore.getState().buffers;
                const openedBuffer = newBuffers.find((b) => b.path === buffer.path);
                if (openedBuffer) {
                  bufferActions.handleTabPin(openedBuffer.id);
                }
              }
            }
          };

          await restoreBuffers(buffersToRestore);

          // Restore active buffer
          if (restorePlan.activeBufferPath) {
            const { buffers } = useBufferStore.getState();
            const activeBuffer = buffers.find((b) => b.path === restorePlan.activeBufferPath);
            if (activeBuffer) {
              useBufferStore.getState().actions.setActiveBuffer(activeBuffer.id);
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
                if (get().rootFolderPath !== projectPath) {
                  return;
                }

                await restoreBuffers(deferredBuffers);
                restoreProjectPaneState(projectPath);
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

        restoreProjectPaneState(projectPath);

        useAIChatStore
          .getState()
          .restoreWorkspaceSession(session?.aiSession, useBufferStore.getState().buffers);
      },

      persistActiveProjectSession: () => {
        const currentRootPath = get().rootFolderPath;
        if (!currentRootPath) {
          return;
        }

        persistCurrentProjectUiState(currentRootPath);

        const { buffers, activeBufferId } = useBufferStore.getState();
        const activeBuffer = buffers.find((buffer) => buffer.id === activeBufferId);
        const workspaceFolders = normalizeWorkspaceFolders(currentRootPath, get().workspaceFolders);
        const workspaceFolderPaths = workspaceFolders.map((folder) => folder.path);

        clearQueuedWorkspaceSessionSave(currentRootPath);
        useSessionStore.getState().saveSession(
          currentRootPath,
          buffers
            .map((buffer) =>
              serializeWorkspaceBuffer(buffer, currentRootPath, workspaceFolderPaths),
            )
            .filter((buffer): buffer is BufferSession => buffer !== null),
          activeBuffer?.path || null,
          readPersistedTerminalSessions(currentRootPath),
          readPersistedAiWorkspaceSession(),
          workspaceFolders,
        );
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

        return await openLocalWorkspace(
          {
            path,
            traceLabel: "handleOpenFolderByPath",
            treeState: "collapse-all",
            restoreUiState: true,
          },
          set,
          get,
        );
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

        useFileTreeStore.getState().collapsePath(folder.path);
        get().persistActiveProjectSession();
        toast.success(`Removed "${folder.name}" from workspace.`);
        return true;
      },

      handleOpenRemoteProject: async (connectionId: string, _connectionName: string) => {
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

        const { updateActivePath } = useSidebarStore.getState();
        updateActivePath(path);

        const {
          buffers,
          actions: { convertPreviewToDefinite, setActiveBuffer },
        } = useBufferStore.getState();
        const workspaceRootPath = get().rootFolderPath;
        const fileName = getFilenameFromPath(path);
        const existingBuffer = buffers.find((buffer) => buffer.path === path);
        if (existingBuffer) {
          fileOpenBenchmark.finish(path, "existing-buffer");
          setActiveBuffer(existingBuffer.id);
          recordLocalFileAccess(path, fileName, workspaceRootPath, getWorkspaceFolderPaths(get));

          if (existingBuffer.isPreview && !isPreview) {
            convertPreviewToDefinite(existingBuffer.id);
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

        const shouldResolveSymlink = !path.startsWith("diff://") && !path.startsWith("remote://");
        if (shouldResolveSymlink) {
          try {
            const workspaceRoot = get().rootFolderPath;
            const symlinkInfo = await getSymlinkInfo(path, workspaceRoot);

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
        fileOpenBenchmark.mark(path, "symlink-resolved");

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

          if (!path.startsWith("remote://") && !wslInfo && !isKnownTextFile(resolvedPath)) {
            try {
              const fileData = await readFile(resolvedPath);

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
          } else if (wslInfo && !isKnownTextFile(resolvedPath)) {
            try {
              const fileData = await invoke<number[]>("wsl_read_file_bytes", {
                distro: wslInfo.distro,
                filePath: wslInfo.linuxPath,
              });

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
          const externalEditorEngines = new Set(["nvim", "helix", "vim", "custom"]);
          const usesExternalEditor = externalEditorEngines.has(settings.editorEngine);

          const hasExternalEditorCommand =
            settings.editorEngine !== "custom" || settings.customEditorCommand.trim().length > 0;

          if (usesExternalEditor && hasExternalEditorCommand && !wslInfo) {
            if (isStaleRequest()) return;
            try {
              const { rootFolderPath } = get();

              // Create terminal connection for external editor
              const connectionId = await invoke<string>("create_terminal", {
                config: {
                  working_directory: rootFolderPath || undefined,
                  rows: 24,
                  cols: 80,
                },
              });

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

            content = await invoke<string>("ssh_read_file", {
              connectionId,
              filePath: remotePath,
            });
          } else if (wslInfo) {
            content =
              preloadedLocalText ??
              (await invoke<string>("wsl_read_file", {
                distro: wslInfo.distro,
                filePath: wslInfo.linuxPath,
              }));
          } else {
            content = preloadedLocalText ?? (await readFileContent(resolvedPath));
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
            const childEntries = await readProviderDirectoryEntries(folder.path);

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
            const childEntries = await readProviderDirectoryEntries(ancestorPath);

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

                const children = await readProviderDirectoryEntries(item.path);

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

        const entries = (await readProviderDirectoryEntries(directoryPath)).map((entry) => ({
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
        const buffer = buffers.find((b) => b.path === oldPath);
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
            const buffer = buffers.find((b) => b.path === path);
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
        const switchStartedAt = performance.now();
        const workspaceTabsStore = useWorkspaceTabsStore.getState();
        const tab = workspaceTabsStore.projectTabs.find((t: { id: string }) => t.id === projectId);

        if (!tab) {
          console.warn(`Project tab not found: ${projectId}`);
          return false;
        }

        const currentRootPath = get().rootFolderPath;
        const previousActiveTab = workspaceTabsStore.getActiveProjectTab();
        if (currentRootPath === tab.path) {
          workspaceTabsStore.setActiveProjectTab(projectId);
          set((state) => {
            state.isSwitchingProject = false;
          });
          return true;
        }
        const remoteTabInfo = parseRemotePath(tab.path);
        const wslTabInfo = parseWslPath(tab.path);

        const { buffers, actions: bufferActions } = useBufferStore.getState();
        const currentBuffers = [...buffers];
        const currentBufferIds = currentBuffers.map((buffer) => buffer.id);
        if (
          !(await prepareProjectTransitionWithUnsavedBuffers("switching projects", currentBuffers))
        ) {
          return false;
        }

        logWorkspaceOpenStep("start", "switchToProject", tab.path);

        const session = useSessionStore.getState().getSession(tab.path);
        const restorePlan = buildWorkspaceRestorePlan(session);

        set((state) => {
          state.isSwitchingProject = true;
          state.isFileTreeLoading = true;
        });

        try {
          if (!remoteTabInfo && !wslTabInfo) {
            const symlinkInfo = await getSymlinkInfo(tab.path);
            if (!symlinkInfo.is_dir) {
              throw new Error(`Project path is not a folder: ${tab.path}`);
            }
          }

          if (currentRootPath) {
            get().persistActiveProjectSession();
          }

          workspaceTabsStore.setActiveProjectTab(projectId);

          if (remoteTabInfo) {
            const reconnected = await get().handleOpenRemoteProject(
              remoteTabInfo.connectionId,
              tab.name,
            );
            if (!reconnected) {
              throw new Error(`Failed to reconnect remote workspace "${tab.name}".`);
            }
            useProjectStore.getState().setActiveProjectId(projectId);
          } else if (wslTabInfo) {
            const reopened = await get().handleOpenWslProject(
              wslTabInfo.distro,
              wslTabInfo.linuxPath,
            );
            if (!reopened) {
              throw new Error(`Failed to reopen WSL workspace "${tab.name}".`);
            }
            useProjectStore.getState().setActiveProjectId(projectId);
          } else {
            const readDirectoryStartedAt = performance.now();
            logWorkspaceOpenStep("start", "switchToProject:readDirectoryContents", tab.path);
            const entries = await readDirectoryContents(tab.path);
            logWorkspaceOpenStep(
              "end",
              "switchToProject:readDirectoryContents",
              tab.path,
              readDirectoryStartedAt,
            );
            const fileTree = sortFileEntries(entries);
            const wrappedFileTree = wrapWithRootFolder(fileTree, tab.path, tab.name);

            useFileTreeStore.getState().setExpandedPaths(new Set([tab.path]));

            const { setRootFolderPath, setProjectName, setActiveProjectId } =
              useProjectStore.getState();
            setRootFolderPath(tab.path);
            setProjectName(tab.name);
            setActiveProjectId(projectId);
            restoreProjectUiState(tab.path);

            gitDiffCache.clear();

            set((state) => {
              state.isFileTreeLoading = false;
              state.files = wrappedFileTree;
              state.rootFolderPath = tab.path;
              state.workspaceFolders = [{ path: tab.path, name: tab.name, isPrimary: true }];
              state.filesVersion++;
              state.projectFilesCache = undefined;
            });

            useGitStore.getState().actions.setWorkspaceGitStatus(null, tab.path);

            void (async () => {
              const backgroundInitStartedAt = performance.now();
              logWorkspaceOpenStep("start", "switchToProject:backgroundInit", tab.path);
              try {
                const watcherStartedAt = performance.now();
                logWorkspaceOpenStep("start", "switchToProject:setProjectRoot", tab.path);
                await useFileWatcherStore.getState().setProjectRoot(tab.path);
                logWorkspaceOpenStep(
                  "end",
                  "switchToProject:setProjectRoot",
                  tab.path,
                  watcherStartedAt,
                );

                fffSetWorkspace(tab.path).catch((error) => {
                  console.error("[fff] set_workspace failed:", error);
                });

                const gitStatusStartedAt = performance.now();
                logWorkspaceOpenStep("start", "switchToProject:getGitStatus", tab.path);
                const gitStatus = await getGitStatus(tab.path);
                logWorkspaceOpenStep(
                  "end",
                  "switchToProject:getGitStatus",
                  tab.path,
                  gitStatusStartedAt,
                );

                if (get().rootFolderPath !== tab.path) {
                  return;
                }

                useGitStore.getState().actions.setWorkspaceGitStatus(gitStatus, tab.path);

                const activeSessionBuffer = restorePlan.initialBuffer;
                if (activeSessionBuffer) {
                  if (activeSessionBuffer.type === "webViewer") {
                    const restoredBufferId = bufferActions.openContent({
                      type: "webViewer",
                      url: activeSessionBuffer.url ?? "about:blank",
                      zoomLevel: activeSessionBuffer.zoomLevel,
                    });
                    if (activeSessionBuffer.isPinned) {
                      bufferActions.handleTabPin(restoredBufferId);
                    }
                  } else if (activeSessionBuffer.type === "terminal") {
                    const restoredBufferId = bufferActions.openContent({
                      type: "terminal",
                      name: activeSessionBuffer.name,
                      command: activeSessionBuffer.initialCommand,
                      workingDirectory: activeSessionBuffer.workingDirectory,
                      remoteConnectionId: activeSessionBuffer.remoteConnectionId,
                      sessionId: activeSessionBuffer.sessionId,
                      path: activeSessionBuffer.path,
                    });
                    if (activeSessionBuffer.isPinned) {
                      bufferActions.handleTabPin(restoredBufferId);
                    }
                  } else {
                    const restoreActiveStartedAt = performance.now();
                    logWorkspaceOpenStep(
                      "start",
                      "switchToProject:restoreActiveBuffer",
                      activeSessionBuffer.path,
                    );
                    await get().handleFileSelect(
                      activeSessionBuffer.path,
                      false,
                      undefined,
                      undefined,
                      undefined,
                      activeSessionBuffer.isPreview,
                    );
                    restoreEditorSessionStateForPath(activeSessionBuffer);
                    logWorkspaceOpenStep(
                      "end",
                      "switchToProject:restoreActiveBuffer",
                      activeSessionBuffer.path,
                      restoreActiveStartedAt,
                    );
                    if (activeSessionBuffer.isPinned) {
                      const openedBuffer = useBufferStore
                        .getState()
                        .buffers.find((buffer) => buffer.path === activeSessionBuffer.path);
                      if (openedBuffer && !openedBuffer.isPinned) {
                        bufferActions.handleTabPin(openedBuffer.id);
                      }
                    }
                  }
                }

                const restoreStartedAt = performance.now();
                logWorkspaceOpenStep("start", "switchToProject:restoreSession", tab.path);
                await get().restoreSession(tab.path, activeSessionBuffer?.path);
                logWorkspaceOpenStep(
                  "end",
                  "switchToProject:restoreSession",
                  tab.path,
                  restoreStartedAt,
                );
                logWorkspaceOpenStep(
                  "end",
                  "switchToProject:backgroundInit",
                  tab.path,
                  backgroundInitStartedAt,
                );
              } catch (error) {
                if (get().rootFolderPath === tab.path) {
                  useGitStore.getState().actions.setWorkspaceGitStatus(null, tab.path);
                }
                logWorkspaceOpenStep(
                  "error",
                  "switchToProject:backgroundInit",
                  tab.path,
                  backgroundInitStartedAt,
                );
                console.error("Failed to refresh workspace git state:", error);
              }
            })();
          }

          if (currentBufferIds.length > 0) {
            bufferActions.closeBuffersBatch(currentBufferIds, true);
          }

          set((state) => {
            state.isSwitchingProject = false;
          });
          logWorkspaceOpenStep("end", "switchToProject", tab.path, switchStartedAt);
          return true;
        } catch (error) {
          console.error("Failed to switch project:", error);
          logWorkspaceOpenStep("error", "switchToProject", tab.path, switchStartedAt);

          const nextWorkspaceTabsStore = useWorkspaceTabsStore.getState();

          if (!remoteTabInfo && !wslTabInfo) {
            nextWorkspaceTabsStore.removeProjectTab(tab.id);
          }

          const previousActiveTabId = previousActiveTab?.id;
          const previousTabStillExists = previousActiveTabId
            ? nextWorkspaceTabsStore.projectTabs.some(
                (projectTab) => projectTab.id === previousActiveTabId,
              )
            : false;

          if (previousActiveTabId && previousTabStillExists) {
            nextWorkspaceTabsStore.setActiveProjectTab(previousActiveTabId);
          } else if (currentRootPath) {
            const currentRootTab = nextWorkspaceTabsStore.projectTabs.find(
              (projectTab) => projectTab.path === currentRootPath,
            );
            if (currentRootTab) {
              nextWorkspaceTabsStore.setActiveProjectTab(currentRootTab.id);
            }
          }

          set((state) => {
            state.isFileTreeLoading = false;
            state.isSwitchingProject = false;
          });
          toast.error(`Failed to switch project: ${getErrorMessage(error)}`);
          return false;
        }
      },

      closeProject: async (projectId: string) => {
        const tabs = useWorkspaceTabsStore.getState().projectTabs;

        const tab = tabs.find((t: { id: string }) => t.id === projectId);
        if (!tab) {
          console.warn(`Project tab not found: ${projectId}`);
          return false;
        }

        const wasActive = tab.isActive;
        const isLastTab = tabs.length <= 1;
        const remoteTabInfo = parseRemotePath(tab.path);

        if (wasActive) {
          if (
            !(await prepareProjectTransitionWithUnsavedBuffers(
              "closing this project",
              useBufferStore.getState().buffers,
            ))
          ) {
            return false;
          }
        }

        // Save session before closing if it's the active project
        if (wasActive) {
          get().persistActiveProjectSession();
        }

        if (remoteTabInfo) {
          await invoke("ssh_disconnect_only", {
            connectionId: remoteTabInfo.connectionId,
          }).catch((error) => {
            console.error("Failed to disconnect remote workspace:", error);
          });
          await connectionStore
            .updateConnectionStatus(remoteTabInfo.connectionId, false)
            .catch(() => {});
        }

        // Remove project tab
        useWorkspaceTabsStore.getState().removeProjectTab(projectId);

        // If this was the last tab, reset to empty state
        if (isLastTab) {
          // Stop file watching
          useFileWatcherStore.getState().reset();

          // Clear all buffers
          const { buffers } = useBufferStore.getState();
          const allBufferIds = buffers.map((b) => b.id);
          useBufferStore.getState().actions.closeBuffersBatch(allBufferIds, true);

          // Clear git state
          const gitActions = useGitStore.getState().actions;
          gitActions.setWorkspaceGitStatus(null, null);
          gitActions.setCommits([]);

          // Clear project store
          const { setRootFolderPath, setProjectName } = useProjectStore.getState();
          setRootFolderPath(undefined);
          setProjectName("Files");
          restoreProjectUiState(undefined);

          // Reset file system state
          set((state) => {
            state.files = [];
            state.rootFolderPath = undefined;
            state.workspaceFolders = [];
            state.filesVersion = 0;
          });

          return true;
        }

        // If we closed the active project, switch to the newly active one
        if (wasActive) {
          const newActiveTab = useWorkspaceTabsStore.getState().getActiveProjectTab();
          if (newActiveTab) {
            return await switchToNextAvailableProjectAfterClose(newActiveTab.id, {
              getProjectTabs: () => useWorkspaceTabsStore.getState().projectTabs,
              setActiveProjectTab: (projectTabId) =>
                useWorkspaceTabsStore.getState().setActiveProjectTab(projectTabId),
              removeProjectTab: (projectTabId) =>
                useWorkspaceTabsStore.getState().removeProjectTab(projectTabId),
              resetWorkspace: () => get().resetWorkspace(),
              switchToProject: (nextProjectId) => get().switchToProject(nextProjectId),
            });
          } else {
            // If no active tab (we closed the last one), clear the workspace
            await get().resetWorkspace();
          }
        }

        return true;
      },
    })),
  ),
);
