import { invoke } from "@tauri-apps/api/core";
import isEqual from "fast-deep-equal";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";
import type { DatabaseType } from "@/features/database/types/provider.types";
import { getViewBufferPath } from "@/features/views/lib/view-buffer";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import {
  buildClosedBufferHistoryEntry,
  type ClosedBuffer,
  getClosedBufferHistoryKey,
} from "@/features/editor/stores/buffer-closed-history";
import { evictLeastRecentAutoClosableBuffer } from "@/features/editor/stores/buffer-eviction";
import { createPaneContent } from "@/features/editor/stores/buffer-content-factory";
import {
  closeNewTabInActivePane as closeNewTabInActivePaneForWorkspace,
  getWritablePaneForBuffer as getWritablePaneForWorkspace,
  removeBufferFromPanes as removeBufferFromWorkspacePanes,
  syncAndFocusBufferInPane as syncAndFocusBufferInWorkspacePane,
  syncBufferToPane as syncBufferToWorkspacePane,
  syncPanePreviewForBuffer as syncWorkspacePanePreviewForBuffer,
} from "@/features/editor/stores/buffer-pane-sync";
import {
  clearQueuedWorkspaceSessionSave,
  saveSessionToStore,
} from "@/features/editor/stores/buffer-session-persistence";
import { detectLanguageFromFileName } from "@/features/editor/utils/language-detection";
import { logger } from "@/features/editor/utils/logger";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import type { MultiFileDiff } from "@/features/git/types/git-diff.types";
import type { GitDiff } from "@/features/git/types/git.types";
import {
  getBufferById,
  getBufferByPath,
  getBufferIndexById,
} from "@/features/editor/utils/buffer-index";
import {
  findDirtyEditorBuffer,
  isDirtyEditorBuffer,
} from "@/features/editor/utils/editor-buffer-selectors";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import { useProjectStore } from "@/features/window/stores/project.store";
import { SINGLETON_TOOL_BUFFER_METADATA } from "@/features/panes/constants/tool-buffers";
import { ensureBufferInPane as ensureBufferInWorkspacePane } from "@/features/panes/utils/pane-buffer-actions";
import { defaultSettings } from "@/features/settings/config/default-settings";
import { useSettingsStore } from "@/features/settings/stores/settings.store";
import { cleanupBufferHistoryTracking } from "@/features/editor/stores/buffer-history-tracking";
import type {
  EditorContent,
  GitHubActionOpenTarget,
  OpenContentSpec,
  PaneContent,
  TerminalContent,
  TokenEntry,
} from "@/features/panes/types/pane-content.types";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";
import {
  isEditorContent,
  isEditableContent,
  isVirtualContent,
  shouldStartLsp,
} from "@/features/panes/types/pane-content.types";
import { createSelectors } from "@/utils/zustand-selectors";

/** @deprecated Use `PaneContent` directly. Kept for backward compatibility. */
export type Buffer = PaneContent;

interface PendingClose {
  bufferId: string;
  type: "single" | "others" | "all" | "to-left" | "to-right";
  anchorBufferId?: string;
  keepBufferId?: string;
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
  openPRBuffer: (
    prNumber: number,
    metadata?: {
      title?: string;
      repoPath?: string;
      authorAvatarUrl?: string;
      selectedFilePath?: string;
      initialView?: "activity" | "files";
    },
  ) => string;
  openGitHubIssueBuffer: (options: {
    issueNumber: number;
    repoPath?: string;
    title?: string;
    authorAvatarUrl?: string;
    url?: string;
  }) => string;
  openGitHubActionBuffer: (
    options: GitHubActionOpenTarget & {
      repoPath?: string;
      title?: string;
      url?: string;
    },
  ) => string;
  openGitHubFormBuffer: (options: {
    repoPath: string;
    formKind: "pull-request" | "issue" | "action";
    defaultHead?: string;
  }) => string;
  openTerminalBuffer: (options?: {
    name?: string;
    shell?: string;
    command?: string;
    workingDirectory?: string;
    remoteConnectionId?: string;
    sessionId?: string;
  }) => string;
  openAgentBuffer: (sessionId?: string) => string;
  openGlobalSearchBuffer: () => string;
  openDiagnosticsBuffer: () => string;
  openReferencesBuffer: () => string;
  openExtensionsBuffer: () => string;
  openExtensionBuffer: (extensionId: string, name: string) => string;
  openOnboardingBuffer: (
    context: import("@/features/onboarding/lib/onboarding-state").OnboardingContext,
  ) => string;
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
  updateBufferLanguage: (bufferId: string, language: string) => void;
  markBufferDirty: (bufferId: string, isDirty: boolean) => void;
  updateBufferPath: (bufferId: string, newPath: string) => void;
  updateBuffer: (updatedBuffer: PaneContent) => void;
  handleTabClick: (bufferId: string) => void;
  handleTabClose: (bufferId: string) => void;
  handleTabPin: (bufferId: string) => void;
  handleCloseOtherTabs: (keepBufferId: string) => void;
  handleCloseAllTabs: () => void;
  handleCloseSavedTabs: () => void;
  handleCloseTabsToLeft: (bufferId: string) => void;
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

interface ActivateExistingBufferOptions {
  focus?: boolean;
  update?: (buffer: PaneContent | null) => void;
}

interface OpenNewContentOptions {
  includePreviewsInEviction?: boolean;
  saveSession?: boolean;
}

let bufferIdSequence = 0;
const generateBufferId = (path: string): string =>
  `buffer_${path.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}_${bufferIdSequence++}`;
let newTabSequence = 0;

const applyWorkspaceAutoEviction = (
  buffers: PaneContent[],
  maxOpenTabs: number,
  workspaceId: string,
  options?: { includePreviews?: boolean },
): PaneContent[] => {
  const { buffers: nextBuffers, evictedBuffer } = evictLeastRecentAutoClosableBuffer(
    buffers,
    maxOpenTabs,
    options,
  );

  if (evictedBuffer) {
    cleanupBufferHistoryTracking(evictedBuffer.id);
    removeBufferFromWorkspacePanes(evictedBuffer.id, false, workspaceId);
  }

  return nextBuffers;
};

const getWorkspacePaneReplacementBufferId = (
  closingBufferIds: string[],
  buffers: PaneContent[],
  workspaceId: string,
): string | null => {
  const paneStore = usePaneStore.getStore(workspaceId).getState();
  const closingBufferIdSet = new Set(closingBufferIds);
  const activePane = paneStore.actions.getActivePane();
  const sourcePane =
    (closingBufferIds.length === 1
      ? paneStore.actions.getPaneByBufferId(closingBufferIds[0])
      : null) ?? activePane;

  if (!sourcePane) return null;

  const openBufferIds = new Set<string>();
  for (const buffer of buffers) {
    if (!closingBufferIdSet.has(buffer.id)) {
      openBufferIds.add(buffer.id);
    }
  }

  for (const bufferId of sourcePane.mruBufferIds ?? []) {
    if (openBufferIds.has(bufferId)) {
      return bufferId;
    }
  }

  for (const bufferId of sourcePane.bufferIds) {
    if (openBufferIds.has(bufferId)) {
      return bufferId;
    }
  }

  for (const buffer of buffers) {
    if (openBufferIds.has(buffer.id)) {
      return buffer.id;
    }
  }

  return null;
};

const getExistingPaneBufferIds = (paneBufferIds: string[], buffers: PaneContent[]): string[] => {
  const openBufferIds = new Set<string>();
  for (const buffer of buffers) {
    openBufferIds.add(buffer.id);
  }

  const existingBufferIds: string[] = [];
  for (const bufferId of paneBufferIds) {
    if (openBufferIds.has(bufferId)) {
      existingBufferIds.push(bufferId);
    }
  }

  return existingBufferIds;
};

const withActiveBufferState = (
  buffers: PaneContent[],
  activeBufferId: string | null,
): PaneContent[] => {
  return buffers.map((buffer) => {
    const isActive = buffer.id === activeBufferId;
    return buffer.isActive === isActive ? buffer : { ...buffer, isActive };
  });
};

const deactivateBuffers = (buffers: PaneContent[]): PaneContent[] =>
  withActiveBufferState(buffers, null);

const activateBufferInState = (state: BufferState, bufferId: string | null): PaneContent | null => {
  state.activeBufferId = bufferId;

  let activeBuffer: PaneContent | null = null;
  for (const buffer of state.buffers) {
    const isActive = buffer.id === bufferId;
    if (isActive) {
      activeBuffer = buffer;
    }
    if (buffer.isActive !== isActive) {
      buffer.isActive = isActive;
    }
  }

  return activeBuffer;
};

/**
 * Run extension checking and LSP logic for a newly opened editor file.
 */
const checkExtensionSupport = (path: string) => {
  logger.debug("BufferStore", `Checking extension support for ${path}`);
  import("@/extensions/runtime/extension-runtime")
    .then(({ waitForExtensionRuntimeInitialization }) => {
      logger.debug("BufferStore", "Waiting for extension runtime initialization...");
      return waitForExtensionRuntimeInitialization();
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
        logger.debug(
          "BufferStore",
          `Extension ${extension.manifest.name} for ${path}: installed=${installed}, bundled=${isBundled}`,
        );

        if (installed) {
          logger.debug("BufferStore", `Extension ready for ${path}`);
        } else {
          logger.debug(
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
        logger.debug("BufferStore", `No extension available for ${path}`);
      }
    })
    .catch((error) => {
      logger.error("BufferStore", "Failed to check extension support:", error);
    });
};

const scheduleExtensionSupportCheck = (path: string) => {
  const idleScheduler = window as Window & {
    requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  };

  if (idleScheduler.requestIdleCallback) {
    idleScheduler.requestIdleCallback(() => checkExtensionSupport(path), { timeout: 500 });
    return;
  }

  globalThis.setTimeout(() => checkExtensionSupport(path), 50);
};

const createBufferStore = (workspaceId: string) => {
  const paneStore = usePaneStore.getStore(workspaceId);
  const applyAutoEviction = (
    buffers: PaneContent[],
    maxOpenTabs: number,
    options?: { includePreviews?: boolean },
  ) => applyWorkspaceAutoEviction(buffers, maxOpenTabs, workspaceId, options);
  const closeNewTabInActivePane = (buffers: PaneContent[]) =>
    closeNewTabInActivePaneForWorkspace(buffers, workspaceId);
  const ensureBufferInPane = (paneId: string, bufferId: string, setActive = true) =>
    ensureBufferInWorkspacePane(paneId, bufferId, setActive, workspaceId);
  const getPaneReplacementBufferId = (closingBufferIds: string[], buffers: PaneContent[]) =>
    getWorkspacePaneReplacementBufferId(closingBufferIds, buffers, workspaceId);
  const getWritablePaneForBuffer = (bufferId?: string) =>
    getWritablePaneForWorkspace(bufferId, workspaceId);
  const removeBufferFromPanes = (bufferId: string, preserveEmptyPane = false) =>
    removeBufferFromWorkspacePanes(bufferId, preserveEmptyPane, workspaceId);
  const syncAndFocusBufferInPane = (bufferId: string) =>
    syncAndFocusBufferInWorkspacePane(bufferId, workspaceId);
  const syncBufferToPane = (bufferId: string) => syncBufferToWorkspacePane(bufferId, workspaceId);
  const syncPanePreviewForBuffer = (bufferId: string, isPreview: boolean) =>
    syncWorkspacePanePreviewForBuffer(bufferId, isPreview, workspaceId);
  const saveWorkspaceSession = (buffers: PaneContent[], activeBufferId: string | null) => {
    const projectPath = useProjectStore.getStore(workspaceId).getState().rootFolderPath;
    saveSessionToStore(projectPath, buffers, activeBufferId);
  };

  return createStore<BufferState>()(
    immer((set, get) => ({
      buffers: [],
      activeBufferId: null,
      maxOpenTabs: defaultSettings.maxOpenTabs,
      pendingClose: null,
      closedBuffersHistory: [],
      actions: {
        openContent: (spec: OpenContentSpec): string => {
          const { buffers, maxOpenTabs } = get();
          const activateExistingBuffer = (
            bufferId: string,
            { focus = false, update }: ActivateExistingBufferOptions = {},
          ) => {
            set((state) => {
              update?.(activateBufferInState(state, bufferId));
            });
            if (focus) {
              syncAndFocusBufferInPane(bufferId);
            } else {
              syncBufferToPane(bufferId);
            }
            return bufferId;
          };

          const openNewContent = (path: string, options: OpenNewContentOptions = {}) => {
            let newBuffers = closeNewTabInActivePane([...buffers]);
            newBuffers = applyAutoEviction(
              newBuffers,
              maxOpenTabs,
              options.includePreviewsInEviction === undefined
                ? undefined
                : { includePreviews: options.includePreviewsInEviction },
            );

            const id = generateBufferId(path);
            const newBuffer = createPaneContent(id, spec);

            set((state) => {
              state.buffers = [...deactivateBuffers(newBuffers), newBuffer];
              state.activeBufferId = newBuffer.id;
            });
            syncBufferToPane(newBuffer.id);
            if (options.saveSession) {
              saveWorkspaceSession(get().buffers, get().activeBufferId);
            }
            return newBuffer.id;
          };

          switch (spec.type) {
            case "editor": {
              // Special buffers should never be in preview mode
              const shouldBePreview = spec.isPreview ?? false;

              // Check if already open
              const existing = getBufferByPath(buffers, spec.path);
              if (existing) {
                set((state) => {
                  const activeBuffer = activateBufferInState(state, existing.id);
                  if (activeBuffer && !shouldBePreview) {
                    activeBuffer.isPreview = false;
                  }
                });
                syncBufferToPane(existing.id);
                syncPanePreviewForBuffer(existing.id, shouldBePreview);
                return existing.id;
              }

              const previewTargetPane = shouldBePreview ? getWritablePaneForBuffer() : null;
              let newBuffers = closeNewTabInActivePane([...buffers]);

              if (shouldBePreview) {
                const existingPreview = previewTargetPane?.previewBufferId
                  ? getBufferById(newBuffers, previewTargetPane.previewBufferId)
                  : null;
                if (existingPreview?.isPreview) {
                  cleanupBufferHistoryTracking(existingPreview.id);
                  removeBufferFromPanes(existingPreview.id, true);
                  newBuffers = newBuffers.filter((b) => b.id !== existingPreview.id);
                }
              }

              newBuffers = applyAutoEviction(newBuffers, maxOpenTabs, {
                includePreviews: false,
              });

              const id = generateBufferId(spec.path);
              const newBuffer = createPaneContent(id, spec) as EditorContent;

              set((state) => {
                state.buffers = [...deactivateBuffers(newBuffers), newBuffer];
                state.activeBufferId = newBuffer.id;
              });

              syncBufferToPane(newBuffer.id);
              syncPanePreviewForBuffer(newBuffer.id, shouldBePreview);

              // Track in recent files and check extensions (only for real files)
              if (shouldStartLsp(newBuffer)) {
                scheduleExtensionSupportCheck(spec.path);
              }

              saveWorkspaceSession(get().buffers, get().activeBufferId);
              return newBuffer.id;
            }

            case "terminal": {
              const terminalCount = buffers.filter((b) => b.type === "terminal").length;
              const terminalNumber = terminalCount + 1;
              const sessionId = spec.sessionId ?? `terminal-tab-${Date.now()}`;
              const path = spec.path ?? `terminal://${sessionId}`;
              const displayName = spec.name ?? `Terminal ${terminalNumber}`;

              const existing = buffers.find(
                (b) => b.type === "terminal" && b.sessionId === sessionId,
              );
              if (existing) {
                return activateExistingBuffer(existing.id);
              }

              let newBuffers = closeNewTabInActivePane([...buffers]);
              newBuffers = applyAutoEviction(newBuffers, maxOpenTabs);

              const id = generateBufferId(path);
              const newBuffer = createPaneContent(id, {
                ...spec,
                name: displayName,
                sessionId,
                path,
              }) as TerminalContent;
              newBuffer.path = path;
              newBuffer.name = displayName;

              set((state) => {
                state.buffers = [...deactivateBuffers(newBuffers), newBuffer];
                state.activeBufferId = newBuffer.id;
              });

              syncBufferToPane(newBuffer.id);
              saveWorkspaceSession(get().buffers, get().activeBufferId);
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
                  return activateExistingBuffer(existing.id, { focus: true });
                }
              }

              const agentNumber = agentCount + 1;
              const agentSessionId = spec.sessionId ?? `agent-tab-${Date.now()}`;
              const path = `agent://${agentSessionId}`;
              const displayName = `Agent ${agentNumber}`;

              let newBuffers = closeNewTabInActivePane([...buffers]);
              newBuffers = applyAutoEviction(newBuffers, maxOpenTabs);

              const id = generateBufferId(path);
              const newBuffer = createPaneContent(id, {
                ...spec,
                sessionId: agentSessionId,
              });
              newBuffer.path = path;
              newBuffer.name = displayName;

              set((state) => {
                state.buffers = [...deactivateBuffers(newBuffers), newBuffer];
                state.activeBufferId = newBuffer.id;
              });

              syncBufferToPane(newBuffer.id);
              saveWorkspaceSession(get().buffers, get().activeBufferId);
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
                return activateExistingBuffer(existing.id);
              }

              let newBuffers = closeNewTabInActivePane([...buffers]);
              newBuffers = applyAutoEviction(newBuffers, maxOpenTabs);

              const id = generateBufferId(path);
              const newBuffer = createPaneContent(id, spec);
              newBuffer.path = path;
              newBuffer.name = displayName;

              set((state) => {
                state.buffers = [...deactivateBuffers(newBuffers), newBuffer];
                state.activeBufferId = newBuffer.id;
              });

              syncBufferToPane(newBuffer.id);
              return newBuffer.id;
            }

            case "newTab": {
              const nextBuffers = applyAutoEviction([...buffers], maxOpenTabs);
              const id = generateBufferId(`newtab://${newTabSequence++}`);
              const newBuffer = createPaneContent(id, spec);

              set((state) => {
                state.buffers = [...deactivateBuffers(nextBuffers), newBuffer];
                state.activeBufferId = newBuffer.id;
              });
              syncBufferToPane(newBuffer.id);
              saveWorkspaceSession(get().buffers, get().activeBufferId);
              return newBuffer.id;
            }

            case "markdownDocument": {
              const path = `markdown-document://${spec.documentId}`;
              return openNewContent(path);
            }

            case "pullRequest": {
              const path = spec.selectedFilePath
                ? `pr://${spec.prNumber}?file=${encodeURIComponent(spec.selectedFilePath)}`
                : spec.initialView === "files"
                  ? `pr://${spec.prNumber}?view=files`
                  : `pr://${spec.prNumber}`;
              const existing = buffers.find(
                (b) =>
                  b.type === "pullRequest" &&
                  b.prNumber === spec.prNumber &&
                  (!spec.repoPath || !b.repoPath || b.repoPath === spec.repoPath),
              );
              if (existing) {
                return activateExistingBuffer(existing.id, {
                  update: (buffer) => {
                    if (buffer?.type !== "pullRequest") return;
                    buffer.path = path;
                    buffer.name = spec.name ?? buffer.name;
                    buffer.repoPath = spec.repoPath ?? buffer.repoPath;
                    buffer.authorAvatarUrl = spec.authorAvatarUrl ?? buffer.authorAvatarUrl;
                  },
                });
              }

              return openNewContent(path);
            }

            case "githubIssue": {
              const path = spec.url ?? `github-issue://${spec.issueNumber}`;
              const existing = buffers.find(
                (b) =>
                  b.type === "githubIssue" &&
                  b.issueNumber === spec.issueNumber &&
                  (!spec.repoPath || !b.repoPath || b.repoPath === spec.repoPath),
              );
              if (existing) {
                return activateExistingBuffer(existing.id, {
                  update: (buffer) => {
                    if (buffer?.type !== "githubIssue") return;
                    buffer.path = path;
                    buffer.name = spec.name ?? buffer.name;
                    buffer.repoPath = spec.repoPath ?? buffer.repoPath;
                    buffer.authorAvatarUrl = spec.authorAvatarUrl ?? buffer.authorAvatarUrl;
                    buffer.url = spec.url ?? buffer.url;
                  },
                });
              }

              return openNewContent(path);
            }

            case "githubAction": {
              const path =
                spec.runId !== undefined
                  ? (spec.url ?? `github-action://${spec.runId}`)
                  : `github-action-notification://${spec.notification?.id ?? "pending"}`;
              const existing = buffers.find(
                (b) =>
                  b.type === "githubAction" &&
                  ((spec.runId !== undefined && b.runId === spec.runId) ||
                    (spec.notification && b.notification?.id === spec.notification.id)) &&
                  (!spec.repoPath || !b.repoPath || b.repoPath === spec.repoPath),
              );
              if (existing) {
                return activateExistingBuffer(existing.id, {
                  update: (buffer) => {
                    if (buffer?.type !== "githubAction") return;
                    buffer.path = path;
                    buffer.name = spec.name ?? buffer.name;
                    buffer.repoPath = spec.repoPath ?? buffer.repoPath;
                    buffer.runId = spec.runId ?? buffer.runId;
                    buffer.notification = spec.notification ?? buffer.notification;
                    buffer.url = spec.url ?? buffer.url;
                  },
                });
              }

              return openNewContent(path);
            }

            case "githubForm": {
              const path = `github-form://create/${spec.formKind}/${encodeURIComponent(spec.repoPath)}`;
              const existing = buffers.find(
                (buffer) => buffer.type === "githubForm" && buffer.path === path,
              );
              if (existing) {
                return activateExistingBuffer(existing.id);
              }

              return openNewContent(path);
            }

            case "customView": {
              const path = getViewBufferPath(spec.projectPath, spec.viewId);
              const existing = getBufferByPath(buffers, path);
              if (existing) {
                return activateExistingBuffer(existing.id);
              }

              return openNewContent(path);
            }

            case "extension": {
              const path = `extension://${encodeURIComponent(spec.extensionId)}`;
              const existing = buffers.find(
                (buffer) => buffer.type === "extension" && buffer.extensionId === spec.extensionId,
              );
              if (existing) {
                return activateExistingBuffer(existing.id, {
                  update: (buffer) => {
                    if (buffer?.type === "extension") {
                      buffer.name = spec.name;
                    }
                  },
                });
              }

              return openNewContent(path);
            }

            case "externalEditor": {
              const existing = getBufferByPath(buffers, spec.path);
              if (existing) {
                return activateExistingBuffer(existing.id);
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
                cleanupBufferHistoryTracking(existingExternalEditor.id);
                removeBufferFromPanes(existingExternalEditor.id);
                newBuffers = newBuffers.filter((b) => b.id !== existingExternalEditor.id);
              }

              const id = generateBufferId(spec.path);
              const newBuffer = createPaneContent(id, spec);

              set((state) => {
                state.buffers = [...deactivateBuffers(newBuffers), newBuffer];
                state.activeBufferId = newBuffer.id;
              });

              syncBufferToPane(newBuffer.id);
              saveWorkspaceSession(get().buffers, get().activeBufferId);
              return newBuffer.id;
            }

            case "globalSearch":
            case "diagnostics":
            case "references":
            case "extensions": {
              const existing = buffers.find((b) => b.type === spec.type);
              if (existing) {
                return activateExistingBuffer(existing.id, { focus: true });
              }

              return openNewContent(SINGLETON_TOOL_BUFFER_METADATA[spec.type].path);
            }

            case "onboarding": {
              const path = `onboarding://${spec.context.mode}/${spec.context.currentVersion}`;
              const existing = getBufferByPath(buffers, path);
              if (existing) {
                return activateExistingBuffer(existing.id, { focus: true });
              }

              return openNewContent(path);
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
              const existing = getBufferByPath(buffers, path);
              if (existing) {
                return activateExistingBuffer(existing.id, {
                  update: (buffer) => {
                    if (spec.type === "diff" && buffer?.type === "diff") {
                      buffer.name = spec.name;
                      buffer.content = spec.content;
                      buffer.savedContent = spec.content;
                      buffer.diffData = spec.diffData;
                    }
                  },
                });
              }

              return openNewContent(path, {
                includePreviewsInEviction: false,
                saveSession: true,
              });
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
          if (!useSettingsStore.getState().settings.coreFeatures.webViewer) {
            return get().activeBufferId ?? "";
          }

          return get().actions.openContent({ type: "webViewer", url });
        },

        openPRBuffer: (
          prNumber: number,
          metadata?: {
            title?: string;
            repoPath?: string;
            authorAvatarUrl?: string;
            selectedFilePath?: string;
            initialView?: "activity" | "files";
          },
        ): string => {
          return get().actions.openContent({
            type: "pullRequest",
            prNumber,
            name: metadata?.title,
            repoPath: metadata?.repoPath,
            authorAvatarUrl: metadata?.authorAvatarUrl,
            selectedFilePath: metadata?.selectedFilePath,
            initialView: metadata?.initialView,
          });
        },

        openGitHubIssueBuffer: ({ issueNumber, repoPath, title, authorAvatarUrl, url }): string => {
          return get().actions.openContent({
            type: "githubIssue",
            issueNumber,
            repoPath,
            name: title,
            authorAvatarUrl,
            url,
          });
        },

        openGitHubActionBuffer: (options): string => {
          const common = {
            type: "githubAction" as const,
            repoPath: options.repoPath,
            name: options.title,
            url: options.url,
          };

          if (options.runId !== undefined) {
            return get().actions.openContent({ ...common, runId: options.runId });
          }

          return get().actions.openContent({ ...common, notification: options.notification });
        },

        openGitHubFormBuffer: ({ repoPath, formKind, defaultHead }): string => {
          return get().actions.openContent({
            type: "githubForm",
            repoPath,
            formKind,
            operation: "create",
            defaultHead,
          });
        },

        openTerminalBuffer: (options?: {
          name?: string;
          shell?: string;
          command?: string;
          workingDirectory?: string;
          remoteConnectionId?: string;
          sessionId?: string;
        }): string => {
          return get().actions.openContent({
            type: "terminal",
            name: options?.name,
            shell: options?.shell,
            command: options?.command,
            workingDirectory: options?.workingDirectory,
            remoteConnectionId: options?.remoteConnectionId,
            sessionId: options?.sessionId,
          });
        },

        openAgentBuffer: (sessionId?: string): string => {
          return get().actions.openContent({ type: "agent", sessionId });
        },

        openGlobalSearchBuffer: (): string => {
          return get().actions.openContent({ type: "globalSearch" });
        },

        openDiagnosticsBuffer: (): string => {
          return get().actions.openContent({ type: "diagnostics" });
        },

        openReferencesBuffer: (): string => {
          return get().actions.openContent({ type: "references" });
        },

        openExtensionsBuffer: (): string => {
          return get().actions.openContent({ type: "extensions" });
        },

        openExtensionBuffer: (extensionId, name): string => {
          return get().actions.openContent({ type: "extension", extensionId, name });
        },

        openOnboardingBuffer: (context): string => {
          return get().actions.openContent({ type: "onboarding", context });
        },

        closeBuffer: (bufferId: string) => {
          const buffer = getBufferById(get().buffers, bufferId);

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
          const bufferIndex = getBufferIndexById(buffers, bufferId);

          if (bufferIndex === -1) return;

          cleanupBufferHistoryTracking(bufferId);

          const replacementBufferId =
            activeBufferId === bufferId ? getPaneReplacementBufferId([bufferId], buffers) : null;

          removeBufferFromPanes(bufferId);

          const closedBuffer = buffers[bufferIndex];

          if (closedBuffer.type === "onboarding") {
            void import("@/features/onboarding/stores/onboarding.store").then(
              ({ useOnboardingStore }) => {
                const onboardingState = useOnboardingStore.getState();
                if (
                  onboardingState.context?.currentVersion === closedBuffer.currentVersion &&
                  onboardingState.context.mode === closedBuffer.mode
                ) {
                  void onboardingState.actions.dismiss();
                }
              },
            );
          }

          // Close terminal connection for external editor buffers
          if (closedBuffer.type === "externalEditor") {
            invoke("close_terminal", { id: closedBuffer.terminalConnectionId }).catch((e) => {
              logger.error("BufferStore", "Failed to close external editor terminal:", e);
            });
          }

          // Close terminal session for terminal tab buffers
          if (closedBuffer.type === "terminal") {
            import("@/features/terminal/stores/terminal.store").then(({ useTerminalStore }) => {
              const terminalStore = useTerminalStore.getState();
              const session = terminalStore.actions.getSession(closedBuffer.sessionId);
              if (session?.connectionId) {
                const closeCommand = session.remoteConnectionId
                  ? "close_remote_terminal"
                  : "close_terminal";
                invoke(closeCommand, { id: session.connectionId }).catch((e) => {
                  logger.error("BufferStore", "Failed to close terminal tab session:", e);
                });
              }
              terminalStore.actions.removeSession(closedBuffer.sessionId);
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
          }

          const closedBufferInfo = buildClosedBufferHistoryEntry(closedBuffer);
          if (closedBufferInfo) {
            const updatedHistory = [
              closedBufferInfo,
              ...closedBuffersHistory.filter(
                (entry) =>
                  getClosedBufferHistoryKey(entry) !== getClosedBufferHistoryKey(closedBufferInfo),
              ),
            ].slice(0, EDITOR_CONSTANTS.MAX_CLOSED_BUFFERS_HISTORY);

            set((state) => {
              state.closedBuffersHistory = updatedHistory;
            });
          }

          const newBuffers = buffers.filter((b) => b.id !== bufferId);
          let newActiveId = activeBufferId;

          if (activeBufferId === bufferId) {
            if (replacementBufferId) {
              newActiveId = replacementBufferId;
            } else if (newBuffers.length > 0) {
              const newIndex = Math.min(bufferIndex, newBuffers.length - 1);
              newActiveId = newBuffers[newIndex].id;
            } else {
              newActiveId = null;
            }
          }

          set((state) => {
            state.buffers = withActiveBufferState(newBuffers, newActiveId);
            state.activeBufferId = newActiveId;
          });

          if (newActiveId) {
            syncAndFocusBufferInPane(newActiveId);
          }

          saveWorkspaceSession(get().buffers, get().activeBufferId);
        },

        closeBuffersBatch: (bufferIds: string[], skipSessionSave = false) => {
          if (bufferIds.length === 0) return;

          const { buffers, activeBufferId } = get();
          const closingBufferIds = new Set(bufferIds);
          const replacementBufferId =
            activeBufferId && closingBufferIds.has(activeBufferId)
              ? getPaneReplacementBufferId(bufferIds, buffers)
              : null;

          bufferIds.forEach((id) => removeBufferFromPanes(id));

          set((state) => {
            state.buffers = state.buffers.filter((b) => !closingBufferIds.has(b.id));

            if (state.activeBufferId && closingBufferIds.has(state.activeBufferId)) {
              if (replacementBufferId) {
                activateBufferInState(state, replacementBufferId);
              } else if (state.buffers.length > 0) {
                const nextBufferId = state.buffers[0].id;
                activateBufferInState(state, nextBufferId);
              } else {
                state.activeBufferId = null;
              }
            }
          });

          if (replacementBufferId) {
            syncAndFocusBufferInPane(replacementBufferId);
          }

          if (!skipSessionSave) {
            saveWorkspaceSession(get().buffers, get().activeBufferId);
          }
        },

        setActiveBuffer: (bufferId: string) => {
          if (get().activeBufferId === bufferId) {
            syncAndFocusBufferInPane(bufferId);
            return;
          }

          syncAndFocusBufferInPane(bufferId);
          set((state) => {
            activateBufferInState(state, bufferId);
          });
          saveWorkspaceSession(get().buffers, get().activeBufferId);
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
          const buffer = getBufferById(get().buffers, bufferId);
          if (!buffer) return;

          // Only content types with text content can be updated
          if (!isEditableContent(buffer)) return;

          if (buffer.content === content && !diffData) return;

          let promotedPreviewBufferId: string | null = null;
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
                  promotedPreviewBufferId = buf.id;
                }
              }
            } else if (buf.type === "diff") {
              buf.savedContent = content;
            }
          });

          if (promotedPreviewBufferId) {
            paneStore.getState().actions.clearPreviewBufferEverywhere(promotedPreviewBufferId);
          }
        },

        updateBufferTokens: (bufferId: string, tokens: TokenEntry[]) => {
          set((state) => {
            const buffer = state.buffers.find((b) => b.id === bufferId);
            if (buffer && isEditorContent(buffer)) {
              buffer.tokens = tokens;
            }
          });
        },

        updateBufferLanguage: (bufferId: string, language: string) => {
          set((state) => {
            const buffer = state.buffers.find((b) => b.id === bufferId);
            if (buffer && isEditorContent(buffer)) {
              buffer.languageOverride = language;
              buffer.tokens = [];
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
          let isPinned = false;
          set((state) => {
            const buffer = state.buffers.find((b) => b.id === bufferId);
            if (buffer) {
              buffer.isPinned = !buffer.isPinned;
              isPinned = buffer.isPinned;
              if (buffer.isPinned) {
                buffer.isPreview = false;
              }
            }
          });

          paneStore.getState().actions.setBufferPinnedEverywhere(bufferId, isPinned);
          saveWorkspaceSession(get().buffers, get().activeBufferId);
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
          paneStore.getState().actions.clearPreviewBufferEverywhere(bufferId);
          saveWorkspaceSession(get().buffers, get().activeBufferId);
        },

        handleCloseOtherTabs: (keepBufferId: string) => {
          const { buffers } = get();
          const buffersToClose = buffers.filter((b) => b.id !== keepBufferId && !b.isPinned);

          const dirtyBuffer = findDirtyEditorBuffer(buffersToClose);
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

          const dirtyBuffer = findDirtyEditorBuffer(buffersToClose);
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

        handleCloseSavedTabs: () => {
          const { buffers } = get();
          const buffersToClose = buffers.filter(
            (buffer) => !buffer.isPinned && !isDirtyEditorBuffer(buffer),
          );

          buffersToClose.forEach((buffer) => get().actions.closeBufferForce(buffer.id));
        },

        handleCloseTabsToLeft: (bufferId: string) => {
          const { buffers } = get();
          const bufferIndex = buffers.findIndex((b) => b.id === bufferId);
          if (bufferIndex === -1) return;

          const buffersToClose = buffers.slice(0, bufferIndex).filter((b) => !b.isPinned);

          const dirtyBuffer = findDirtyEditorBuffer(buffersToClose);
          if (dirtyBuffer) {
            set((state) => {
              state.pendingClose = {
                bufferId: dirtyBuffer.id,
                anchorBufferId: bufferId,
                type: "to-left",
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

          const dirtyBuffer = findDirtyEditorBuffer(buffersToClose);
          if (dirtyBuffer) {
            set((state) => {
              state.pendingClose = {
                bufferId: dirtyBuffer.id,
                anchorBufferId: bufferId,
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

          saveWorkspaceSession(get().buffers, get().activeBufferId);
        },

        switchToNextBuffer: () => {
          const { buffers, activeBufferId } = get();
          const paneState = paneStore.getState();
          const activePane = paneState.actions.getActivePane();
          const paneBufferIds = activePane?.bufferIds ?? [];

          const cyclableIds = getExistingPaneBufferIds(paneBufferIds, buffers);

          if (cyclableIds.length <= 1) return;

          const currentIndex = cyclableIds.indexOf(activeBufferId ?? "");
          const nextIndex = (currentIndex + 1) % cyclableIds.length;
          const nextBufferId = cyclableIds[nextIndex];

          if (activePane) {
            ensureBufferInPane(activePane.id, nextBufferId, true);
          }
          set((state) => {
            activateBufferInState(state, nextBufferId);
          });
          saveWorkspaceSession(get().buffers, get().activeBufferId);
        },

        switchToPreviousBuffer: () => {
          const { buffers, activeBufferId } = get();
          const paneState = paneStore.getState();
          const activePane = paneState.actions.getActivePane();
          const paneBufferIds = activePane?.bufferIds ?? [];

          const cyclableIds = getExistingPaneBufferIds(paneBufferIds, buffers);

          if (cyclableIds.length <= 1) return;

          const currentIndex = cyclableIds.indexOf(activeBufferId ?? "");
          const prevIndex = (currentIndex - 1 + cyclableIds.length) % cyclableIds.length;
          const prevBufferId = cyclableIds[prevIndex];

          if (activePane) {
            ensureBufferInPane(activePane.id, prevBufferId, true);
          }
          set((state) => {
            activateBufferInState(state, prevBufferId);
          });
          saveWorkspaceSession(get().buffers, get().activeBufferId);
        },

        getActiveBuffer: (): PaneContent | null => {
          const { buffers, activeBufferId } = get();
          return getBufferById(buffers, activeBufferId);
        },

        setMaxOpenTabs: (max: number) => {
          set((state) => {
            state.maxOpenTabs = max;
          });
        },

        reloadBufferFromDisk: async (bufferId: string): Promise<void> => {
          const buffer = getBufferById(get().buffers, bufferId);
          if (!buffer) return;

          // Only reload real editor files from disk
          if (buffer.type !== "editor" || buffer.isVirtual || isVirtualContent(buffer)) {
            return;
          }

          try {
            const content = await readFileContent(buffer.path);
            get().actions.updateBufferContent(bufferId, content, false);
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

          const { anchorBufferId, bufferId, type, keepBufferId } = pendingClose;

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
            case "to-left":
              {
                const { buffers } = get();
                const bufferIndex = buffers.findIndex((b) => b.id === (anchorBufferId ?? bufferId));
                if (bufferIndex !== -1) {
                  const buffersToClose = buffers.slice(0, bufferIndex).filter((b) => !b.isPinned);
                  buffersToClose.forEach((buffer) => get().actions.closeBufferForce(buffer.id));
                }
              }
              break;
            case "to-right":
              {
                const { buffers } = get();
                const bufferIndex = buffers.findIndex((b) => b.id === (anchorBufferId ?? bufferId));
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
          const { closedBuffersHistory, buffers } = get();

          if (closedBuffersHistory.length === 0) {
            const { toast } = await import("sonner");
            toast.info("No recently closed tabs");
            return;
          }

          // Pop the most recently closed entry. Skip any entry that's already open
          // (re-add to head would be a no-op) — pull the next one instead.
          let closedBuffer: ClosedBuffer | undefined;
          let remainingHistory = closedBuffersHistory;
          while (remainingHistory.length > 0) {
            const [head, ...rest] = remainingHistory;
            remainingHistory = rest;
            if (!buffers.some((b) => b.path === head.path)) {
              closedBuffer = head;
              break;
            }
          }

          set((state) => {
            state.closedBuffersHistory = remainingHistory;
          });

          if (!closedBuffer) {
            const { toast } = await import("sonner");
            toast.info("No recently closed tabs");
            return;
          }

          try {
            let reopenedBufferId: string | null = null;

            if (
              closedBuffer.type === "markdownPreview" ||
              closedBuffer.type === "htmlPreview" ||
              closedBuffer.type === "csvPreview"
            ) {
              reopenedBufferId = get().actions.openContent({
                type: closedBuffer.type,
                path: closedBuffer.path,
                name: closedBuffer.name,
                content: closedBuffer.content,
                sourceFilePath: closedBuffer.sourceFilePath,
              });
            } else if (closedBuffer.type === "diff") {
              reopenedBufferId = get().actions.openContent({
                type: "diff",
                path: closedBuffer.path,
                name: closedBuffer.name,
                content: closedBuffer.content,
                diffData: closedBuffer.diffData,
              });
            } else {
              // Delegate file-backed types to handleFileSelect so reopen stays aligned
              // with the main file-open routing.
              const { useFileSystemStore } =
                await import("@/features/file-system/stores/file-system.store");
              await useFileSystemStore
                .getStore(workspaceId)
                .getState()
                .handleFileSelect(closedBuffer.path, false);
              reopenedBufferId = getBufferByPath(get().buffers, closedBuffer.path)?.id ?? null;
            }

            if (closedBuffer.isPinned && reopenedBufferId) {
              get().actions.handleTabPin(reopenedBufferId);
            }
          } catch (error) {
            logger.warn("Editor", `Failed to reopen closed tab: ${closedBuffer.path}`, error);
            const { toast } = await import("sonner");
            toast.error(`Couldn't reopen ${closedBuffer.name}`);
          }
        },
      },
    })),
  );
};

export const useBufferStore = createSelectors(
  createWorkspaceScopedStore("editor-buffer", createBufferStore, isEqual),
);

export { clearQueuedWorkspaceSessionSave };
