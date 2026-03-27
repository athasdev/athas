import { invoke } from "@tauri-apps/api/core";
import isEqual from "fast-deep-equal";
import { immer } from "zustand/middleware/immer";
import { createWithEqualityFn } from "zustand/traditional";
import {
  createHarnessChatScopeId,
  createHarnessSessionKey,
  DEFAULT_HARNESS_SESSION_KEY,
  getDefaultHarnessBufferTitle,
  getHarnessBufferTitle,
} from "@/features/ai/lib/chat-scope";
import {
  buildHarnessAgentBufferPath,
  DEFAULT_HARNESS_RUNTIME_BACKEND,
  type HarnessRuntimeBackend,
  normalizeHarnessRuntimeBackend,
} from "@/features/ai/lib/harness-runtime-backend";
import {
  type ClosedBufferHistoryEntry,
  createClosedBufferHistoryEntry,
  getMostRecentClosedHarnessSession,
} from "@/features/ai/lib/harness-session-lifecycle";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { detectLanguageFromFileName } from "@/features/editor/utils/language-detection";
import { logger } from "@/features/editor/utils/logger";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { useRecentFilesStore } from "@/features/file-system/controllers/recent-files-store";
import type { MultiFileDiff } from "@/features/git/types/diff";
import type { GitDiff } from "@/features/git/types/git";
import { usePaneStore } from "@/features/panes/stores/pane-store";
import { cleanupBufferHistoryTracking } from "@/stores/app-store";
import type { ActiveSessionBuffer, PersistedBufferSession } from "@/stores/session-store";
import { useSessionStore } from "@/stores/session-store";
import { createSelectors } from "@/utils/zustand-selectors";

const syncBufferToPane = (bufferId: string) => {
  const paneStore = usePaneStore.getState();
  const activePane = paneStore.actions.getActivePane();
  if (activePane && !activePane.bufferIds.includes(bufferId)) {
    paneStore.actions.addBufferToPane(activePane.id, bufferId);
  } else if (activePane) {
    paneStore.actions.setActivePaneBuffer(activePane.id, bufferId);
  }
};

const syncAndFocusBufferInPane = (bufferId: string) => {
  const paneStore = usePaneStore.getState();
  const paneWithBuffer = paneStore.actions.getPaneByBufferId(bufferId);

  if (paneWithBuffer) {
    paneStore.actions.setActivePane(paneWithBuffer.id);
    paneStore.actions.setActivePaneBuffer(paneWithBuffer.id, bufferId);
    return;
  }

  syncBufferToPane(bufferId);
};

const removeBufferFromPanes = (bufferId: string) => {
  const paneStore = usePaneStore.getState();
  const pane = paneStore.actions.getPaneByBufferId(bufferId);
  if (pane) {
    paneStore.actions.removeBufferFromPane(pane.id, bufferId);
  }
};

export interface Buffer {
  id: string;
  path: string;
  name: string;
  content: string;
  savedContent: string;
  isDirty: boolean;
  isVirtual: boolean;
  isPinned: boolean;
  isPreview: boolean;
  isImage: boolean;
  isSQLite: boolean;
  isDiff: boolean;
  isMarkdownPreview: boolean;
  isHtmlPreview: boolean;
  isCsvPreview: boolean;
  isExternalEditor: boolean;
  isWebViewer: boolean;
  isPullRequest: boolean;
  isPdf: boolean;
  isBinary: boolean;
  isActive: boolean;
  language?: string; // File language for syntax highlighting and formatting
  // For diff buffers, store the parsed diff data (single or multi-file)
  diffData?: GitDiff | MultiFileDiff;
  // For markdown preview buffers, store the source file path
  sourceFilePath?: string;
  // For external editor buffers, store the terminal connection ID
  terminalConnectionId?: string;
  // For web viewer buffers, store the URL
  webViewerUrl?: string;
  webViewerTitle?: string;
  webViewerFavicon?: string;
  // For PR buffers, store the PR number
  prNumber?: number;
  // For terminal tab buffers
  isTerminal?: boolean;
  terminalSessionId?: string;
  terminalInitialCommand?: string;
  terminalWorkingDirectory?: string;
  // For agent tab buffers
  isAgent?: boolean;
  agentSessionId?: string;
  agentBackend?: HarnessRuntimeBackend;
  // Cached syntax highlighting tokens
  tokens: {
    start: number;
    end: number;
    token_type: string;
    class_name: string;
  }[];
}

interface PendingClose {
  bufferId: string;
  type: "single" | "others" | "all" | "to-right";
  keepBufferId?: string;
}

interface BufferState {
  buffers: Buffer[];
  activeBufferId: string | null;
  maxOpenTabs: number;
  pendingClose: PendingClose | null;
  closedBuffersHistory: ClosedBufferHistoryEntry[];
  actions: BufferActions;
}

interface BufferActions {
  openBuffer: (
    path: string,
    name: string,
    content: string,
    isImage?: boolean,
    isSQLite?: boolean,
    isDiff?: boolean,
    isVirtual?: boolean,
    diffData?: GitDiff | MultiFileDiff,
    isMarkdownPreview?: boolean,
    isHtmlPreview?: boolean,
    isCsvPreview?: boolean,
    sourceFilePath?: string,
    isPreview?: boolean,
    isPdf?: boolean,
    isBinary?: boolean,
  ) => string;
  convertPreviewToDefinite: (bufferId: string) => void;
  openExternalEditorBuffer: (path: string, name: string, terminalConnectionId: string) => string;
  openWebViewerBuffer: (url: string) => string;
  openPRBuffer: (prNumber: number) => string;
  openTerminalBuffer: (options?: {
    name?: string;
    command?: string;
    workingDirectory?: string;
  }) => string;
  openAgentBuffer: (
    sessionId?: string,
    options?: {
      backend?: HarnessRuntimeBackend;
    },
  ) => string;
  createAgentBuffer: () => string;
  setAgentBufferTitle: (
    sessionId: string,
    title?: string | null,
    backend?: HarnessRuntimeBackend,
  ) => void;
  closeBuffer: (bufferId: string) => void;
  closeBufferForce: (bufferId: string) => void;
  closeBuffersBatch: (bufferIds: string[], skipSessionSave?: boolean) => void;
  setActiveBuffer: (bufferId: string) => void;
  showNewTabView: () => void;
  updateBufferContent: (
    bufferId: string,
    content: string,
    markDirty?: boolean,
    diffData?: GitDiff | MultiFileDiff,
  ) => void;
  updateBufferTokens: (
    bufferId: string,
    tokens: {
      start: number;
      end: number;
      token_type: string;
      class_name: string;
    }[],
  ) => void;
  markBufferDirty: (bufferId: string, isDirty: boolean) => void;
  updateBufferPath: (bufferId: string, newPath: string) => void;
  updateBuffer: (updatedBuffer: Buffer) => void;
  handleTabClick: (bufferId: string) => void;
  handleTabClose: (bufferId: string) => void;
  handleTabPin: (bufferId: string) => void;
  handleCloseOtherTabs: (keepBufferId: string) => void;
  handleCloseAllTabs: () => void;
  handleCloseTabsToRight: (bufferId: string) => void;
  reorderBuffers: (startIndex: number, endIndex: number) => void;
  switchToNextBuffer: () => void;
  switchToPreviousBuffer: () => void;
  getActiveBuffer: () => Buffer | null;
  setMaxOpenTabs: (max: number) => void;
  reloadBufferFromDisk: (bufferId: string) => Promise<void>;
  setPendingClose: (pending: PendingClose | null) => void;
  confirmCloseWithoutSaving: () => void;
  cancelPendingClose: () => void;
  reopenClosedTab: () => Promise<void>;
  reopenClosedHarnessSession: () => Promise<void>;
}

const generateBufferId = (path: string): string => {
  return `buffer_${path.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
};

let saveSessionTimer: NodeJS.Timeout | null = null;
const SAVE_SESSION_DEBOUNCE_MS = 300;

const getHarnessSessionId = (buffer: Pick<Buffer, "agentSessionId">): string =>
  buffer.agentSessionId ?? DEFAULT_HARNESS_SESSION_KEY;

const getHarnessBufferBackend = (buffer: Pick<Buffer, "agentBackend">): HarnessRuntimeBackend =>
  normalizeHarnessRuntimeBackend(buffer.agentBackend);

const isMatchingHarnessAgentBuffer = (
  buffer: Pick<Buffer, "isAgent" | "agentSessionId" | "agentBackend">,
  sessionId: string,
  backend: HarnessRuntimeBackend,
): boolean =>
  Boolean(
    buffer.isAgent &&
      (buffer.agentSessionId ?? DEFAULT_HARNESS_SESSION_KEY) === sessionId &&
      getHarnessBufferBackend(buffer) === backend,
  );

export const stopHarnessBufferSession = async (
  buffer: Pick<Buffer, "isAgent" | "agentSessionId" | "agentBackend">,
): Promise<void> => {
  if (!buffer.isAgent) return;
  if (getHarnessBufferBackend(buffer) !== DEFAULT_HARNESS_RUNTIME_BACKEND) return;

  const { AcpStreamHandler } = await import("@/utils/acp-handler");
  await AcpStreamHandler.stopAgent(createHarnessChatScopeId(getHarnessSessionId(buffer)));
};

export const isHarnessBufferRunning = async (
  buffer: Pick<Buffer, "isAgent" | "agentSessionId" | "agentBackend">,
): Promise<boolean> => {
  if (!buffer.isAgent) return false;
  if (getHarnessBufferBackend(buffer) !== DEFAULT_HARNESS_RUNTIME_BACKEND) return false;

  const { AcpStreamHandler } = await import("@/utils/acp-handler");
  const status = await AcpStreamHandler.getStatus(
    createHarnessChatScopeId(getHarnessSessionId(buffer)),
  );

  return status.running;
};

export const getRunningHarnessBuffers = async (buffers: Buffer[]): Promise<Buffer[]> => {
  const runningBuffers = await Promise.all(
    buffers.map(async (buffer) => {
      if (!(await isHarnessBufferRunning(buffer))) {
        return null;
      }

      return buffer;
    }),
  );

  return runningBuffers.filter((buffer): buffer is Buffer => buffer !== null);
};

export const serializeProjectSessionBuffers = (buffers: Buffer[]): PersistedBufferSession[] => {
  return buffers
    .filter(
      (b) =>
        !b.isDiff &&
        !b.isImage &&
        !b.isSQLite &&
        !b.isMarkdownPreview &&
        !b.isHtmlPreview &&
        !b.isCsvPreview &&
        !b.isExternalEditor &&
        !b.isWebViewer &&
        !b.isPullRequest &&
        !b.isPdf &&
        !b.isTerminal &&
        (!b.isVirtual || b.isAgent),
    )
    .map((buffer) =>
      buffer.isAgent
        ? {
            kind: "agent" as const,
            sessionId: buffer.agentSessionId ?? DEFAULT_HARNESS_SESSION_KEY,
            backend: getHarnessBufferBackend(buffer),
            name: buffer.name,
            isPinned: buffer.isPinned,
          }
        : {
            kind: "file" as const,
            path: buffer.path,
            name: buffer.name,
            isPinned: buffer.isPinned,
          },
    );
};

export const serializeActiveProjectBuffer = (
  buffers: Buffer[],
  activeBufferId: string | null,
): ActiveSessionBuffer | null => {
  const activeBuffer = buffers.find((b) => b.id === activeBufferId);
  if (!activeBuffer) return null;

  if (activeBuffer.isAgent) {
    return {
      kind: "agent",
      sessionId: activeBuffer.agentSessionId ?? DEFAULT_HARNESS_SESSION_KEY,
      backend: getHarnessBufferBackend(activeBuffer),
    };
  }

  if (
    activeBuffer.isVirtual ||
    activeBuffer.isDiff ||
    activeBuffer.isImage ||
    activeBuffer.isSQLite ||
    activeBuffer.isMarkdownPreview ||
    activeBuffer.isHtmlPreview ||
    activeBuffer.isCsvPreview ||
    activeBuffer.isExternalEditor ||
    activeBuffer.isWebViewer ||
    activeBuffer.isPullRequest ||
    activeBuffer.isPdf ||
    activeBuffer.isTerminal
  ) {
    return null;
  }

  return { kind: "file", path: activeBuffer.path };
};

const saveSessionToStore = (_buffers: Buffer[], _activeBufferId: string | null) => {
  if (saveSessionTimer) clearTimeout(saveSessionTimer);
  saveSessionTimer = setTimeout(() => {
    const { buffers, activeBufferId } = useBufferStore.getState();
    saveSessionToStoreImmediate(buffers, activeBufferId);
    saveSessionTimer = null;
  }, SAVE_SESSION_DEBOUNCE_MS);
};

const saveSessionToStoreImmediate = (buffers: Buffer[], activeBufferId: string | null) => {
  // Get the root folder path from file system store
  // We'll import this dynamically to avoid circular dependencies
  import("@/features/file-system/controllers/store").then(({ useFileSystemStore }) => {
    const rootFolderPath = useFileSystemStore.getState().rootFolderPath;

    if (!rootFolderPath) return;

    const persistableBuffers = serializeProjectSessionBuffers(buffers);
    const activeBuffer = serializeActiveProjectBuffer(buffers, activeBufferId);

    useSessionStore.getState().saveSession(rootFolderPath, persistableBuffers, activeBuffer);
  });
};

export const useBufferStore = createSelectors(
  createWithEqualityFn<BufferState>()(
    immer((set, get) => ({
      buffers: [],
      activeBufferId: null,
      maxOpenTabs: EDITOR_CONSTANTS.MAX_OPEN_TABS,
      pendingClose: null,
      closedBuffersHistory: [],
      actions: {
        openBuffer: (
          path: string,
          name: string,
          content: string,
          isImage = false,
          isSQLite = false,
          isDiff = false,
          isVirtual = false,
          diffData?: GitDiff | MultiFileDiff,
          isMarkdownPreview = false,
          isHtmlPreview = false,
          isCsvPreview = false,
          sourceFilePath?: string,
          isPreview = false,
          isPdf = false,
          isBinary = false,
        ) => {
          const { buffers, maxOpenTabs } = get();

          // Special buffers should never be in preview mode
          const shouldBePreview =
            isPreview &&
            !isImage &&
            !isSQLite &&
            !isDiff &&
            !isVirtual &&
            !isMarkdownPreview &&
            !isHtmlPreview &&
            !isCsvPreview &&
            !isPdf &&
            !isBinary;

          // Check if already open
          const existing = buffers.find((b) => b.path === path);
          if (existing) {
            set((state) => {
              state.activeBufferId = existing.id;
              state.buffers = state.buffers.map((b) => ({
                ...b,
                isActive: b.id === existing.id,
                // If opening in definite mode, convert existing preview to definite
                isPreview: b.id === existing.id && !shouldBePreview ? false : b.isPreview,
              }));
            });
            syncBufferToPane(existing.id);
            saveSessionToStore(get().buffers, get().activeBufferId);
            return existing.id;
          }

          let newBuffers = [...buffers];

          // If opening in preview mode, close any existing preview buffer
          if (shouldBePreview) {
            const existingPreview = newBuffers.find((b) => b.isPreview);
            if (existingPreview) {
              newBuffers = newBuffers.filter((b) => b.id !== existingPreview.id);
            }
          }

          // Handle max tabs limit
          if (newBuffers.filter((b) => !b.isPinned && !b.isPreview).length >= maxOpenTabs) {
            const unpinnedBuffers = newBuffers.filter((b) => !b.isPinned && !b.isPreview);
            const lruBuffer = unpinnedBuffers[0]; // Simplified LRU
            newBuffers = newBuffers.filter((b) => b.id !== lruBuffer.id);
          }

          const newBuffer: Buffer = {
            id: generateBufferId(path),
            path,
            name,
            content,
            savedContent: content,
            isDirty: false,
            isVirtual,
            isPinned: false,
            isPreview: shouldBePreview,
            isImage,
            isSQLite,
            isDiff,
            isMarkdownPreview,
            isHtmlPreview,
            isCsvPreview,
            isExternalEditor: false,
            isWebViewer: false,
            isPullRequest: false,
            isPdf: isPdf,
            isBinary,
            isActive: true,
            language: detectLanguageFromFileName(name),
            diffData,
            sourceFilePath,
            tokens: [],
          };

          set((state) => {
            state.buffers = [...newBuffers.map((b) => ({ ...b, isActive: false })), newBuffer];
            state.activeBufferId = newBuffer.id;
          });

          // Sync with pane store
          syncBufferToPane(newBuffer.id);

          // Track in recent files (only for real files, not virtual/diff/markdown preview buffers)
          if (
            !isVirtual &&
            !isDiff &&
            !isHtmlPreview &&
            !isCsvPreview &&
            !isImage &&
            !isSQLite &&
            !isPdf &&
            !isBinary
          ) {
            useRecentFilesStore.getState().addOrUpdateRecentFile(path, name);

            // Check if extension is available and start LSP or prompt installation
            // First wait for bundled extensions to finish loading
            logger.info("BufferStore", `Checking extension support for ${path}`);
            import("@/extensions/loader/extension-loader")
              .then(({ extensionLoader }) => {
                logger.debug("BufferStore", "Waiting for extension loader initialization...");
                return extensionLoader.waitForInitialization();
              })
              .then(() => {
                logger.debug(
                  "BufferStore",
                  "Extension loader initialized, waiting for extension store...",
                );
                return import("@/extensions/registry/extension-store").then(
                  ({ waitForExtensionStoreInitialization }) =>
                    waitForExtensionStoreInitialization(),
                );
              })
              .then(() => {
                return import("@/extensions/registry/extension-store");
              })
              .then(({ useExtensionStore }) => {
                const { getExtensionForFile } = useExtensionStore.getState().actions;

                const extension = getExtensionForFile(path);
                logger.debug(
                  "BufferStore",
                  `getExtensionForFile(${path}) returned:`,
                  extension?.manifest?.name || "undefined",
                );

                if (extension) {
                  // Bundled extensions don't have installation metadata - they're always available
                  const isBundled = !extension.manifest.installation;
                  const installed = extension.isInstalled || isBundled;
                  logger.info(
                    "BufferStore",
                    `Extension ${extension.manifest.name} for ${path}: installed=${installed}, bundled=${isBundled}`,
                  );

                  if (installed) {
                    // LSP startup is handled by use-lsp-integration for the active editor buffer.
                    // Avoid starting LSP from openBuffer to prevent background/session files from
                    // triggering language servers unexpectedly.
                    logger.debug("BufferStore", `Extension ready for ${path}`);
                  } else {
                    // Marketplace extension not installed, emit event for UI to handle
                    logger.info(
                      "BufferStore",
                      `Extension ${extension.manifest.name} not installed for ${path}`,
                    );

                    // Dispatch custom event for extension installation prompt
                    window.dispatchEvent(
                      new CustomEvent("extension-install-needed", {
                        detail: {
                          extensionId: extension.manifest.id,
                          extensionName: extension.manifest.displayName,
                          filePath: path,
                        },
                      }),
                    );
                  }
                } else {
                  logger.info("BufferStore", `No extension available for ${path}`);
                }
              })
              .catch((error) => {
                logger.error("BufferStore", "Failed to check extension support:", error);
              });
          }

          // Save session
          saveSessionToStore(get().buffers, get().activeBufferId);

          return newBuffer.id;
        },

        openExternalEditorBuffer: (
          path: string,
          name: string,
          terminalConnectionId: string,
        ): string => {
          const { buffers } = get();

          // Check if already open
          const existing = buffers.find((b) => b.path === path);
          if (existing) {
            set((state) => {
              state.activeBufferId = existing.id;
              state.buffers = state.buffers.map((b) => ({
                ...b,
                isActive: b.id === existing.id,
              }));
            });
            syncBufferToPane(existing.id);
            return existing.id;
          }

          // Close any existing external editor buffer (single instance only)
          const existingExternalEditor = buffers.find((b) => b.isExternalEditor);
          let newBuffers = [...buffers];
          if (existingExternalEditor) {
            // Close the old terminal connection
            if (existingExternalEditor.terminalConnectionId) {
              invoke("close_terminal", { id: existingExternalEditor.terminalConnectionId }).catch(
                (e) => {
                  logger.error("BufferStore", "Failed to close old external editor terminal:", e);
                },
              );
            }
            newBuffers = newBuffers.filter((b) => b.id !== existingExternalEditor.id);
          }

          const newBuffer: Buffer = {
            id: generateBufferId(path),
            path,
            name,
            content: "", // External editor buffers don't have content
            savedContent: "",
            isDirty: false,
            isVirtual: false,
            isPinned: false,
            isPreview: false, // External editor buffers are never preview
            isImage: false,
            isSQLite: false,
            isDiff: false,
            isMarkdownPreview: false,
            isHtmlPreview: false,
            isCsvPreview: false,
            isExternalEditor: true,
            isWebViewer: false,
            isPullRequest: false,
            isPdf: false,
            isBinary: false,
            isActive: true,
            language: detectLanguageFromFileName(name),
            terminalConnectionId,
            tokens: [],
          };

          set((state) => {
            state.buffers = [...newBuffers.map((b) => ({ ...b, isActive: false })), newBuffer];
            state.activeBufferId = newBuffer.id;
          });

          // Sync with pane store
          syncBufferToPane(newBuffer.id);

          // Save session
          saveSessionToStore(get().buffers, get().activeBufferId);

          return newBuffer.id;
        },

        openWebViewerBuffer: (url: string): string => {
          const { buffers, maxOpenTabs } = get();

          // Extract hostname for display name
          let displayName = "Web Viewer";
          if (url && url !== "about:blank") {
            try {
              const urlObj = new URL(url);
              if (urlObj.hostname) {
                displayName = `Web: ${urlObj.hostname}`;
              }
            } catch {
              // Invalid URL, use default
            }
          }
          const path = `web-viewer://${url}`;

          // Check if already open with the same URL
          const existing = buffers.find((b) => b.isWebViewer && b.webViewerUrl === url);
          if (existing) {
            set((state) => {
              state.activeBufferId = existing.id;
              state.buffers = state.buffers.map((b) => ({
                ...b,
                isActive: b.id === existing.id,
              }));
            });
            syncBufferToPane(existing.id);
            return existing.id;
          }

          // Handle max tabs limit
          let newBuffers = [...buffers];
          if (newBuffers.filter((b) => !b.isPinned).length >= maxOpenTabs) {
            const unpinnedBuffers = newBuffers.filter((b) => !b.isPinned);
            const lruBuffer = unpinnedBuffers[0];
            newBuffers = newBuffers.filter((b) => b.id !== lruBuffer.id);
          }

          const newBuffer: Buffer = {
            id: generateBufferId(path),
            path,
            name: displayName,
            content: "",
            savedContent: "",
            isDirty: false,
            isVirtual: true,
            isPinned: false,
            isPreview: false, // Web viewer buffers are never preview
            isImage: false,
            isSQLite: false,
            isDiff: false,
            isMarkdownPreview: false,
            isHtmlPreview: false,
            isCsvPreview: false,
            isExternalEditor: false,
            isWebViewer: true,
            isPullRequest: false,
            isPdf: false,
            isBinary: false,
            isActive: true,
            webViewerUrl: url,
            tokens: [],
          };

          set((state) => {
            state.buffers = [...newBuffers.map((b) => ({ ...b, isActive: false })), newBuffer];
            state.activeBufferId = newBuffer.id;
          });

          syncBufferToPane(newBuffer.id);
          saveSessionToStore(get().buffers, get().activeBufferId);
          return newBuffer.id;
        },

        openPRBuffer: (prNumber: number): string => {
          const { buffers, maxOpenTabs } = get();
          const path = `pr://${prNumber}`;
          const displayName = `PR #${prNumber}`;

          // Check if already open
          const existing = buffers.find((b) => b.isPullRequest && b.prNumber === prNumber);
          if (existing) {
            set((state) => {
              state.activeBufferId = existing.id;
              state.buffers = state.buffers.map((b) => ({
                ...b,
                isActive: b.id === existing.id,
              }));
            });
            syncBufferToPane(existing.id);
            return existing.id;
          }

          // Handle max tabs limit
          let newBuffers = [...buffers];
          if (newBuffers.filter((b) => !b.isPinned).length >= maxOpenTabs) {
            const unpinnedBuffers = newBuffers.filter((b) => !b.isPinned);
            const lruBuffer = unpinnedBuffers[0];
            newBuffers = newBuffers.filter((b) => b.id !== lruBuffer.id);
          }

          const newBuffer: Buffer = {
            id: generateBufferId(path),
            path,
            name: displayName,
            content: "",
            savedContent: "",
            isDirty: false,
            isVirtual: true,
            isPinned: false,
            isPreview: false,
            isImage: false,
            isSQLite: false,
            isDiff: false,
            isMarkdownPreview: false,
            isHtmlPreview: false,
            isCsvPreview: false,
            isExternalEditor: false,
            isWebViewer: false,
            isPullRequest: true,
            isPdf: false,
            isBinary: false,
            prNumber,
            isActive: true,
            tokens: [],
          };

          set((state) => {
            state.buffers = [...newBuffers.map((b) => ({ ...b, isActive: false })), newBuffer];
            state.activeBufferId = newBuffer.id;
          });

          syncBufferToPane(newBuffer.id);
          return newBuffer.id;
        },

        openTerminalBuffer: (options?: {
          name?: string;
          command?: string;
          workingDirectory?: string;
        }): string => {
          const { buffers, maxOpenTabs } = get();

          // Count existing terminal buffers to generate next number
          const terminalCount = buffers.filter((b) => b.isTerminal).length;
          const terminalNumber = terminalCount + 1;
          const sessionId = `terminal-tab-${Date.now()}`;
          const path = `terminal://${sessionId}`;
          const displayName = options?.name || `Terminal ${terminalNumber}`;

          // Handle max tabs limit
          let newBuffers = [...buffers];
          if (newBuffers.filter((b) => !b.isPinned).length >= maxOpenTabs) {
            const unpinnedBuffers = newBuffers.filter((b) => !b.isPinned);
            const lruBuffer = unpinnedBuffers[0];
            newBuffers = newBuffers.filter((b) => b.id !== lruBuffer.id);
          }

          const newBuffer: Buffer = {
            id: generateBufferId(path),
            path,
            name: displayName,
            content: "",
            savedContent: "",
            isDirty: false,
            isVirtual: true,
            isPinned: false,
            isPreview: false,
            isImage: false,
            isSQLite: false,
            isDiff: false,
            isMarkdownPreview: false,
            isHtmlPreview: false,
            isCsvPreview: false,
            isExternalEditor: false,
            isWebViewer: false,
            isPullRequest: false,
            isPdf: false,
            isBinary: false,
            isTerminal: true,
            terminalSessionId: sessionId,
            terminalInitialCommand: options?.command,
            terminalWorkingDirectory: options?.workingDirectory,
            isActive: true,
            tokens: [],
          };

          set((state) => {
            state.buffers = [...newBuffers.map((b) => ({ ...b, isActive: false })), newBuffer];
            state.activeBufferId = newBuffer.id;
          });

          syncBufferToPane(newBuffer.id);
          return newBuffer.id;
        },

        openAgentBuffer: (
          sessionId = DEFAULT_HARNESS_SESSION_KEY,
          options?: {
            backend?: HarnessRuntimeBackend;
          },
        ): string => {
          const { buffers, maxOpenTabs } = get();

          const agentSessionId = sessionId;
          const agentBackend = normalizeHarnessRuntimeBackend(options?.backend);
          const existing = buffers.find((buffer) =>
            isMatchingHarnessAgentBuffer(buffer, agentSessionId, agentBackend),
          );
          if (existing) {
            set((state) => {
              state.activeBufferId = existing.id;
              state.buffers = state.buffers.map((b) => ({
                ...b,
                isActive: b.id === existing.id,
              }));
            });
            syncBufferToPane(existing.id);
            return existing.id;
          }

          const path = buildHarnessAgentBufferPath(agentSessionId, agentBackend);
          const displayName = getDefaultHarnessBufferTitle(agentSessionId);

          // Handle max tabs limit
          let newBuffers = [...buffers];
          if (newBuffers.filter((b) => !b.isPinned).length >= maxOpenTabs) {
            const unpinnedBuffers = newBuffers.filter((b) => !b.isPinned);
            const lruBuffer = unpinnedBuffers[0];
            newBuffers = newBuffers.filter((b) => b.id !== lruBuffer.id);
          }

          const newBuffer: Buffer = {
            id: generateBufferId(path),
            path,
            name: displayName,
            content: "",
            savedContent: "",
            isDirty: false,
            isVirtual: true,
            isPinned: false,
            isPreview: false,
            isImage: false,
            isSQLite: false,
            isDiff: false,
            isMarkdownPreview: false,
            isHtmlPreview: false,
            isCsvPreview: false,
            isExternalEditor: false,
            isWebViewer: false,
            isPullRequest: false,
            isPdf: false,
            isBinary: false,
            isAgent: true,
            agentSessionId,
            agentBackend,
            isActive: true,
            tokens: [],
          };

          set((state) => {
            state.buffers = [...newBuffers.map((b) => ({ ...b, isActive: false })), newBuffer];
            state.activeBufferId = newBuffer.id;
          });

          syncBufferToPane(newBuffer.id);
          return newBuffer.id;
        },

        createAgentBuffer: (): string => {
          return get().actions.openAgentBuffer(createHarnessSessionKey());
        },

        setAgentBufferTitle: (
          sessionId: string,
          title?: string | null,
          backend = DEFAULT_HARNESS_RUNTIME_BACKEND,
        ) => {
          set((state) => {
            const buffer = state.buffers.find((entry) =>
              isMatchingHarnessAgentBuffer(entry, sessionId, backend),
            );
            if (!buffer) return;

            const nextTitle = getHarnessBufferTitle(sessionId, title);
            if (buffer.name === nextTitle) return;

            buffer.name = nextTitle;
          });

          saveSessionToStore(get().buffers, get().activeBufferId);
        },

        closeBuffer: (bufferId: string) => {
          const buffer = get().buffers.find((b) => b.id === bufferId);

          if (!buffer) return;

          if (buffer.isAgent) {
            void (async () => {
              try {
                await stopHarnessBufferSession(buffer);
              } catch (error) {
                logger.error(
                  "BufferStore",
                  "Failed to stop Harness session before closing:",
                  error,
                );
              } finally {
                get().actions.closeBufferForce(bufferId);
              }
            })();
            return;
          }

          // Check if buffer has unsaved changes
          if (buffer.isDirty) {
            set((state) => {
              state.pendingClose = {
                bufferId,
                type: "single",
              };
            });
            return;
          }

          // No unsaved changes, close directly
          get().actions.closeBufferForce(bufferId);
        },

        closeBufferForce: (bufferId: string) => {
          const { buffers, activeBufferId, closedBuffersHistory } = get();
          const bufferIndex = buffers.findIndex((b) => b.id === bufferId);

          if (bufferIndex === -1) return;

          cleanupBufferHistoryTracking(bufferId);

          // Remove from pane
          removeBufferFromPanes(bufferId);

          const closedBuffer = buffers[bufferIndex];

          // Close terminal connection for external editor buffers
          if (closedBuffer.isExternalEditor && closedBuffer.terminalConnectionId) {
            invoke("close_terminal", { id: closedBuffer.terminalConnectionId }).catch((e) => {
              logger.error("BufferStore", "Failed to close external editor terminal:", e);
            });
          }

          // Close terminal session for terminal tab buffers
          if (closedBuffer.isTerminal && closedBuffer.terminalSessionId) {
            import("@/features/terminal/stores/terminal-store").then(({ useTerminalStore }) => {
              const session = useTerminalStore
                .getState()
                .getSession(closedBuffer.terminalSessionId!);
              if (session?.connectionId) {
                invoke("close_terminal", { id: session.connectionId }).catch((e) => {
                  logger.error("BufferStore", "Failed to close terminal tab session:", e);
                });
              }
            });
          }

          // Stop LSP for this file (only for real files, not virtual/diff/image/sqlite/external editor/web viewer)
          if (
            !closedBuffer.isVirtual &&
            !closedBuffer.isDiff &&
            !closedBuffer.isImage &&
            !closedBuffer.isSQLite &&
            !closedBuffer.isMarkdownPreview &&
            !closedBuffer.isHtmlPreview &&
            !closedBuffer.isCsvPreview &&
            !closedBuffer.isExternalEditor &&
            !closedBuffer.isWebViewer &&
            !closedBuffer.isPdf
          ) {
            // Stop LSP for this file in background (don't block buffer closing)
            import("@/features/editor/lsp/lsp-client")
              .then(({ LspClient }) => {
                const lspClient = LspClient.getInstance();
                logger.info("BufferStore", `Stopping LSP for ${closedBuffer.path}`);
                return lspClient.stopForFile(closedBuffer.path);
              })
              .catch((error) => {
                logger.error("BufferStore", "Failed to stop LSP:", error);
              });
          }

          const closedBufferEntry = createClosedBufferHistoryEntry(closedBuffer);
          if (closedBufferEntry) {
            const updatedHistory = [closedBufferEntry, ...closedBuffersHistory].slice(
              0,
              EDITOR_CONSTANTS.MAX_CLOSED_BUFFERS_HISTORY,
            );

            set((state) => {
              state.closedBuffersHistory = updatedHistory;
            });
          }

          const newBuffers = buffers.filter((b) => b.id !== bufferId);
          let newActiveId = activeBufferId;

          if (activeBufferId === bufferId) {
            if (newBuffers.length > 0) {
              // Select next or previous buffer
              const newIndex = Math.min(bufferIndex, newBuffers.length - 1);
              newActiveId = newBuffers[newIndex].id;
            } else {
              newActiveId = null;
            }
          }

          set((state) => {
            state.buffers = newBuffers.map((b) => ({
              ...b,
              isActive: b.id === newActiveId,
            }));
            state.activeBufferId = newActiveId;
          });

          // Save session
          saveSessionToStore(get().buffers, get().activeBufferId);
        },

        closeBuffersBatch: (bufferIds: string[], skipSessionSave = false) => {
          if (bufferIds.length === 0) return;

          // Remove from panes
          bufferIds.forEach((id) => removeBufferFromPanes(id));

          set((state) => {
            state.buffers = state.buffers.filter((b) => !bufferIds.includes(b.id));

            if (bufferIds.includes(state.activeBufferId || "")) {
              if (state.buffers.length > 0) {
                state.activeBufferId = state.buffers[0].id;
                state.buffers[0].isActive = true;
              } else {
                state.activeBufferId = null;
              }
            }
          });

          if (!skipSessionSave) {
            saveSessionToStore(get().buffers, get().activeBufferId);
          }
        },

        setActiveBuffer: (bufferId: string) => {
          syncAndFocusBufferInPane(bufferId);
          set((state) => {
            state.activeBufferId = bufferId;
            state.buffers = state.buffers.map((b) => ({
              ...b,
              isActive: b.id === bufferId,
            }));
          });
        },

        showNewTabView: () => {
          set((state) => {
            state.activeBufferId = null;
            state.buffers = state.buffers.map((b) => ({
              ...b,
              isActive: false,
            }));
          });
          // Also clear the active pane's activeBufferId
          const paneStore = usePaneStore.getState();
          const activePane = paneStore.actions.getActivePane();
          if (activePane) {
            paneStore.actions.setActivePaneBuffer(activePane.id, null);
          }
        },

        updateBufferContent: (
          bufferId: string,
          content: string,
          markDirty = true,
          diffData?: GitDiff | MultiFileDiff,
        ) => {
          const buffer = get().buffers.find((b) => b.id === bufferId);
          if (!buffer || (buffer.content === content && !diffData)) {
            // Content hasn't changed and no diff data update, don't update
            return;
          }

          set((state) => {
            const buffer = state.buffers.find((b) => b.id === bufferId);
            if (buffer) {
              buffer.content = content;
              if (diffData) {
                buffer.diffData = diffData;
              }
              if (!buffer.isVirtual) {
                if (!markDirty) {
                  buffer.savedContent = content;
                  buffer.isDirty = false;
                } else {
                  buffer.isDirty = content !== buffer.savedContent;
                  // Convert preview to definite when user makes an edit
                  if (buffer.isPreview && content !== buffer.savedContent) {
                    buffer.isPreview = false;
                  }
                }
              }
              // Keep tokens - syntax highlighter will update them automatically
              // The 16ms debounce ensures smooth updates without glitches
            }
          });
        },

        updateBufferTokens: (bufferId: string, tokens: Buffer["tokens"]) => {
          set((state) => {
            const buffer = state.buffers.find((b) => b.id === bufferId);
            if (buffer) {
              buffer.tokens = tokens;
            }
          });
        },

        markBufferDirty: (bufferId: string, isDirty: boolean) => {
          set((state) => {
            const buffer = state.buffers.find((b) => b.id === bufferId);
            if (buffer) {
              buffer.isDirty = isDirty;
              if (!isDirty) {
                buffer.savedContent = buffer.content;
              }
            }
          });
        },

        updateBufferPath: (bufferId: string, newPath: string) => {
          const newName = newPath.split("/").pop() || newPath;
          set((state) => {
            const buffer = state.buffers.find((b) => b.id === bufferId);
            if (buffer) {
              buffer.path = newPath;
              buffer.name = newName;
              buffer.isVirtual = false;
              buffer.savedContent = buffer.content;
              buffer.language = detectLanguageFromFileName(newName);
            }
          });
        },

        updateBuffer: (updatedBuffer: Buffer) => {
          set((state) => {
            const index = state.buffers.findIndex((b) => b.id === updatedBuffer.id);
            if (index !== -1) {
              state.buffers[index] = updatedBuffer;
            }
          });
        },

        handleTabClick: (bufferId: string) => {
          get().actions.setActiveBuffer(bufferId);
        },

        handleTabClose: (bufferId: string) => {
          get().actions.closeBuffer(bufferId);
        },

        handleTabPin: (bufferId: string) => {
          set((state) => {
            const buffer = state.buffers.find((b) => b.id === bufferId);
            if (buffer) {
              buffer.isPinned = !buffer.isPinned;
              // Pinned tabs should never be in preview mode
              if (buffer.isPinned) {
                buffer.isPreview = false;
              }
            }
          });

          // Save session
          saveSessionToStore(get().buffers, get().activeBufferId);
        },

        convertPreviewToDefinite: (bufferId: string) => {
          set((state) => {
            const buffer = state.buffers.find((b) => b.id === bufferId);
            if (buffer) {
              buffer.isPreview = false;
            }
          });
        },

        handleCloseOtherTabs: (keepBufferId: string) => {
          const { buffers } = get();
          const buffersToClose = buffers.filter((b) => b.id !== keepBufferId && !b.isPinned);

          // Check if any buffer has unsaved changes
          const dirtyBuffer = buffersToClose.find((b) => b.isDirty);
          if (dirtyBuffer) {
            set((state) => {
              state.pendingClose = {
                bufferId: dirtyBuffer.id,
                type: "others",
                keepBufferId,
              };
            });
            return;
          }

          buffersToClose.forEach((buffer) => {
            if (buffer.isAgent) {
              get().actions.closeBuffer(buffer.id);
              return;
            }

            get().actions.closeBufferForce(buffer.id);
          });
        },

        handleCloseAllTabs: () => {
          const { buffers } = get();
          const buffersToClose = buffers.filter((b) => !b.isPinned);

          // Check if any buffer has unsaved changes
          const dirtyBuffer = buffersToClose.find((b) => b.isDirty);
          if (dirtyBuffer) {
            set((state) => {
              state.pendingClose = {
                bufferId: dirtyBuffer.id,
                type: "all",
              };
            });
            return;
          }

          buffersToClose.forEach((buffer) => {
            if (buffer.isAgent) {
              get().actions.closeBuffer(buffer.id);
              return;
            }

            get().actions.closeBufferForce(buffer.id);
          });
        },

        handleCloseTabsToRight: (bufferId: string) => {
          const { buffers } = get();
          const bufferIndex = buffers.findIndex((b) => b.id === bufferId);
          if (bufferIndex === -1) return;

          const buffersToClose = buffers.slice(bufferIndex + 1).filter((b) => !b.isPinned);

          // Check if any buffer has unsaved changes
          const dirtyBuffer = buffersToClose.find((b) => b.isDirty);
          if (dirtyBuffer) {
            set((state) => {
              state.pendingClose = {
                bufferId: dirtyBuffer.id,
                type: "to-right",
              };
            });
            return;
          }

          buffersToClose.forEach((buffer) => {
            if (buffer.isAgent) {
              get().actions.closeBuffer(buffer.id);
              return;
            }

            get().actions.closeBufferForce(buffer.id);
          });
        },

        reorderBuffers: (startIndex: number, endIndex: number) => {
          set((state) => {
            const result = Array.from(state.buffers);
            const [removed] = result.splice(startIndex, 1);
            result.splice(endIndex, 0, removed);
            state.buffers = result;
          });

          // Save session
          saveSessionToStore(get().buffers, get().activeBufferId);
        },

        switchToNextBuffer: () => {
          const paneStore = usePaneStore.getState();
          const activePane = paneStore.actions.getActivePane();
          const paneBufferIds = activePane?.bufferIds ?? [];

          // Prefer pane-aware cycling so tab highlight and editor stay in sync
          if (activePane && paneBufferIds.length > 0) {
            paneStore.actions.switchToNextBufferInPane();
            const updatedActiveBufferId = paneStore.actions.getActivePane()?.activeBufferId;
            if (!updatedActiveBufferId) return;

            set((state) => {
              state.activeBufferId = updatedActiveBufferId;
              state.buffers = state.buffers.map((b) => ({
                ...b,
                isActive: b.id === updatedActiveBufferId,
              }));
            });
            return;
          }

          const { buffers, activeBufferId } = get();
          if (buffers.length === 0) return;

          const currentIndex = buffers.findIndex((b) => b.id === activeBufferId);
          const nextIndex = (currentIndex + 1) % buffers.length;
          const nextBufferId = buffers[nextIndex].id;

          get().actions.setActiveBuffer(nextBufferId);
        },

        switchToPreviousBuffer: () => {
          const paneStore = usePaneStore.getState();
          const activePane = paneStore.actions.getActivePane();
          const paneBufferIds = activePane?.bufferIds ?? [];

          // Prefer pane-aware cycling so tab highlight and editor stay in sync
          if (activePane && paneBufferIds.length > 0) {
            paneStore.actions.switchToPreviousBufferInPane();
            const updatedActiveBufferId = paneStore.actions.getActivePane()?.activeBufferId;
            if (!updatedActiveBufferId) return;

            set((state) => {
              state.activeBufferId = updatedActiveBufferId;
              state.buffers = state.buffers.map((b) => ({
                ...b,
                isActive: b.id === updatedActiveBufferId,
              }));
            });
            return;
          }

          const { buffers, activeBufferId } = get();
          if (buffers.length === 0) return;

          const currentIndex = buffers.findIndex((b) => b.id === activeBufferId);
          const prevIndex = (currentIndex - 1 + buffers.length) % buffers.length;
          const prevBufferId = buffers[prevIndex].id;

          get().actions.setActiveBuffer(prevBufferId);
        },

        getActiveBuffer: (): Buffer | null => {
          const { buffers, activeBufferId } = get();
          return buffers.find((b) => b.id === activeBufferId) || null;
        },

        setMaxOpenTabs: (max: number) => {
          set((state) => {
            state.maxOpenTabs = max;
          });
        },

        reloadBufferFromDisk: async (bufferId: string): Promise<void> => {
          const buffer = get().buffers.find((b) => b.id === bufferId);
          if (
            !buffer ||
            buffer.isVirtual ||
            buffer.isImage ||
            buffer.isSQLite ||
            buffer.isMarkdownPreview ||
            buffer.isHtmlPreview ||
            buffer.isCsvPreview ||
            buffer.isWebViewer
          ) {
            return;
          }

          try {
            const content = await readFileContent(buffer.path);
            // Update buffer content and clear dirty flag
            useBufferStore.getState().actions.updateBufferContent(bufferId, content, false);
            logger.debug("Editor", `[FileWatcher] Reloaded buffer from disk: ${buffer.path}`);
          } catch (error) {
            logger.error(
              "Editor",
              `[FileWatcher] Failed to reload buffer from disk: ${buffer.path}`,
              error,
            );
          }
        },

        setPendingClose: (pending: PendingClose | null) => {
          set((state) => {
            state.pendingClose = pending;
          });
        },

        confirmCloseWithoutSaving: () => {
          const { pendingClose } = get();
          if (!pendingClose) return;

          const { bufferId, type, keepBufferId } = pendingClose;

          // Clear pending close first
          set((state) => {
            state.pendingClose = null;
          });

          // Execute the close operation based on type
          switch (type) {
            case "single":
              get().actions.closeBufferForce(bufferId);
              break;
            case "others":
              if (keepBufferId) {
                const { buffers } = get();
                const buffersToClose = buffers.filter((b) => b.id !== keepBufferId && !b.isPinned);
                buffersToClose.forEach((buffer) => {
                  if (buffer.isAgent) {
                    get().actions.closeBuffer(buffer.id);
                    return;
                  }

                  get().actions.closeBufferForce(buffer.id);
                });
              }
              break;
            case "all":
              {
                const { buffers } = get();
                const buffersToClose = buffers.filter((b) => !b.isPinned);
                buffersToClose.forEach((buffer) => {
                  if (buffer.isAgent) {
                    get().actions.closeBuffer(buffer.id);
                    return;
                  }

                  get().actions.closeBufferForce(buffer.id);
                });
              }
              break;
            case "to-right":
              {
                const { buffers } = get();
                const bufferIndex = buffers.findIndex((b) => b.id === bufferId);
                if (bufferIndex !== -1) {
                  const buffersToClose = buffers.slice(bufferIndex + 1).filter((b) => !b.isPinned);
                  buffersToClose.forEach((buffer) => {
                    if (buffer.isAgent) {
                      get().actions.closeBuffer(buffer.id);
                      return;
                    }

                    get().actions.closeBufferForce(buffer.id);
                  });
                }
              }
              break;
          }
        },

        cancelPendingClose: () => {
          set((state) => {
            state.pendingClose = null;
          });
        },

        reopenClosedTab: async () => {
          const { closedBuffersHistory } = get();

          if (closedBuffersHistory.length === 0) {
            return;
          }

          // Get the most recent closed buffer
          const [closedBuffer, ...remainingHistory] = closedBuffersHistory;

          // Remove it from history
          set((state) => {
            state.closedBuffersHistory = remainingHistory;
          });

          if (closedBuffer.kind === "agent") {
            const bufferId = get().actions.openAgentBuffer(closedBuffer.sessionId, {
              backend: closedBuffer.backend,
            });
            const reopenedBuffer = get().buffers.find((buffer) => buffer.id === bufferId);
            if (reopenedBuffer && reopenedBuffer.isPinned !== closedBuffer.isPinned) {
              get().actions.handleTabPin(reopenedBuffer.id);
            }
            return;
          }

          try {
            // Read the file content and reopen it
            const content = await readFileContent(closedBuffer.path);
            const bufferId = get().actions.openBuffer(
              closedBuffer.path,
              closedBuffer.name,
              content,
              false,
              false,
              false,
              false,
            );

            // Restore pinned state if it was pinned
            if (closedBuffer.isPinned) {
              get().actions.handleTabPin(bufferId);
            }
          } catch (error) {
            logger.warn("Editor", `Failed to reopen closed tab: ${closedBuffer.path}`, error);
          }
        },

        reopenClosedHarnessSession: async () => {
          const { closedBuffersHistory } = get();
          const closedHarnessSession = getMostRecentClosedHarnessSession(closedBuffersHistory);

          if (!closedHarnessSession) {
            return;
          }

          set((state) => {
            state.closedBuffersHistory = state.closedBuffersHistory.filter(
              (entry) =>
                !(
                  entry.kind === "agent" &&
                  entry.sessionId === closedHarnessSession.sessionId &&
                  entry.backend === closedHarnessSession.backend &&
                  entry.name === closedHarnessSession.name
                ),
            );
          });

          const bufferId = get().actions.openAgentBuffer(closedHarnessSession.sessionId, {
            backend: closedHarnessSession.backend,
          });
          const reopenedBuffer = get().buffers.find((buffer) => buffer.id === bufferId);
          if (reopenedBuffer && reopenedBuffer.isPinned !== closedHarnessSession.isPinned) {
            get().actions.handleTabPin(reopenedBuffer.id);
          }
        },
      },
    })),
    isEqual,
  ),
);
