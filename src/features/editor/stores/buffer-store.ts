import { invoke } from "@tauri-apps/api/core";
import isEqual from "fast-deep-equal";
import { immer } from "zustand/middleware/immer";
import { createWithEqualityFn } from "zustand/traditional";
import type { DatabaseType } from "@/features/database/models/provider.types";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import { detectLanguageFromFileName } from "@/features/editor/utils/language-detection";
import { logger } from "@/features/editor/utils/logger";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { useRecentFilesStore } from "@/features/file-system/controllers/recent-files-store";
import type { MultiFileDiff } from "@/features/git/types/git-diff-types";
import type { GitDiff } from "@/features/git/types/git-types";
import { usePaneStore } from "@/features/panes/stores/pane-store";
import { cleanupBufferHistoryTracking } from "@/features/editor/stores/editor-app-store";
import type {
  EditorContent,
  OpenContentSpec,
  PaneContent,
  TokenEntry,
} from "@/features/panes/types/pane-content";
import {
  isEditorContent,
  isEditableContent,
  isPersistableContent,
  isVirtualContent,
  shouldStartLsp,
} from "@/features/panes/types/pane-content";
import { useSessionStore } from "@/features/window/stores/session-store";
import { createSelectors } from "@/utils/zustand-selectors";

/** @deprecated Use `PaneContent` directly. Kept for backward compatibility. */
export type Buffer = PaneContent;

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

/**
 * Close any new-tab placeholder in the active pane and return filtered buffers.
 */
const closeNewTabInActivePane = (buffers: PaneContent[]): PaneContent[] => {
  const paneStore = usePaneStore.getState();
  const activePane = paneStore.actions.getActivePane();
  const paneBufferIds = activePane?.bufferIds ?? [];
  const newTabBuffer = buffers.find((b) => b.type === "newTab" && paneBufferIds.includes(b.id));
  if (newTabBuffer) {
    removeBufferFromPanes(newTabBuffer.id);
    return buffers.filter((b) => b.id !== newTabBuffer.id);
  }
  return buffers;
};

interface PendingClose {
  bufferId: string;
  type: "single" | "others" | "all" | "to-right";
  keepBufferId?: string;
}

interface ClosedBuffer {
  path: string;
  name: string;
  isPinned: boolean;
}

interface BufferState {
  buffers: PaneContent[];
  activeBufferId: string | null;
  maxOpenTabs: number;
  pendingClose: PendingClose | null;
  closedBuffersHistory: ClosedBuffer[];
  actions: BufferActions;
}

interface BufferActions {
  openContent: (spec: OpenContentSpec) => string;
  openBuffer: (
    path: string,
    name: string,
    content: string,
    isImage?: boolean,
    databaseType?: DatabaseType,
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
    connectionId?: string,
  ) => string;
  openDatabaseBuffer: (
    path: string,
    name: string,
    databaseType: DatabaseType,
    connectionId?: string,
  ) => string;
  convertPreviewToDefinite: (bufferId: string) => void;
  openExternalEditorBuffer: (path: string, name: string, terminalConnectionId: string) => string;
  openWebViewerBuffer: (url: string) => string;
  openPRBuffer: (prNumber: number) => string;
  openTerminalBuffer: (options?: {
    name?: string;
    command?: string;
    workingDirectory?: string;
    remoteConnectionId?: string;
  }) => string;
  openAgentBuffer: (sessionId?: string) => string;
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
  updateBufferTokens: (bufferId: string, tokens: TokenEntry[]) => void;
  markBufferDirty: (bufferId: string, isDirty: boolean) => void;
  updateBufferPath: (bufferId: string, newPath: string) => void;
  updateBuffer: (updatedBuffer: PaneContent) => void;
  handleTabClick: (bufferId: string) => void;
  handleTabClose: (bufferId: string) => void;
  handleTabPin: (bufferId: string) => void;
  handleCloseOtherTabs: (keepBufferId: string) => void;
  handleCloseAllTabs: () => void;
  handleCloseTabsToRight: (bufferId: string) => void;
  reorderBuffers: (startIndex: number, endIndex: number) => void;
  switchToNextBuffer: () => void;
  switchToPreviousBuffer: () => void;
  getActiveBuffer: () => PaneContent | null;
  setMaxOpenTabs: (max: number) => void;
  reloadBufferFromDisk: (bufferId: string) => Promise<void>;
  setPendingClose: (pending: PendingClose | null) => void;
  confirmCloseWithoutSaving: () => void;
  cancelPendingClose: () => void;
  reopenClosedTab: () => Promise<void>;
}

const generateBufferId = (path: string): string => {
  return `buffer_${path.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
};

let saveSessionTimer: NodeJS.Timeout | null = null;
const SAVE_SESSION_DEBOUNCE_MS = 300;

const saveSessionToStore = (_buffers: PaneContent[], _activeBufferId: string | null) => {
  if (saveSessionTimer) clearTimeout(saveSessionTimer);
  saveSessionTimer = setTimeout(() => {
    const { buffers, activeBufferId } = useBufferStore.getState();
    saveSessionToStoreImmediate(buffers, activeBufferId);
    saveSessionTimer = null;
  }, SAVE_SESSION_DEBOUNCE_MS);
};

const saveSessionToStoreImmediate = (buffers: PaneContent[], activeBufferId: string | null) => {
  import("@/features/file-system/controllers/store").then(({ useFileSystemStore }) => {
    const rootFolderPath = useFileSystemStore.getState().rootFolderPath;

    if (!rootFolderPath) return;

    const persistableBuffers = buffers
      .filter((b) => isPersistableContent(b))
      .map((b) => ({
        path: b.path,
        name: b.name,
        isPinned: b.isPinned,
      }));

    const activeBuffer = buffers.find((b) => b.id === activeBufferId);
    const activeBufferPath =
      activeBuffer && isPersistableContent(activeBuffer) ? activeBuffer.path : null;

    useSessionStore.getState().saveSession(rootFolderPath, persistableBuffers, activeBufferPath);
  });
};

/**
 * Create a PaneContent variant from an OpenContentSpec.
 * Used internally by openContent; also handles the "editor" type's complex logic
 * (preview mode, max tabs, extension checking, recent files) in the openContent action itself.
 */
const createPaneContent = (id: string, spec: OpenContentSpec): PaneContent => {
  const base = {
    id,
    isPinned: false,
    isActive: true,
  };

  switch (spec.type) {
    case "editor":
      return {
        ...base,
        type: "editor",
        path: spec.path,
        name: spec.name,
        content: spec.content,
        savedContent: spec.content,
        isDirty: false,
        isVirtual: spec.isVirtual ?? false,
        isPreview: spec.isPreview ?? false,
        language: spec.language ?? detectLanguageFromFileName(spec.name),
        tokens: [],
      };
    case "terminal":
      return {
        ...base,
        type: "terminal",
        path: `terminal://${id}`,
        name: spec.name ?? "Terminal",
        isPreview: false,
        sessionId: id.replace("buffer_", ""),
        initialCommand: spec.command,
        workingDirectory: spec.workingDirectory,
        remoteConnectionId: spec.remoteConnectionId,
      };
    case "agent":
      return {
        ...base,
        type: "agent",
        path: `agent://${spec.sessionId ?? id}`,
        name: "Agent",
        isPreview: false,
        sessionId: spec.sessionId ?? id.replace("buffer_", ""),
      };
    case "webViewer":
      return {
        ...base,
        type: "webViewer",
        path: `web-viewer://${spec.url}`,
        name: "Web Viewer",
        isPreview: false,
        url: spec.url,
      };
    case "newTab":
      return {
        ...base,
        type: "newTab",
        path: `newtab://${id}`,
        name: "New Tab",
        isPreview: false,
      };
    case "diff":
      return {
        ...base,
        type: "diff",
        path: spec.path,
        name: spec.name,
        isPreview: false,
        content: spec.content,
        savedContent: spec.content,
        diffData: spec.diffData,
      };
    case "image":
      return {
        ...base,
        type: "image",
        path: spec.path,
        name: spec.name,
        isPreview: false,
      };
    case "pdf":
      return {
        ...base,
        type: "pdf",
        path: spec.path,
        name: spec.name,
        isPreview: false,
      };
    case "binary":
      return {
        ...base,
        type: "binary",
        path: spec.path,
        name: spec.name,
        isPreview: false,
      };
    case "database":
      return {
        ...base,
        type: "database",
        path: spec.path,
        name: spec.name,
        isPreview: false,
        databaseType: spec.databaseType,
        connectionId: spec.connectionId,
      };
    case "pullRequest":
      return {
        ...base,
        type: "pullRequest",
        path: `pr://${spec.prNumber}`,
        name: `PR #${spec.prNumber}`,
        isPreview: false,
        prNumber: spec.prNumber,
      };
    case "markdownPreview":
      return {
        ...base,
        type: "markdownPreview",
        path: spec.path,
        name: spec.name,
        isPreview: false,
        content: spec.content,
        sourceFilePath: spec.sourceFilePath,
      };
    case "htmlPreview":
      return {
        ...base,
        type: "htmlPreview",
        path: spec.path,
        name: spec.name,
        isPreview: false,
        content: spec.content,
        sourceFilePath: spec.sourceFilePath,
      };
    case "csvPreview":
      return {
        ...base,
        type: "csvPreview",
        path: spec.path,
        name: spec.name,
        isPreview: false,
        content: spec.content,
        sourceFilePath: spec.sourceFilePath,
      };
    case "externalEditor":
      return {
        ...base,
        type: "externalEditor",
        path: spec.path,
        name: spec.name,
        isPreview: false,
        terminalConnectionId: spec.terminalConnectionId,
      };
  }
};

/**
 * Run extension checking and LSP logic for a newly opened editor file.
 */
const checkExtensionSupport = (path: string) => {
  logger.info("BufferStore", `Checking extension support for ${path}`);
  import("@/extensions/loader/extension-loader")
    .then(({ extensionLoader }) => {
      logger.debug("BufferStore", "Waiting for extension loader initialization...");
      return extensionLoader.waitForInitialization();
    })
    .then(() => {
      logger.debug("BufferStore", "Extension loader initialized, waiting for extension store...");
      return import("@/extensions/registry/extension-store").then(
        ({ waitForExtensionStoreInitialization }) => waitForExtensionStoreInitialization(),
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
        const isBundled = !extension.manifest.installation;
        const installed = extension.isInstalled || isBundled;
        logger.info(
          "BufferStore",
          `Extension ${extension.manifest.name} for ${path}: installed=${installed}, bundled=${isBundled}`,
        );

        if (installed) {
          logger.debug("BufferStore", `Extension ready for ${path}`);
        } else {
          logger.info(
            "BufferStore",
            `Extension ${extension.manifest.name} not installed for ${path}`,
          );

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
        openContent: (spec: OpenContentSpec): string => {
          const { buffers, maxOpenTabs } = get();

          switch (spec.type) {
            case "editor": {
              // Special buffers should never be in preview mode
              const shouldBePreview = spec.isPreview ?? false;

              // Check if already open
              const existing = buffers.find((b) => b.path === spec.path);
              if (existing) {
                set((state) => {
                  state.activeBufferId = existing.id;
                  state.buffers = state.buffers.map((b) => ({
                    ...b,
                    isActive: b.id === existing.id,
                    isPreview: b.id === existing.id && !shouldBePreview ? false : b.isPreview,
                  }));
                });
                syncBufferToPane(existing.id);
                return existing.id;
              }

              let newBuffers = closeNewTabInActivePane([...buffers]);

              if (shouldBePreview) {
                const existingPreview = newBuffers.find((b) => b.isPreview);
                if (existingPreview) {
                  newBuffers = newBuffers.filter((b) => b.id !== existingPreview.id);
                }
              }

              if (newBuffers.filter((b) => !b.isPinned && !b.isPreview).length >= maxOpenTabs) {
                const unpinnedBuffers = newBuffers.filter((b) => !b.isPinned && !b.isPreview);
                const lruBuffer = unpinnedBuffers[0];
                newBuffers = newBuffers.filter((b) => b.id !== lruBuffer.id);
              }

              const id = generateBufferId(spec.path);
              const newBuffer = createPaneContent(id, spec) as EditorContent;

              set((state) => {
                state.buffers = [...newBuffers.map((b) => ({ ...b, isActive: false })), newBuffer];
                state.activeBufferId = newBuffer.id;
              });

              syncBufferToPane(newBuffer.id);

              // Track in recent files and check extensions (only for real files)
              if (shouldStartLsp(newBuffer)) {
                useRecentFilesStore.getState().addOrUpdateRecentFile(spec.path, spec.name);
                checkExtensionSupport(spec.path);
              }

              saveSessionToStore(get().buffers, get().activeBufferId);
              return newBuffer.id;
            }

            case "terminal": {
              const terminalCount = buffers.filter((b) => b.type === "terminal").length;
              const terminalNumber = terminalCount + 1;
              const sessionId = `terminal-tab-${Date.now()}`;
              const path = `terminal://${sessionId}`;
              const displayName = spec.name ?? `Terminal ${terminalNumber}`;

              let newBuffers = closeNewTabInActivePane([...buffers]);
              if (newBuffers.filter((b) => !b.isPinned).length >= maxOpenTabs) {
                const unpinnedBuffers = newBuffers.filter((b) => !b.isPinned);
                const lruBuffer = unpinnedBuffers[0];
                newBuffers = newBuffers.filter((b) => b.id !== lruBuffer.id);
              }

              const id = generateBufferId(path);
              const newBuffer = createPaneContent(id, {
                ...spec,
                name: displayName,
              });
              // Override the auto-generated sessionId with our specific one
              (newBuffer as PaneContent & { sessionId: string }).sessionId = sessionId;
              newBuffer.path = path;
              newBuffer.name = displayName;

              set((state) => {
                state.buffers = [...newBuffers.map((b) => ({ ...b, isActive: false })), newBuffer];
                state.activeBufferId = newBuffer.id;
              });

              syncBufferToPane(newBuffer.id);
              return newBuffer.id;
            }

            case "agent": {
              const agentCount = buffers.filter((b) => b.type === "agent").length;

              // If sessionId provided, check if already open
              if (spec.sessionId) {
                const existing = buffers.find(
                  (b) => b.type === "agent" && b.sessionId === spec.sessionId,
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
              }

              const agentNumber = agentCount + 1;
              const agentSessionId = spec.sessionId ?? `agent-tab-${Date.now()}`;
              const path = `agent://${agentSessionId}`;
              const displayName = `Agent ${agentNumber}`;

              let newBuffers = closeNewTabInActivePane([...buffers]);
              if (newBuffers.filter((b) => !b.isPinned).length >= maxOpenTabs) {
                const unpinnedBuffers = newBuffers.filter((b) => !b.isPinned);
                const lruBuffer = unpinnedBuffers[0];
                newBuffers = newBuffers.filter((b) => b.id !== lruBuffer.id);
              }

              const id = generateBufferId(path);
              const newBuffer = createPaneContent(id, {
                ...spec,
                sessionId: agentSessionId,
              });
              newBuffer.path = path;
              newBuffer.name = displayName;

              set((state) => {
                state.buffers = [...newBuffers.map((b) => ({ ...b, isActive: false })), newBuffer];
                state.activeBufferId = newBuffer.id;
              });

              syncBufferToPane(newBuffer.id);
              return newBuffer.id;
            }

            case "webViewer": {
              let displayName = "Web Viewer";
              if (spec.url && spec.url !== "about:blank") {
                try {
                  const urlObj = new URL(spec.url);
                  if (urlObj.hostname) {
                    displayName = `Web: ${urlObj.hostname}`;
                  }
                } catch {
                  // Invalid URL, use default
                }
              }
              const path = `web-viewer://${spec.url}`;

              const existing = buffers.find((b) => b.type === "webViewer" && b.url === spec.url);
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

              let newBuffers = closeNewTabInActivePane([...buffers]);
              if (newBuffers.filter((b) => !b.isPinned).length >= maxOpenTabs) {
                const unpinnedBuffers = newBuffers.filter((b) => !b.isPinned);
                const lruBuffer = unpinnedBuffers[0];
                newBuffers = newBuffers.filter((b) => b.id !== lruBuffer.id);
              }

              const id = generateBufferId(path);
              const newBuffer = createPaneContent(id, spec);
              newBuffer.path = path;
              newBuffer.name = displayName;

              set((state) => {
                state.buffers = [...newBuffers.map((b) => ({ ...b, isActive: false })), newBuffer];
                state.activeBufferId = newBuffer.id;
              });

              syncBufferToPane(newBuffer.id);
              return newBuffer.id;
            }

            case "newTab": {
              const paneStore = usePaneStore.getState();
              const activePane = paneStore.actions.getActivePane();
              const paneBufferIds = activePane?.bufferIds ?? [];
              const existingNewTab = buffers.find(
                (b) => b.type === "newTab" && paneBufferIds.includes(b.id),
              );

              if (existingNewTab) {
                set((state) => {
                  state.activeBufferId = existingNewTab.id;
                  state.buffers = state.buffers.map((b) => ({
                    ...b,
                    isActive: b.id === existingNewTab.id,
                  }));
                });
                if (activePane) {
                  paneStore.actions.setActivePaneBuffer(activePane.id, existingNewTab.id);
                }
                return existingNewTab.id;
              }

              const newTabId = `buffer_new_tab_${Date.now()}`;
              const newBuffer = createPaneContent(newTabId, spec);

              set((state) => {
                state.buffers = state.buffers
                  .map((b) => ({ ...b, isActive: false }))
                  .concat(newBuffer);
                state.activeBufferId = newTabId;
              });

              syncBufferToPane(newTabId);
              return newTabId;
            }

            case "pullRequest": {
              const path = `pr://${spec.prNumber}`;
              const existing = buffers.find(
                (b) => b.type === "pullRequest" && b.prNumber === spec.prNumber,
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

              let newBuffers = closeNewTabInActivePane([...buffers]);
              if (newBuffers.filter((b) => !b.isPinned).length >= maxOpenTabs) {
                const unpinnedBuffers = newBuffers.filter((b) => !b.isPinned);
                const lruBuffer = unpinnedBuffers[0];
                newBuffers = newBuffers.filter((b) => b.id !== lruBuffer.id);
              }

              const id = generateBufferId(path);
              const newBuffer = createPaneContent(id, spec);

              set((state) => {
                state.buffers = [...newBuffers.map((b) => ({ ...b, isActive: false })), newBuffer];
                state.activeBufferId = newBuffer.id;
              });

              syncBufferToPane(newBuffer.id);
              return newBuffer.id;
            }

            case "externalEditor": {
              const existing = buffers.find((b) => b.path === spec.path);
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

              const existingExternalEditor = buffers.find((b) => b.type === "externalEditor");
              let newBuffers = closeNewTabInActivePane([...buffers]);
              if (existingExternalEditor) {
                if (existingExternalEditor.type === "externalEditor") {
                  invoke("close_terminal", {
                    id: existingExternalEditor.terminalConnectionId,
                  }).catch((e) => {
                    logger.error("BufferStore", "Failed to close old external editor terminal:", e);
                  });
                }
                newBuffers = newBuffers.filter((b) => b.id !== existingExternalEditor.id);
              }

              const id = generateBufferId(spec.path);
              const newBuffer = createPaneContent(id, spec);

              set((state) => {
                state.buffers = [...newBuffers.map((b) => ({ ...b, isActive: false })), newBuffer];
                state.activeBufferId = newBuffer.id;
              });

              syncBufferToPane(newBuffer.id);
              saveSessionToStore(get().buffers, get().activeBufferId);
              return newBuffer.id;
            }

            case "diff":
            case "image":
            case "pdf":
            case "binary":
            case "database":
            case "markdownPreview":
            case "htmlPreview":
            case "csvPreview": {
              const path = spec.path;
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

              let newBuffers = closeNewTabInActivePane([...buffers]);
              if (newBuffers.filter((b) => !b.isPinned && !b.isPreview).length >= maxOpenTabs) {
                const unpinnedBuffers = newBuffers.filter((b) => !b.isPinned && !b.isPreview);
                const lruBuffer = unpinnedBuffers[0];
                newBuffers = newBuffers.filter((b) => b.id !== lruBuffer.id);
              }

              const id = generateBufferId(path);
              const newBuffer = createPaneContent(id, spec);

              set((state) => {
                state.buffers = [...newBuffers.map((b) => ({ ...b, isActive: false })), newBuffer];
                state.activeBufferId = newBuffer.id;
              });

              syncBufferToPane(newBuffer.id);
              saveSessionToStore(get().buffers, get().activeBufferId);
              return newBuffer.id;
            }
          }
        },

        openBuffer: (
          path: string,
          name: string,
          content: string,
          isImage = false,
          databaseType?: DatabaseType,
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
          connectionId?: string,
        ) => {
          // Map the old boolean-flag API to the new OpenContentSpec
          if (isImage) {
            return get().actions.openContent({ type: "image", path, name });
          }
          if (isPdf) {
            return get().actions.openContent({ type: "pdf", path, name });
          }
          if (isBinary) {
            return get().actions.openContent({ type: "binary", path, name });
          }
          if (databaseType) {
            return get().actions.openContent({
              type: "database",
              path,
              name,
              databaseType,
              connectionId,
            });
          }
          if (isDiff) {
            return get().actions.openContent({
              type: "diff",
              path,
              name,
              content,
              diffData,
            });
          }
          if (isMarkdownPreview) {
            return get().actions.openContent({
              type: "markdownPreview",
              path,
              name,
              content,
              sourceFilePath: sourceFilePath ?? path,
            });
          }
          if (isHtmlPreview) {
            return get().actions.openContent({
              type: "htmlPreview",
              path,
              name,
              content,
              sourceFilePath: sourceFilePath ?? path,
            });
          }
          if (isCsvPreview) {
            return get().actions.openContent({
              type: "csvPreview",
              path,
              name,
              content,
              sourceFilePath: sourceFilePath ?? path,
            });
          }

          // Default: editor content
          // Special buffers should never be in preview mode
          const shouldBePreview = isPreview && !isVirtual;

          return get().actions.openContent({
            type: "editor",
            path,
            name,
            content,
            isVirtual,
            isPreview: shouldBePreview,
            language: detectLanguageFromFileName(name),
          });
        },

        openExternalEditorBuffer: (
          path: string,
          name: string,
          terminalConnectionId: string,
        ): string => {
          return get().actions.openContent({
            type: "externalEditor",
            path,
            name,
            terminalConnectionId,
          });
        },

        openWebViewerBuffer: (url: string): string => {
          return get().actions.openContent({ type: "webViewer", url });
        },

        openPRBuffer: (prNumber: number): string => {
          return get().actions.openContent({ type: "pullRequest", prNumber });
        },

        openTerminalBuffer: (options?: {
          name?: string;
          command?: string;
          workingDirectory?: string;
          remoteConnectionId?: string;
        }): string => {
          return get().actions.openContent({
            type: "terminal",
            name: options?.name,
            command: options?.command,
            workingDirectory: options?.workingDirectory,
            remoteConnectionId: options?.remoteConnectionId,
          });
        },

        openAgentBuffer: (sessionId?: string): string => {
          return get().actions.openContent({ type: "agent", sessionId });
        },

        closeBuffer: (bufferId: string) => {
          const buffer = get().buffers.find((b) => b.id === bufferId);

          if (!buffer) return;

          // Only EditorContent can be dirty
          if (isEditorContent(buffer) && buffer.isDirty) {
            set((state) => {
              state.pendingClose = {
                bufferId,
                type: "single",
              };
            });
            return;
          }

          get().actions.closeBufferForce(bufferId);
        },

        closeBufferForce: (bufferId: string) => {
          const { buffers, activeBufferId, closedBuffersHistory } = get();
          const bufferIndex = buffers.findIndex((b) => b.id === bufferId);

          if (bufferIndex === -1) return;

          cleanupBufferHistoryTracking(bufferId);

          removeBufferFromPanes(bufferId);

          const closedBuffer = buffers[bufferIndex];

          // Close terminal connection for external editor buffers
          if (closedBuffer.type === "externalEditor") {
            invoke("close_terminal", { id: closedBuffer.terminalConnectionId }).catch((e) => {
              logger.error("BufferStore", "Failed to close external editor terminal:", e);
            });
          }

          // Close terminal session for terminal tab buffers
          if (closedBuffer.type === "terminal") {
            import("@/features/terminal/stores/terminal-store").then(({ useTerminalStore }) => {
              const session = useTerminalStore.getState().getSession(closedBuffer.sessionId);
              if (session?.connectionId) {
                invoke("close_terminal", { id: session.connectionId }).catch((e) => {
                  logger.error("BufferStore", "Failed to close terminal tab session:", e);
                });
              }
            });
          }

          // Stop LSP for this file (only for real editor files)
          if (shouldStartLsp(closedBuffer)) {
            import("@/features/editor/lsp/lsp-client")
              .then(({ LspClient }) => {
                const lspClient = LspClient.getInstance();
                logger.info("BufferStore", `Stopping LSP for ${closedBuffer.path}`);
                return lspClient.stopForFile(closedBuffer.path);
              })
              .catch((error) => {
                logger.error("BufferStore", "Failed to stop LSP:", error);
              });

            // Add to closed history
            const closedBufferInfo: ClosedBuffer = {
              path: closedBuffer.path,
              name: closedBuffer.name,
              isPinned: closedBuffer.isPinned,
            };

            const updatedHistory = [closedBufferInfo, ...closedBuffersHistory].slice(
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

          saveSessionToStore(get().buffers, get().activeBufferId);
        },

        closeBuffersBatch: (bufferIds: string[], skipSessionSave = false) => {
          if (bufferIds.length === 0) return;

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
          get().actions.openContent({ type: "newTab" });
        },

        updateBufferContent: (
          bufferId: string,
          content: string,
          markDirty = true,
          diffData?: GitDiff | MultiFileDiff,
        ) => {
          const buffer = get().buffers.find((b) => b.id === bufferId);
          if (!buffer) return;

          // Only content types with text content can be updated
          if (!isEditableContent(buffer)) return;

          if (buffer.content === content && !diffData) return;

          set((state) => {
            const buf = state.buffers.find((b) => b.id === bufferId);
            if (!buf || !isEditableContent(buf)) return;

            buf.content = content;
            if (diffData && buf.type === "diff") {
              buf.diffData = diffData;
            }
            if (buf.type === "editor" && !buf.isVirtual) {
              if (!markDirty) {
                buf.savedContent = content;
                buf.isDirty = false;
              } else {
                buf.isDirty = content !== buf.savedContent;
                if (buf.isPreview && content !== buf.savedContent) {
                  buf.isPreview = false;
                }
              }
            } else if (buf.type === "diff") {
              buf.savedContent = content;
            }
          });
        },

        updateBufferTokens: (bufferId: string, tokens: TokenEntry[]) => {
          set((state) => {
            const buffer = state.buffers.find((b) => b.id === bufferId);
            if (buffer && isEditorContent(buffer)) {
              buffer.tokens = tokens;
            }
          });
        },

        markBufferDirty: (bufferId: string, isDirty: boolean) => {
          set((state) => {
            const buffer = state.buffers.find((b) => b.id === bufferId);
            if (buffer && isEditorContent(buffer)) {
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
            if (buffer && isEditorContent(buffer)) {
              buffer.path = newPath;
              buffer.name = newName;
              buffer.isVirtual = false;
              buffer.savedContent = buffer.content;
              buffer.language = detectLanguageFromFileName(newName);
            }
          });
        },

        updateBuffer: (updatedBuffer: PaneContent) => {
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
              if (buffer.isPinned) {
                buffer.isPreview = false;
              }
            }
          });

          saveSessionToStore(get().buffers, get().activeBufferId);
        },

        openDatabaseBuffer: (
          path: string,
          name: string,
          databaseType: DatabaseType,
          connectionId?: string,
        ) => {
          return get().actions.openContent({
            type: "database",
            path,
            name,
            databaseType,
            connectionId,
          });
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

          const dirtyBuffer = buffersToClose.find((b) => isEditorContent(b) && b.isDirty);
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

          buffersToClose.forEach((buffer) => get().actions.closeBufferForce(buffer.id));
        },

        handleCloseAllTabs: () => {
          const { buffers } = get();
          const buffersToClose = buffers.filter((b) => !b.isPinned);

          const dirtyBuffer = buffersToClose.find((b) => isEditorContent(b) && b.isDirty);
          if (dirtyBuffer) {
            set((state) => {
              state.pendingClose = {
                bufferId: dirtyBuffer.id,
                type: "all",
              };
            });
            return;
          }

          buffersToClose.forEach((buffer) => get().actions.closeBufferForce(buffer.id));
        },

        handleCloseTabsToRight: (bufferId: string) => {
          const { buffers } = get();
          const bufferIndex = buffers.findIndex((b) => b.id === bufferId);
          if (bufferIndex === -1) return;

          const buffersToClose = buffers.slice(bufferIndex + 1).filter((b) => !b.isPinned);

          const dirtyBuffer = buffersToClose.find((b) => isEditorContent(b) && b.isDirty);
          if (dirtyBuffer) {
            set((state) => {
              state.pendingClose = {
                bufferId: dirtyBuffer.id,
                type: "to-right",
              };
            });
            return;
          }

          buffersToClose.forEach((buffer) => get().actions.closeBufferForce(buffer.id));
        },

        reorderBuffers: (startIndex: number, endIndex: number) => {
          set((state) => {
            const result = Array.from(state.buffers);
            const [removed] = result.splice(startIndex, 1);
            result.splice(endIndex, 0, removed);
            state.buffers = result;
          });

          saveSessionToStore(get().buffers, get().activeBufferId);
        },

        switchToNextBuffer: () => {
          const { buffers, activeBufferId } = get();
          const paneStore = usePaneStore.getState();
          const activePane = paneStore.actions.getActivePane();
          const paneBufferIds = activePane?.bufferIds ?? [];

          // Get the cyclable buffer IDs (skip newTab placeholders)
          const cyclableIds = paneBufferIds.filter((id) => {
            const b = buffers.find((buf) => buf.id === id);
            return b && b.type !== "newTab";
          });

          if (cyclableIds.length <= 1) return;

          const currentIndex = cyclableIds.indexOf(activeBufferId ?? "");
          const nextIndex = (currentIndex + 1) % cyclableIds.length;
          const nextBufferId = cyclableIds[nextIndex];

          if (activePane) {
            paneStore.actions.setActivePaneBuffer(activePane.id, nextBufferId);
          }
          set((state) => {
            state.activeBufferId = nextBufferId;
            state.buffers = state.buffers.map((b) => ({
              ...b,
              isActive: b.id === nextBufferId,
            }));
          });
        },

        switchToPreviousBuffer: () => {
          const { buffers, activeBufferId } = get();
          const paneStore = usePaneStore.getState();
          const activePane = paneStore.actions.getActivePane();
          const paneBufferIds = activePane?.bufferIds ?? [];

          // Get the cyclable buffer IDs (skip newTab placeholders)
          const cyclableIds = paneBufferIds.filter((id) => {
            const b = buffers.find((buf) => buf.id === id);
            return b && b.type !== "newTab";
          });

          if (cyclableIds.length <= 1) return;

          const currentIndex = cyclableIds.indexOf(activeBufferId ?? "");
          const prevIndex = (currentIndex - 1 + cyclableIds.length) % cyclableIds.length;
          const prevBufferId = cyclableIds[prevIndex];

          if (activePane) {
            paneStore.actions.setActivePaneBuffer(activePane.id, prevBufferId);
          }
          set((state) => {
            state.activeBufferId = prevBufferId;
            state.buffers = state.buffers.map((b) => ({
              ...b,
              isActive: b.id === prevBufferId,
            }));
          });
        },

        getActiveBuffer: (): PaneContent | null => {
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
          if (!buffer) return;

          // Only reload real editor files from disk
          if (buffer.type !== "editor" || buffer.isVirtual || isVirtualContent(buffer)) {
            return;
          }

          try {
            const content = await readFileContent(buffer.path);
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

          set((state) => {
            state.pendingClose = null;
          });

          switch (type) {
            case "single":
              get().actions.closeBufferForce(bufferId);
              break;
            case "others":
              if (keepBufferId) {
                const { buffers } = get();
                const buffersToClose = buffers.filter((b) => b.id !== keepBufferId && !b.isPinned);
                buffersToClose.forEach((buffer) => get().actions.closeBufferForce(buffer.id));
              }
              break;
            case "all":
              {
                const { buffers } = get();
                const buffersToClose = buffers.filter((b) => !b.isPinned);
                buffersToClose.forEach((buffer) => get().actions.closeBufferForce(buffer.id));
              }
              break;
            case "to-right":
              {
                const { buffers } = get();
                const bufferIndex = buffers.findIndex((b) => b.id === bufferId);
                if (bufferIndex !== -1) {
                  const buffersToClose = buffers.slice(bufferIndex + 1).filter((b) => !b.isPinned);
                  buffersToClose.forEach((buffer) => get().actions.closeBufferForce(buffer.id));
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

          const [closedBuffer, ...remainingHistory] = closedBuffersHistory;

          set((state) => {
            state.closedBuffersHistory = remainingHistory;
          });

          try {
            const content = await readFileContent(closedBuffer.path);
            const bufferId = get().actions.openContent({
              type: "editor",
              path: closedBuffer.path,
              name: closedBuffer.name,
              content,
            });

            if (closedBuffer.isPinned) {
              get().actions.handleTabPin(bufferId);
            }
          } catch (error) {
            logger.warn("Editor", `Failed to reopen closed tab: ${closedBuffer.path}`, error);
          }
        },
      },
    })),
    isEqual,
  ),
);
