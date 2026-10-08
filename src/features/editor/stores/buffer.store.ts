import { deliveryBufferPath } from "@/features/github/delivery/services/github-delivery";
import { immer } from "zustand/middleware/immer";
import { createStore } from "zustand/vanilla";
import type { DatabaseType } from "@/features/database/types/provider.types";
import { getViewBufferPath } from "@/features/views/services/view-buffer";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import {
  buildClosedBufferHistoryEntry,
  type ClosedBuffer,
  getClosedBufferHistoryKey,
} from "@/features/editor/stores/buffer-closed-history";
import { evictLeastRecentAutoClosableBuffer } from "@/features/editor/stores/buffer-eviction";
import { createPaneContent } from "@/features/editor/stores/buffer-content-factory";
import { saveSessionToStore } from "@/features/editor/services/buffer-session-persistence";
import { detectLanguageFromFileName } from "@/features/editor/services/language-detection";
import { logger } from "@/utils/logger";
import { readFileContent } from "@/features/file-system/api/file-operations";
import type { MultiFileDiff } from "@/features/git/types/git-diff.types";
import type { GitDiff } from "@/features/git/types/git.types";
import { getBufferById, getBufferByPath } from "@/features/editor/stores/buffer-index";
import type { ImageDraftState } from "@/features/viewer/image/editor/services/image-edit-session";
import { usePaneStore } from "@/features/panes/stores/pane.store";
import {
  selectActiveBufferId,
  selectActivePane,
  selectIsBufferPreview,
  selectPaneBufferFlags,
} from "@/features/panes/stores/pane-selectors";
import { resolveWritablePaneForBuffer } from "@/features/panes/services/pane-routing";
import { useProjectStore } from "@/features/workspace/stores/project.store";
import { SINGLETON_TOOL_BUFFER_METADATA } from "@/features/panes/constants/tool-buffers";
import { defaultSettings } from "@/features/settings/config/default-settings";
import { closeTerminalConnection } from "@/features/terminal/services/terminal-connection-lifecycle";
import { cleanupBufferHistoryTracking } from "@/features/editor/services/buffer-history-tracking";
import type {
  EditorContent,
  GitHubActionOpenTarget,
  OpenContentSpec,
  PaneContent,
  BrowserContent,
  TerminalContent,
} from "@/features/panes/types/pane-content.types";
import type {
  EditorDocumentChangeBatch,
  EditorDocumentChangeResult,
} from "@/features/editor/types/editor.types";
import { publishEditorDocumentChange } from "@/features/editor/services/editor-document-events";
import { applyEditorTextChanges } from "@/features/editor/utils/editor-text-changes";
import { readBufferRevision, readBufferText } from "@/features/editor/services/buffer-text";
import {
  discardLiveDocumentChanges,
  flushLiveDocument,
  forgetLiveDocument,
  liveDocumentMatchesSaved,
  type LiveDocumentEdit,
  markLiveDocumentChanged,
  rememberSavedText,
} from "@/features/editor/services/live-document-registry";
import { SavedContentTracker } from "@/features/editor/utils/saved-content-tracker";
import { createWorkspaceScopedStore } from "@/features/workspace/stores/create-workspace-scoped-store";
import {
  isEditorContent,
  isDirtyContent,
  isEditableContent,
  isVirtualContent,
  shouldStartLsp,
} from "@/features/panes/types/pane-content.types";
import { createSelectors } from "@/utils/zustand-selectors";
import { getBaseName } from "@/utils/path-helpers";
import { emitAppEvent } from "@/utils/app-events";

/** @deprecated Use `PaneContent` directly. Kept for backward compatibility. */
export type Buffer = PaneContent;

function continueCloseGroup(actions: BufferActions, request: PendingClose) {
  switch (request.type) {
    case "all":
      actions.handleCloseAllTabs();
      break;
    case "others":
      if (request.keepBufferId) actions.handleCloseOtherTabs(request.keepBufferId);
      break;
    case "to-left":
      actions.handleCloseTabsToLeft(request.anchorBufferId ?? request.bufferId);
      break;
    case "to-right":
      actions.handleCloseTabsToRight(request.anchorBufferId ?? request.bufferId);
      break;
  }
}

const savedContentTracker = new SavedContentTracker();

const lastAppliedModelVersionByBuffer = new Map<
  string,
  { modelSessionId: string; modelVersionId: number }
>();

interface PendingClose {
  bufferId: string;
  type: "single" | "others" | "all" | "to-left" | "to-right";
  anchorBufferId?: string;
  keepBufferId?: string;
}

/**
 * The buffer registry: what is open and its content. Which pane shows a buffer, which tab is
 * active, previewed or pinned lives in the pane store (`pane-selectors.ts` reads it); actions here
 * that change both update the entity first when adding and last when removing, so a pane never
 * points at a buffer that does not exist.
 */
export interface OpenContentOptions {
  /** Pane to show the buffer in instead of the focused pane. */
  paneId?: string;
}

interface BufferState {
  buffers: PaneContent[];
  maxOpenTabs: number;
  pendingClose: PendingClose | null;
  closedBuffersHistory: ClosedBuffer[];
  actions: BufferActions;
}

interface BufferActions {
  confirmCloseAfterSaving: (request: PendingClose) => boolean;
  openContent: (spec: OpenContentSpec, options?: OpenContentOptions) => string;
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
  openExternalEditorBuffer: (
    path: string,
    name: string,
    terminalConnectionId: string,
    openOptions?: OpenContentOptions,
  ) => string;
  openPRBuffer: (
    prNumber: number,
    metadata?: {
      title?: string;
      repoPath?: string;
      authorAvatarUrl?: string;
      selectedFilePath?: string;
      initialView?: "activity" | "files";
    },
    openOptions?: OpenContentOptions,
  ) => string;
  openGitHubIssueBuffer: (
    options: {
      issueNumber: number;
      repoPath?: string;
      title?: string;
      authorAvatarUrl?: string;
      url?: string;
    },
    openOptions?: OpenContentOptions,
  ) => string;
  openGitHubActionBuffer: (
    options: GitHubActionOpenTarget & {
      repoPath?: string;
      title?: string;
      url?: string;
    },
    openOptions?: OpenContentOptions,
  ) => string;
  openGitHubFormBuffer: (options: {
    repoPath: string;
    formKind: "pull-request" | "issue" | "action";
    defaultHead?: string;
  }) => string;
  openTerminalBuffer: (
    options?: {
      name?: string;
      shell?: string;
      command?: string;
      workingDirectory?: string;
      remoteConnectionId?: string;
      sessionId?: string;
    },
    openOptions?: OpenContentOptions,
  ) => string;
  openAgentBuffer: (sessionId?: string) => string;
  openBrowserBuffer: (url?: string) => string;
  openGlobalSearchBuffer: () => string;
  openDiagnosticsBuffer: () => string;
  openReferencesBuffer: () => string;
  openContinuousAgentsBuffer: () => string;
  openAcpInspectorBuffer: () => string;
  openExtensionsBuffer: () => string;
  openExtensionBuffer: (extensionId: string, name: string) => string;
  openOnboardingBuffer: (
    context: import("@/features/onboarding/services/onboarding-state").OnboardingContext,
  ) => string;
  closeBuffer: (bufferId: string) => void;
  closeBufferForce: (bufferId: string) => void;
  closeBuffersBatch: (bufferIds: string[], skipSessionSave?: boolean) => void;
  /** Activates a buffer and focuses its pane, or `paneId` (adding it there when needed). */
  setActiveBuffer: (bufferId: string, paneId?: string) => void;
  showNewTabView: () => void;
  updateBufferContent: (
    bufferId: string,
    content: string,
    markDirty?: boolean,
    diffData?: GitDiff | MultiFileDiff,
  ) => void;
  applyBufferContentChanges: (
    bufferId: string,
    batch: EditorDocumentChangeBatch,
    markDirty?: boolean,
  ) => EditorDocumentChangeResult;
  /**
   * Takes an edit from an editor view that keeps the text itself. The store's `content` is left
   * as it is until the view's text is flushed; only the dirty flag changes when it flips.
   */
  applyLiveDocumentChange: (
    bufferId: string,
    batch: EditorDocumentChangeBatch,
    edit: LiveDocumentEdit,
    /** Track the dirty flag even though the buffer is virtual (collaboration notes save remotely). */
    trackVirtualDirty?: boolean,
  ) => EditorDocumentChangeResult;
  updateBufferLanguage: (bufferId: string, language: string) => void;
  markBufferDirty: (bufferId: string, isDirty: boolean) => void;
  updateImageDraft: (bufferId: string, draft: ImageDraftState) => void;
  markBufferSaved: (bufferId: string, content: string, path?: string) => void;
  updateBufferPath: (bufferId: string, newPath: string) => void;
  updateBuffer: (updatedBuffer: PaneContent) => void;
  updateBrowserBuffer: (
    bufferId: string,
    patch: Partial<Pick<BrowserContent, "url" | "name" | "favicon" | "zoom">>,
  ) => void;
  handleTabClick: (bufferId: string) => void;
  handleTabClose: (bufferId: string) => void;
  handleTabPin: (bufferId: string) => void;
  handleCloseOtherTabs: (keepBufferId: string) => void;
  handleCloseAllTabs: () => void;
  handleCloseSavedTabs: () => void;
  handleCloseTabsToLeft: (bufferId: string) => void;
  handleCloseTabsToRight: (bufferId: string) => void;
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

interface ShowExistingBufferOptions {
  /** Focus the pane already showing it instead of adding it to the writable pane. */
  reveal?: boolean;
  /** Pane to show it in; wins over `reveal`. */
  paneId?: string;
  preview?: boolean;
  update?: (buffer: PaneContent | undefined) => void;
}

interface AddBufferOptions {
  /** Pane to show the buffer in instead of the focused pane. */
  paneId?: string;
  preview?: boolean;
  /** Buffers the new one takes the place of; their panes stay even when emptied. */
  replaceBufferIds?: string[];
  /** Buffers closed along the way; panes they empty close too. */
  closeBufferIds?: string[];
  /** Whether the active pane's new-tab page is consumed by the new buffer. */
  consumeNewTab?: boolean;
  evict?: boolean;
  includePreviewsInEviction?: boolean;
}

interface OpenNewContentOptions {
  includePreviewsInEviction?: boolean;
  saveSession?: boolean;
}

let bufferIdSequence = 0;
const generateBufferId = (path: string): string =>
  `buffer_${path.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}_${bufferIdSequence++}`;
let newTabSequence = 0;

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

  // The source pane is left empty: focus falls back to the most recent pane, whose own active
  // tab stays as it is.
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

/**
 * Run extension checking and LSP logic for a newly opened editor file.
 */
const checkExtensionSupport = (path: string) => {
  logger.debug("BufferStore", `Checking integration support for ${path}`);
  import("@/extensions/runtime/extension-runtime")
    .then(({ waitForExtensionRuntimeInitialization }) => {
      logger.debug("BufferStore", "Waiting for integration runtime initialization...");
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
          `Integration ${extension.manifest.name} for ${path}: installed=${installed}, bundled=${isBundled}`,
        );

        if (installed) {
          logger.debug("BufferStore", `Integration ready for ${path}`);
        } else {
          logger.debug(
            "BufferStore",
            `Integration ${extension.manifest.name} not installed for ${path}`,
          );

          emitAppEvent("extension-install-needed", {
            extensionId: extension.manifest.id,
            extensionName: extension.manifest.displayName,
            filePath: path,
          });
        }
      } else {
        logger.debug("BufferStore", `No integration available for ${path}`);
      }
    })
    .catch((error) => {
      logger.error("BufferStore", "Failed to check integration support:", error);
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

function closeBrowserTabs(bufferIds: string[]) {
  if (bufferIds.length === 0) return;
  void import("@/features/browser/services/browser-tab-manager").then(({ browserTabManager }) => {
    for (const bufferId of bufferIds) browserTabManager.close(bufferId);
  });
}

const createBufferStore = (workspaceId: string) => {
  const paneStore = usePaneStore.getStore(workspaceId);
  const paneActions = () => paneStore.getState().actions;
  const getActiveBufferIdInWorkspace = () => selectActiveBufferId(paneStore.getState());
  const getPaneReplacementBufferId = (closingBufferIds: string[], buffers: PaneContent[]) =>
    getWorkspacePaneReplacementBufferId(closingBufferIds, buffers, workspaceId);

  const getTargetPane = (paneId: string | undefined) => {
    const paneState = paneStore.getState();
    return (paneId ? paneState.actions.getPaneById(paneId) : null) ?? selectActivePane(paneState);
  };

  /** The new-tab page the target pane shows, which the next opened buffer takes over. */
  const getActiveNewTabBufferId = (buffers: PaneContent[], paneId?: string): string | null => {
    const buffer = getBufferById(buffers, getTargetPane(paneId)?.activeBufferId);
    return buffer?.type === "newTab" ? buffer.id : null;
  };

  /** The preview tab of the pane a new buffer would open in, if it has one. */
  const getWritablePanePreviewBufferId = (paneId?: string): string | null => {
    const paneState = paneStore.getState();
    const targetPane = paneId ? paneState.actions.getPaneById(paneId) : null;
    if (targetPane) return targetPane.previewBufferId ?? null;
    const writablePane = resolveWritablePaneForBuffer({
      activePane: selectActivePane(paneState),
      bottomRoot: paneState.bottomRoot,
      mostRecentActivePaneIds: paneState.mostRecentActivePaneIds,
      root: paneState.root,
    });
    return writablePane?.previewBufferId ?? null;
  };

  const forgetBufferState = (bufferId: string) => {
    cleanupBufferHistoryTracking(bufferId, workspaceId);
    forgetLiveDocument(bufferId);
  };

  return createStore<BufferState>()(
    immer((set, get) => {
      const saveWorkspaceSession = () => {
        const projectPath = useProjectStore.getStore(workspaceId).getState().rootFolderPath;
        const paneState = paneStore.getState();
        saveSessionToStore(projectPath, {
          buffers: get().buffers,
          activeBufferId: selectActiveBufferId(paneState),
          ...selectPaneBufferFlags(paneState),
        });
      };

      /**
       * Registers a buffer and shows it in one pane update. Buffers it replaces or evicts leave the
       * panes in that same update and the registry right after.
       */
      const addAndShowBuffer = (
        newBuffer: PaneContent,
        {
          paneId,
          preview,
          replaceBufferIds = [],
          closeBufferIds = [],
          consumeNewTab = true,
          evict = true,
          includePreviewsInEviction,
        }: AddBufferOptions = {},
      ): string => {
        const { buffers, maxOpenTabs } = get();
        const replaced = [...replaceBufferIds];
        const newTabBufferId = consumeNewTab ? getActiveNewTabBufferId(buffers, paneId) : null;
        if (newTabBufferId && !replaced.includes(newTabBufferId)) replaced.push(newTabBufferId);

        const closed = [...closeBufferIds];
        if (evict) {
          const leaving = new Set([...replaced, ...closed]);
          const { evictedBuffer } = evictLeastRecentAutoClosableBuffer(
            buffers.filter((buffer) => !leaving.has(buffer.id)),
            maxOpenTabs,
            {
              ...selectPaneBufferFlags(paneStore.getState()),
              ...(includePreviewsInEviction === undefined
                ? {}
                : { includePreviews: includePreviewsInEviction }),
            },
          );
          if (evictedBuffer) closed.push(evictedBuffer.id);
        }

        set((state) => {
          state.buffers.push(newBuffer);
        });
        paneActions().placeBuffer(newBuffer.id, {
          paneId,
          preview,
          replaceBufferIds: replaced,
          closeBufferIds: closed,
        });

        const dropped = new Set([...replaced, ...closed]);
        if (dropped.size > 0) {
          for (const bufferId of dropped) forgetBufferState(bufferId);
          set((state) => {
            state.buffers = state.buffers.filter((buffer) => !dropped.has(buffer.id));
          });
        }
        return newBuffer.id;
      };

      const showExistingBuffer = (
        bufferId: string,
        { reveal = false, paneId, preview, update }: ShowExistingBufferOptions = {},
      ): string => {
        if (update) {
          set((state) => {
            update(state.buffers.find((buffer) => buffer.id === bufferId));
          });
        }
        paneActions().placeBuffer(bufferId, { paneId, reveal, preview });
        return bufferId;
      };

      /**
       * Tabs in the order the strip of the pane showing `bufferId` draws them (pinned first), for
       * "close to the left/right". Falls back to the registry order for a buffer no pane shows.
       */
      const getTabStripOrder = (bufferId: string): PaneContent[] => {
        const { buffers } = get();
        const paneState = paneStore.getState();
        const activePane = selectActivePane(paneState);
        const pane = activePane?.bufferIds.includes(bufferId)
          ? activePane
          : paneState.actions.getPaneByBufferId(bufferId);
        if (!pane) return buffers;

        const pinned = new Set(pane.pinnedBufferIds ?? []);
        const ordered = [
          ...pane.bufferIds.filter((id) => pinned.has(id)),
          ...pane.bufferIds.filter((id) => !pinned.has(id)),
        ];
        return ordered
          .map((id) => getBufferById(buffers, id))
          .filter((buffer): buffer is PaneContent => buffer !== null);
      };

      const switchBufferInActivePane = (offset: 1 | -1) => {
        const activePane = selectActivePane(paneStore.getState());
        if (!activePane) return;
        const cyclableIds = getExistingPaneBufferIds(activePane.bufferIds, get().buffers);
        if (cyclableIds.length <= 1) return;

        const currentIndex = cyclableIds.indexOf(getActiveBufferIdInWorkspace() ?? "");
        const nextIndex =
          currentIndex === -1 && offset === -1
            ? cyclableIds.length - 1
            : (currentIndex + offset + cyclableIds.length) % cyclableIds.length;
        paneActions().placeBuffer(cyclableIds[nextIndex], { paneId: activePane.id });
        saveWorkspaceSession();
      };

      /** An edited preview tab becomes a definite one (the pane owns the preview flag). */
      const promotePreviewBuffer = (bufferId: string) => {
        if (selectIsBufferPreview(paneStore.getState(), bufferId)) {
          paneActions().clearPreviewBufferEverywhere(bufferId);
        }
      };

      /** Lets go of what a closed buffer held outside the stores (sessions, LSP, webviews). */
      const releaseClosedBuffer = (closedBuffer: PaneContent) => {
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
          closeTerminalConnection({ connectionId: closedBuffer.terminalConnectionId }).catch(
            (e) => {
              logger.error("BufferStore", "Failed to close external editor terminal:", e);
            },
          );
        }

        // Close terminal session for terminal tab buffers
        if (closedBuffer.type === "terminal") {
          import("@/features/terminal/stores/terminal.store").then(({ useTerminalStore }) => {
            const terminalStore = useTerminalStore.getStore(workspaceId).getState();
            const session = terminalStore.actions.getSession(closedBuffer.sessionId);
            if (session?.connectionId) {
              closeTerminalConnection(session).catch((e) => {
                logger.error("BufferStore", "Failed to close terminal tab session:", e);
              });
            }
            terminalStore.actions.removeSession(closedBuffer.sessionId);
          });
        }

        if (closedBuffer.type === "browser") {
          closeBrowserTabs([closedBuffer.id]);
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
      };

      /** Closes buffers for good: panes drop them in one update, then the registry does. */
      const closeBuffersForce = (bufferIds: readonly string[]) => {
        for (const bufferId of bufferIds) flushLiveDocument(bufferId);
        const { buffers, closedBuffersHistory } = get();
        const closingIds = new Set(bufferIds);
        const closingBuffers = buffers.filter((buffer) => closingIds.has(buffer.id));
        if (closingBuffers.length === 0) return;
        const closingBufferIds = closingBuffers.map((buffer) => buffer.id);

        const paneState = paneStore.getState();
        const activeBufferId = selectActiveBufferId(paneState);
        const { pinnedBufferIds } = selectPaneBufferFlags(paneState);
        const replacementBufferId =
          activeBufferId && closingIds.has(activeBufferId)
            ? getPaneReplacementBufferId(closingBufferIds, buffers)
            : null;

        let history = closedBuffersHistory;
        for (const closedBuffer of closingBuffers) {
          cleanupBufferHistoryTracking(closedBuffer.id, workspaceId);
          savedContentTracker.forget(closedBuffer.id);
          forgetLiveDocument(closedBuffer.id);
          releaseClosedBuffer(closedBuffer);

          const entry = buildClosedBufferHistoryEntry(
            closedBuffer,
            pinnedBufferIds.has(closedBuffer.id),
          );
          if (entry) {
            const key = getClosedBufferHistoryKey(entry);
            history = [
              entry,
              ...history.filter((item) => getClosedBufferHistoryKey(item) !== key),
            ].slice(0, EDITOR_CONSTANTS.MAX_CLOSED_BUFFERS_HISTORY);
          }
        }

        paneActions().removeBuffers(closingBufferIds, { revealBufferId: replacementBufferId });
        set((state) => {
          state.buffers = state.buffers.filter((buffer) => !closingIds.has(buffer.id));
          state.closedBuffersHistory = history;
        });
        saveWorkspaceSession();
      };

      return {
        buffers: [],
        maxOpenTabs: defaultSettings.maxOpenTabs,
        pendingClose: null,
        closedBuffersHistory: [],
        actions: {
          openContent: (spec: OpenContentSpec, options: OpenContentOptions = {}): string => {
            const { buffers } = get();
            const targetPaneId = options.paneId;
            const addAndShow = (buffer: PaneContent, addOptions: AddBufferOptions = {}) =>
              addAndShowBuffer(buffer, { ...addOptions, paneId: targetPaneId });
            const showExisting = (bufferId: string, showOptions: ShowExistingBufferOptions = {}) =>
              showExistingBuffer(bufferId, { ...showOptions, paneId: targetPaneId });

            const openNewContent = (path: string, options: OpenNewContentOptions = {}) => {
              const newBuffer = createPaneContent(generateBufferId(path), spec);
              addAndShow(newBuffer, {
                includePreviewsInEviction: options.includePreviewsInEviction,
              });
              if (options.saveSession) {
                saveWorkspaceSession();
              }
              return newBuffer.id;
            };

            switch (spec.type) {
              case "editor": {
                const shouldBePreview = spec.isPreview ?? false;

                const existing = getBufferByPath(buffers, spec.path);
                if (existing) {
                  return showExisting(existing.id, {
                    preview: shouldBePreview ? undefined : false,
                  });
                }

                const replacedPreviewId = shouldBePreview
                  ? getWritablePanePreviewBufferId(targetPaneId)
                  : null;
                const newBuffer = createPaneContent(
                  generateBufferId(spec.path),
                  spec,
                ) as EditorContent;
                addAndShow(newBuffer, {
                  preview: shouldBePreview || undefined,
                  replaceBufferIds:
                    replacedPreviewId && getBufferById(buffers, replacedPreviewId)
                      ? [replacedPreviewId]
                      : [],
                  includePreviewsInEviction: false,
                });

                // Track in recent files and check extensions (only for real files)
                if (shouldStartLsp(newBuffer)) {
                  scheduleExtensionSupportCheck(spec.path);
                }

                saveWorkspaceSession();
                return newBuffer.id;
              }

              case "terminal": {
                const terminalCount = buffers.filter((b) => b.type === "terminal").length;
                const terminalNumber = terminalCount + 1;
                const sessionId = spec.sessionId ?? `terminal-tab-${crypto.randomUUID()}`;
                const path = spec.path ?? `terminal://${sessionId}`;
                const displayName = spec.name ?? `Terminal ${terminalNumber}`;

                const existing = buffers.find(
                  (b) => b.type === "terminal" && b.sessionId === sessionId,
                );
                if (existing) {
                  return showExisting(existing.id);
                }

                const newBuffer = createPaneContent(generateBufferId(path), {
                  ...spec,
                  name: displayName,
                  sessionId,
                  path,
                }) as TerminalContent;
                newBuffer.path = path;
                newBuffer.name = displayName;

                addAndShow(newBuffer);
                saveWorkspaceSession();
                return newBuffer.id;
              }

              case "browser": {
                if (spec.path) {
                  const existing = buffers.find(
                    (b) => b.type === "browser" && b.path === spec.path,
                  );
                  if (existing) {
                    return showExisting(existing.id);
                  }
                }

                const path = spec.path ?? `browser://${crypto.randomUUID()}`;
                const newBuffer = createPaneContent(generateBufferId(path), { ...spec, path });
                addAndShow(newBuffer);
                saveWorkspaceSession();
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
                    return showExisting(existing.id, { reveal: true });
                  }
                }

                const agentNumber = agentCount + 1;
                const agentSessionId = spec.sessionId ?? `agent-tab-${Date.now()}`;
                const path = `agent://${agentSessionId}`;
                const displayName = `Agent ${agentNumber}`;

                const newBuffer = createPaneContent(generateBufferId(path), {
                  ...spec,
                  sessionId: agentSessionId,
                });
                newBuffer.path = path;
                newBuffer.name = displayName;

                addAndShow(newBuffer);
                saveWorkspaceSession();
                return newBuffer.id;
              }

              case "newTab": {
                const newBuffer = createPaneContent(
                  generateBufferId(`newtab://${newTabSequence++}`),
                  spec,
                );
                addAndShow(newBuffer, { consumeNewTab: false });
                saveWorkspaceSession();
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
                  return showExisting(existing.id, {
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
                  return showExisting(existing.id, {
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

              case "githubDelivery": {
                const path = deliveryBufferPath(spec.kind, spec.repoPath, spec.resourceId ?? "new");
                const existing = buffers.find(
                  (buffer) => buffer.type === "githubDelivery" && buffer.path === path,
                );
                if (existing) return showExisting(existing.id);
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
                  return showExisting(existing.id, {
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
                  return showExisting(existing.id);
                }

                return openNewContent(path);
              }

              case "customView": {
                const path = getViewBufferPath(spec.projectPath, spec.viewId);
                const existing = getBufferByPath(buffers, path);
                if (existing) {
                  return showExisting(existing.id);
                }

                return openNewContent(path);
              }

              case "extension": {
                const path = `extension://${encodeURIComponent(spec.extensionId)}`;
                const existing = buffers.find(
                  (buffer) =>
                    buffer.type === "extension" && buffer.extensionId === spec.extensionId,
                );
                if (existing) {
                  return showExisting(existing.id, {
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
                  return showExisting(existing.id);
                }

                const existingExternalEditor = buffers.find((b) => b.type === "externalEditor");
                if (existingExternalEditor?.type === "externalEditor") {
                  closeTerminalConnection({
                    connectionId: existingExternalEditor.terminalConnectionId,
                  }).catch((e) => {
                    logger.error("BufferStore", "Failed to close old external editor terminal:", e);
                  });
                }

                const newBuffer = createPaneContent(generateBufferId(spec.path), spec);
                addAndShow(newBuffer, {
                  closeBufferIds: existingExternalEditor ? [existingExternalEditor.id] : [],
                  evict: false,
                });
                saveWorkspaceSession();
                return newBuffer.id;
              }

              case "globalSearch":
              case "diagnostics":
              case "references":
              case "continuousAgents":
              case "acpInspector":
              case "agentChanges":
              case "workspaces":
              case "settings":
              case "extensions": {
                const existing = buffers.find((b) => b.type === spec.type);
                if (existing) {
                  return showExisting(existing.id, { reveal: true });
                }

                return openNewContent(SINGLETON_TOOL_BUFFER_METADATA[spec.type].path);
              }

              case "onboarding": {
                const path = `onboarding://${spec.context.mode}/${spec.context.currentVersion}`;
                const existing = getBufferByPath(buffers, path);
                if (existing) {
                  return showExisting(existing.id, { reveal: true });
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
              case "csvPreview":
              case "svgPreview": {
                const path = spec.path;
                const existing = getBufferByPath(buffers, path);
                if (existing) {
                  return showExisting(existing.id, {
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
            openOptions?: OpenContentOptions,
          ): string => {
            return get().actions.openContent(
              {
                type: "externalEditor",
                path,
                name,
                terminalConnectionId,
              },
              openOptions,
            );
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
            openOptions?: OpenContentOptions,
          ): string => {
            return get().actions.openContent(
              {
                type: "pullRequest",
                prNumber,
                name: metadata?.title,
                repoPath: metadata?.repoPath,
                authorAvatarUrl: metadata?.authorAvatarUrl,
                selectedFilePath: metadata?.selectedFilePath,
                initialView: metadata?.initialView,
              },
              openOptions,
            );
          },

          openGitHubIssueBuffer: (
            { issueNumber, repoPath, title, authorAvatarUrl, url },
            openOptions,
          ): string => {
            return get().actions.openContent(
              {
                type: "githubIssue",
                issueNumber,
                repoPath,
                name: title,
                authorAvatarUrl,
                url,
              },
              openOptions,
            );
          },

          openGitHubActionBuffer: (options, openOptions): string => {
            const common = {
              type: "githubAction" as const,
              repoPath: options.repoPath,
              name: options.title,
              url: options.url,
            };

            if (options.runId !== undefined) {
              return get().actions.openContent({ ...common, runId: options.runId }, openOptions);
            }

            return get().actions.openContent(
              { ...common, notification: options.notification },
              openOptions,
            );
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

          openTerminalBuffer: (options, openOptions): string => {
            return get().actions.openContent(
              {
                type: "terminal",
                name: options?.name,
                shell: options?.shell,
                command: options?.command,
                workingDirectory: options?.workingDirectory,
                remoteConnectionId: options?.remoteConnectionId,
                sessionId: options?.sessionId,
              },
              openOptions,
            );
          },

          openAgentBuffer: (sessionId?: string): string => {
            return get().actions.openContent({ type: "agent", sessionId });
          },

          openBrowserBuffer: (url?: string): string => {
            return get().actions.openContent({ type: "browser", url });
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

          openContinuousAgentsBuffer: (): string => {
            return get().actions.openContent({ type: "continuousAgents" });
          },

          openAcpInspectorBuffer: (): string => {
            return get().actions.openContent({ type: "acpInspector" });
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

            if (isDirtyContent(buffer)) {
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
            closeBuffersForce([bufferId]);
          },

          closeBuffersBatch: (bufferIds: string[], skipSessionSave = false) => {
            if (bufferIds.length === 0) return;

            for (const id of bufferIds) forgetLiveDocument(id);
            const { buffers } = get();
            const closingBufferIds = new Set(bufferIds);
            const activeBufferId = getActiveBufferIdInWorkspace();
            const replacementBufferId =
              activeBufferId && closingBufferIds.has(activeBufferId)
                ? getPaneReplacementBufferId(bufferIds, buffers)
                : null;

            closeBrowserTabs(
              buffers
                .filter((buffer) => buffer.type === "browser" && closingBufferIds.has(buffer.id))
                .map((buffer) => buffer.id),
            );
            paneActions().removeBuffers(bufferIds, { revealBufferId: replacementBufferId });
            set((state) => {
              state.buffers = state.buffers.filter((b) => !closingBufferIds.has(b.id));
            });

            if (!skipSessionSave) {
              saveWorkspaceSession();
            }
          },

          setActiveBuffer: (bufferId: string, paneId?: string) => {
            if (!getBufferById(get().buffers, bufferId)) return;
            const previousActiveBufferId = getActiveBufferIdInWorkspace();
            paneActions().placeBuffer(bufferId, { paneId, reveal: true });
            if (previousActiveBufferId !== bufferId) {
              saveWorkspaceSession();
            }
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

            if (readBufferText(buffer) === content && !diffData) return;

            let promotedPreviewBufferId: string | null = null;
            const contentRevision = buffer.type === "editor" ? readBufferRevision(buffer) + 1 : 0;
            if (buffer.type === "editor") discardLiveDocumentChanges(bufferId);
            set((state) => {
              const buf = state.buffers.find((b) => b.id === bufferId);
              if (!buf || !isEditableContent(buf)) return;

              buf.content = content;
              if (buf.type === "editor") {
                buf.contentRevision = contentRevision;
              }
              if (diffData && buf.type === "diff") {
                buf.diffData = diffData;
              }
              if (buf.type === "editor" && !buf.isVirtual) {
                if (!markDirty) {
                  buf.savedContent = content;
                  buf.isDirty = false;
                } else {
                  buf.isDirty = content !== buf.savedContent;
                  if (buf.isDirty) {
                    promotedPreviewBufferId = buf.id;
                  }
                }
              } else if (buf.type === "diff") {
                buf.savedContent = content;
              }
            });

            if (promotedPreviewBufferId) {
              promotePreviewBuffer(promotedPreviewBufferId);
            }

            if (buffer.type === "editor") {
              publishEditorDocumentChange({
                bufferId,
                filePath: buffer.path,
                sourceId: "buffer-store",
                modelSessionId: `buffer-${bufferId}`,
                modelVersionId: contentRevision,
                changes: [],
                eol: content.includes("\r\n") ? "\r\n" : "\n",
                isEolChange: false,
                isFlush: true,
                isUndoing: false,
                isRedoing: false,
                fullContent: content,
              });
            }
          },

          applyBufferContentChanges: (bufferId, batch, markDirty = true) => {
            const buffer = getBufferById(get().buffers, bufferId);
            if (!buffer || !isEditorContent(buffer)) {
              return { accepted: false, synchronized: false, contentRevision: 0 };
            }

            const lastAppliedVersion = lastAppliedModelVersionByBuffer.get(bufferId);
            if (
              lastAppliedVersion?.modelSessionId === batch.modelSessionId &&
              batch.modelVersionId <= lastAppliedVersion.modelVersionId
            ) {
              return {
                accepted: false,
                synchronized: true,
                contentRevision: buffer.contentRevision ?? 0,
              };
            }

            // A delta that does not land cleanly is refused rather than guessed at; the editor then
            // resends the model's full text.
            const currentContent = readBufferText(buffer);
            const nextContent =
              batch.fullContent ??
              (batch.isFlush || batch.isEolChange
                ? null
                : applyEditorTextChanges(currentContent, batch.changes));
            if (
              nextContent === null ||
              (batch.fullContent === undefined &&
                batch.expectedContentLength !== undefined &&
                nextContent.length !== batch.expectedContentLength)
            ) {
              return {
                accepted: false,
                synchronized: false,
                contentRevision: buffer.contentRevision ?? 0,
              };
            }

            const contentRevision = readBufferRevision(buffer) + 1;
            discardLiveDocumentChanges(bufferId);
            let isDirty = false;
            if (!buffer.isVirtual) {
              if (markDirty) {
                isDirty = savedContentTracker.isDirtyAfterChanges(
                  bufferId,
                  currentContent,
                  nextContent,
                  buffer.savedContent,
                  batch.fullContent === undefined ? batch.changes : [],
                );
              } else {
                savedContentTracker.markSaved(bufferId, nextContent);
              }
            }
            let promotedPreviewBufferId: string | null = null;
            set((state) => {
              const current = state.buffers.find((item) => item.id === bufferId);
              if (!current || !isEditorContent(current)) return;
              current.content = nextContent;
              current.contentRevision = contentRevision;
              if (current.isVirtual) return;
              if (!markDirty) {
                current.savedContent = nextContent;
                current.isDirty = false;
              } else {
                current.isDirty = isDirty;
                if (current.isDirty) {
                  promotedPreviewBufferId = current.id;
                }
              }
            });
            lastAppliedModelVersionByBuffer.set(bufferId, {
              modelSessionId: batch.modelSessionId,
              modelVersionId: batch.modelVersionId,
            });

            if (promotedPreviewBufferId) {
              promotePreviewBuffer(promotedPreviewBufferId);
            }

            publishEditorDocumentChange({
              ...batch,
              bufferId,
              filePath: buffer.path,
            });
            return { accepted: true, synchronized: true, contentRevision };
          },

          applyLiveDocumentChange: (bufferId, batch, edit, trackVirtualDirty = false) => {
            const buffer = getBufferById(get().buffers, bufferId);
            if (!buffer || !isEditorContent(buffer)) {
              return { accepted: false, synchronized: false, contentRevision: 0 };
            }

            const lastAppliedVersion = lastAppliedModelVersionByBuffer.get(bufferId);
            if (
              lastAppliedVersion?.modelSessionId === batch.modelSessionId &&
              batch.modelVersionId <= lastAppliedVersion.modelVersionId
            ) {
              return {
                accepted: false,
                synchronized: true,
                contentRevision: readBufferRevision(buffer),
              };
            }

            const contentRevision = readBufferRevision(buffer) + 1;
            markLiveDocumentChanged(bufferId, edit, contentRevision, (text, revision) => {
              const current = getBufferById(get().buffers, bufferId);
              if (!current || !isEditorContent(current)) return;
              if ((current.contentRevision ?? 0) >= revision) return;
              set((state) => {
                const target = getBufferById(state.buffers, bufferId);
                if (!target || !isEditorContent(target)) return;
                target.content = text;
                target.contentRevision = revision;
              });
            });
            lastAppliedModelVersionByBuffer.set(bufferId, {
              modelSessionId: batch.modelSessionId,
              modelVersionId: batch.modelVersionId,
            });

            if (!buffer.isVirtual || trackVirtualDirty) {
              const isDirty = !liveDocumentMatchesSaved(
                bufferId,
                edit.doc,
                buffer.savedContent,
                edit.view.getSeparator(),
              );
              if (isDirty && !buffer.isVirtual) {
                promotePreviewBuffer(bufferId);
              }
              if (isDirty !== buffer.isDirty) {
                set((state) => {
                  const current = getBufferById(state.buffers, bufferId);
                  if (!current || !isEditorContent(current)) return;
                  current.isDirty = isDirty;
                });
              }
            }

            publishEditorDocumentChange({
              ...batch,
              bufferId,
              filePath: buffer.path,
            });
            return { accepted: true, synchronized: true, contentRevision };
          },

          updateBufferLanguage: (bufferId: string, language: string) => {
            set((state) => {
              const buffer = state.buffers.find((b) => b.id === bufferId);
              if (buffer && isEditorContent(buffer)) {
                buffer.languageOverride = language;
              }
            });
          },

          updateImageDraft: (bufferId, draft) => {
            let isDirty = false;
            set((state) => {
              const buffer = state.buffers.find((item) => item.id === bufferId);
              if (!buffer || buffer.type !== "image") return;
              buffer.imageDraft = draft;
              isDirty = isDirtyContent(buffer);
            });
            if (isDirty) promotePreviewBuffer(bufferId);
          },

          markBufferDirty: (bufferId: string, isDirty: boolean) => {
            const original = getBufferById(get().buffers, bufferId);
            const currentText = !isDirty && original ? readBufferText(original) : null;
            set((state) => {
              const buffer = state.buffers.find((b) => b.id === bufferId);
              if (buffer && isEditorContent(buffer)) {
                buffer.isDirty = isDirty;
                if (currentText !== null) {
                  buffer.savedContent = currentText;
                }
              }
            });
            if (currentText !== null) rememberSavedText(bufferId, currentText);
          },

          markBufferSaved: (bufferId: string, content: string, path?: string) => {
            const original = getBufferById(get().buffers, bufferId);
            if (!original || !isEditorContent(original)) return;
            const isDirty = readBufferText(original) !== content;
            if (!isDirty) {
              savedContentTracker.markSaved(bufferId, content);
              rememberSavedText(bufferId, content);
            }
            set((state) => {
              const buffer = state.buffers.find((item) => item.id === bufferId);
              if (!buffer || !isEditorContent(buffer)) return;
              buffer.savedContent = content;
              buffer.isDirty = isDirty;
              if (path !== undefined) {
                buffer.path = path;
                buffer.name = getBaseName(path);
                buffer.isVirtual = false;
                buffer.language = detectLanguageFromFileName(buffer.name);
              }
            });
          },

          updateBufferPath: (bufferId: string, newPath: string) => {
            const newName = newPath.split("/").pop() || newPath;
            const original = getBufferById(get().buffers, bufferId);
            const currentText = original ? readBufferText(original) : "";
            set((state) => {
              const buffer = state.buffers.find((b) => b.id === bufferId);
              if (buffer && isEditorContent(buffer)) {
                buffer.path = newPath;
                buffer.name = newName;
                buffer.isVirtual = false;
                buffer.savedContent = currentText;
                buffer.language = detectLanguageFromFileName(newName);
              }
            });
          },

          updateBrowserBuffer: (bufferId, patch) => {
            const buffer = getBufferById(get().buffers, bufferId);
            if (buffer?.type !== "browser") return;
            const changed = (Object.keys(patch) as (keyof typeof patch)[]).filter(
              (key) => patch[key] !== buffer[key],
            );
            if (changed.length === 0) return;

            set((state) => {
              const target = getBufferById(state.buffers, bufferId);
              if (target?.type === "browser") Object.assign(target, patch);
            });
            if (changed.some((key) => key !== "favicon")) {
              saveWorkspaceSession();
            }
          },

          updateBuffer: (updatedBuffer: PaneContent) => {
            const currentBuffer = getBufferById(get().buffers, updatedBuffer.id);
            const contentChanged =
              currentBuffer?.type === "editor" &&
              updatedBuffer.type === "editor" &&
              currentBuffer.content !== updatedBuffer.content;
            const nextBuffer =
              currentBuffer?.type === "editor" && updatedBuffer.type === "editor"
                ? {
                    ...updatedBuffer,
                    contentRevision: contentChanged
                      ? readBufferRevision(currentBuffer) + 1
                      : (currentBuffer.contentRevision ?? updatedBuffer.contentRevision ?? 0),
                  }
                : updatedBuffer;
            if (contentChanged) discardLiveDocumentChanges(updatedBuffer.id);
            set((state) => {
              const index = state.buffers.findIndex((b) => b.id === updatedBuffer.id);
              if (index !== -1) {
                state.buffers[index] = nextBuffer;
              }
            });
            if (contentChanged && nextBuffer.type === "editor") {
              publishEditorDocumentChange({
                bufferId: nextBuffer.id,
                filePath: nextBuffer.path,
                sourceId: "buffer-store",
                modelSessionId: `buffer-${nextBuffer.id}`,
                modelVersionId: nextBuffer.contentRevision ?? 0,
                changes: [],
                eol: nextBuffer.content.includes("\r\n") ? "\r\n" : "\n",
                isEolChange: false,
                isFlush: true,
                isUndoing: false,
                isRedoing: false,
                fullContent: nextBuffer.content,
              });
            }
          },

          handleTabClick: (bufferId: string) => {
            get().actions.setActiveBuffer(bufferId);
          },

          handleTabClose: (bufferId: string) => {
            get().actions.closeBuffer(bufferId);
          },

          handleTabPin: (bufferId: string) => {
            if (!getBufferById(get().buffers, bufferId)) return;
            const isPinned = selectPaneBufferFlags(paneStore.getState()).pinnedBufferIds.has(
              bufferId,
            );
            paneActions().setBufferPinnedEverywhere(bufferId, !isPinned);
            saveWorkspaceSession();
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
            if (!selectIsBufferPreview(paneStore.getState(), bufferId)) return;
            paneActions().clearPreviewBufferEverywhere(bufferId);
            saveWorkspaceSession();
          },

          handleCloseOtherTabs: (keepBufferId: string) => {
            const { buffers } = get();
            const { pinnedBufferIds } = selectPaneBufferFlags(paneStore.getState());
            const buffersToClose = buffers.filter(
              (b) => b.id !== keepBufferId && !pinnedBufferIds.has(b.id),
            );

            const dirtyBuffer = buffersToClose.find(isDirtyContent);
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

            closeBuffersForce(buffersToClose.map((buffer) => buffer.id));
          },

          handleCloseAllTabs: () => {
            const { buffers } = get();
            const { pinnedBufferIds } = selectPaneBufferFlags(paneStore.getState());
            const buffersToClose = buffers.filter((b) => !pinnedBufferIds.has(b.id));

            const dirtyBuffer = buffersToClose.find(isDirtyContent);
            if (dirtyBuffer) {
              set((state) => {
                state.pendingClose = {
                  bufferId: dirtyBuffer.id,
                  type: "all",
                };
              });
              return;
            }

            closeBuffersForce(buffersToClose.map((buffer) => buffer.id));
          },

          handleCloseSavedTabs: () => {
            const { buffers } = get();
            const { pinnedBufferIds } = selectPaneBufferFlags(paneStore.getState());
            const buffersToClose = buffers.filter(
              (buffer) => !pinnedBufferIds.has(buffer.id) && !isDirtyContent(buffer),
            );

            closeBuffersForce(buffersToClose.map((buffer) => buffer.id));
          },

          handleCloseTabsToLeft: (bufferId: string) => {
            const tabs = getTabStripOrder(bufferId);
            const bufferIndex = tabs.findIndex((b) => b.id === bufferId);
            if (bufferIndex === -1) return;

            const { pinnedBufferIds } = selectPaneBufferFlags(paneStore.getState());
            const buffersToClose = tabs
              .slice(0, bufferIndex)
              .filter((b) => !pinnedBufferIds.has(b.id));

            const dirtyBuffer = buffersToClose.find(isDirtyContent);
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

            closeBuffersForce(buffersToClose.map((buffer) => buffer.id));
          },

          handleCloseTabsToRight: (bufferId: string) => {
            const tabs = getTabStripOrder(bufferId);
            const bufferIndex = tabs.findIndex((b) => b.id === bufferId);
            if (bufferIndex === -1) return;

            const { pinnedBufferIds } = selectPaneBufferFlags(paneStore.getState());
            const buffersToClose = tabs
              .slice(bufferIndex + 1)
              .filter((b) => !pinnedBufferIds.has(b.id));

            const dirtyBuffer = buffersToClose.find(isDirtyContent);
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

            closeBuffersForce(buffersToClose.map((buffer) => buffer.id));
          },

          switchToNextBuffer: () => {
            switchBufferInActivePane(1);
          },

          switchToPreviousBuffer: () => {
            switchBufferInActivePane(-1);
          },

          getActiveBuffer: (): PaneContent | null => {
            return getBufferById(get().buffers, getActiveBufferIdInWorkspace());
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

          confirmCloseAfterSaving: (request) => {
            if (get().pendingClose !== request) return false;
            const buffer = getBufferById(get().buffers, request.bufferId);
            if (!buffer || isDirtyContent(buffer)) return false;
            set((state) => {
              state.pendingClose = null;
            });
            if (request.type === "single") get().actions.closeBufferForce(request.bufferId);
            else continueCloseGroup(get().actions, request);
            return true;
          },

          confirmCloseWithoutSaving: () => {
            const request = get().pendingClose;
            if (!request) return;
            set((state) => {
              state.pendingClose = null;
            });
            const buffer = getBufferById(get().buffers, request.bufferId);
            const isPinned = selectPaneBufferFlags(paneStore.getState()).pinnedBufferIds.has(
              request.bufferId,
            );
            if (request.type === "single" || (buffer && !isPinned)) {
              get().actions.closeBufferForce(request.bufferId);
            }
            if (request.type !== "single") continueCloseGroup(get().actions, request);
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
                closedBuffer.type === "csvPreview" ||
                closedBuffer.type === "svgPreview"
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
      };
    }),
  );
};

export const useBufferStore = createSelectors(
  createWorkspaceScopedStore("editor-buffer", createBufferStore),
);
