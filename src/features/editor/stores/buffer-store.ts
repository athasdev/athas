import isEqual from "fast-deep-equal";
import { immer } from "zustand/middleware/immer";
import { createWithEqualityFn } from "zustand/traditional";
import { detectLanguageFromFileName } from "@/features/editor/utils/language-detection";
import { readFileContent } from "@/features/file-system/controllers/file-operations";
import { useRecentFilesStore } from "@/features/file-system/controllers/recent-files-store";
import type { MultiFileDiff } from "@/features/version-control/diff-viewer/types/diff";
import type { GitDiff } from "@/features/version-control/git/types/git";
import { useSessionStore } from "@/stores/session-store";
import { createSelectors } from "@/utils/zustand-selectors";

interface Buffer {
  id: string;
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  isVirtual: boolean;
  isPinned: boolean;
  isImage: boolean;
  isSQLite: boolean;
  isDiff: boolean;
  isActive: boolean;
  language?: string; // File language for syntax highlighting and formatting
  // For diff buffers, store the parsed diff data (single or multi-file)
  diffData?: GitDiff | MultiFileDiff;
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

interface ClosedBuffer {
  path: string;
  name: string;
  isPinned: boolean;
}

interface BufferState {
  buffers: Buffer[];
  activeBufferId: string | null;
  maxOpenTabs: number;
  pendingClose: PendingClose | null;
  closedBuffersHistory: ClosedBuffer[];
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
  ) => string;
  closeBuffer: (bufferId: string) => void;
  closeBufferForce: (bufferId: string) => void;
  setActiveBuffer: (bufferId: string) => void;
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
}

const generateBufferId = (path: string): string => {
  return `buffer_${path.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
};

const saveSessionToStore = (buffers: Buffer[], activeBufferId: string | null) => {
  // Get the root folder path from file system store
  // We'll import this dynamically to avoid circular dependencies
  import("@/features/file-system/controllers/store").then(({ useFileSystemStore }) => {
    const rootFolderPath = useFileSystemStore.getState().rootFolderPath;

    if (!rootFolderPath) return;

    // Only save real files, not virtual/diff/image/sqlite buffers
    const persistableBuffers = buffers
      .filter((b) => !b.isVirtual && !b.isDiff && !b.isImage && !b.isSQLite)
      .map((b) => ({
        path: b.path,
        name: b.name,
        isPinned: b.isPinned,
      }));

    // Find the active buffer path
    const activeBuffer = buffers.find((b) => b.id === activeBufferId);
    const activeBufferPath =
      activeBuffer &&
      !activeBuffer.isVirtual &&
      !activeBuffer.isDiff &&
      !activeBuffer.isImage &&
      !activeBuffer.isSQLite
        ? activeBuffer.path
        : null;

    useSessionStore.getState().saveSession(rootFolderPath, persistableBuffers, activeBufferPath);
  });
};

export const useBufferStore = createSelectors(
  createWithEqualityFn<BufferState>()(
    immer((set, get) => ({
      buffers: [],
      activeBufferId: null,
      maxOpenTabs: 10,
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
        ) => {
          const { buffers, maxOpenTabs } = get();

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
            return existing.id;
          }

          // Handle max tabs limit
          let newBuffers = [...buffers];
          if (newBuffers.filter((b) => !b.isPinned).length >= maxOpenTabs) {
            const unpinnedBuffers = newBuffers.filter((b) => !b.isPinned);
            const lruBuffer = unpinnedBuffers[0]; // Simplified LRU
            newBuffers = newBuffers.filter((b) => b.id !== lruBuffer.id);
          }

          const newBuffer: Buffer = {
            id: generateBufferId(path),
            path,
            name,
            content,
            isDirty: false,
            isVirtual,
            isPinned: false,
            isImage,
            isSQLite,
            isDiff,
            isActive: true,
            language: detectLanguageFromFileName(name),
            diffData,
            tokens: [],
          };

          set((state) => {
            state.buffers = [...newBuffers.map((b) => ({ ...b, isActive: false })), newBuffer];
            state.activeBufferId = newBuffer.id;
          });

          // Track in recent files (only for real files, not virtual/diff buffers)
          if (!isVirtual && !isDiff && !isImage && !isSQLite) {
            useRecentFilesStore.getState().addOrUpdateRecentFile(path, name);
          }

          // Save session
          saveSessionToStore(get().buffers, get().activeBufferId);

          return newBuffer.id;
        },

        closeBuffer: (bufferId: string) => {
          const buffer = get().buffers.find((b) => b.id === bufferId);

          if (!buffer) return;

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

          const closedBuffer = buffers[bufferIndex];

          // Add to closed history (only real files, not virtual/diff/image/sqlite)
          if (
            !closedBuffer.isVirtual &&
            !closedBuffer.isDiff &&
            !closedBuffer.isImage &&
            !closedBuffer.isSQLite
          ) {
            const closedBufferInfo: ClosedBuffer = {
              path: closedBuffer.path,
              name: closedBuffer.name,
              isPinned: closedBuffer.isPinned,
            };

            // Keep only last 10 closed buffers
            const updatedHistory = [closedBufferInfo, ...closedBuffersHistory].slice(0, 10);

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

        setActiveBuffer: (bufferId: string) => {
          set((state) => {
            state.activeBufferId = bufferId;
            state.buffers = state.buffers.map((b) => ({
              ...b,
              isActive: b.id === bufferId,
            }));
          });
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
                buffer.isDirty = markDirty;
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
          set((state) => {
            state.activeBufferId = bufferId;
            state.buffers = state.buffers.map((b) => ({
              ...b,
              isActive: b.id === bufferId,
            }));
          });
        },

        handleTabClose: (bufferId: string) => {
          get().actions.closeBuffer(bufferId);
        },

        handleTabPin: (bufferId: string) => {
          set((state) => {
            const buffer = state.buffers.find((b) => b.id === bufferId);
            if (buffer) {
              buffer.isPinned = !buffer.isPinned;
            }
          });

          // Save session
          saveSessionToStore(get().buffers, get().activeBufferId);
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

          buffersToClose.forEach((buffer) => get().actions.closeBufferForce(buffer.id));
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

          buffersToClose.forEach((buffer) => get().actions.closeBufferForce(buffer.id));
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

          buffersToClose.forEach((buffer) => get().actions.closeBufferForce(buffer.id));
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
          const { buffers, activeBufferId } = get();
          if (buffers.length === 0) return;

          const currentIndex = buffers.findIndex((b) => b.id === activeBufferId);
          const nextIndex = (currentIndex + 1) % buffers.length;
          set((state) => {
            state.activeBufferId = buffers[nextIndex].id;
            state.buffers = state.buffers.map((b) => ({
              ...b,
              isActive: b.id === buffers[nextIndex].id,
            }));
          });
        },

        switchToPreviousBuffer: () => {
          const { buffers, activeBufferId } = get();
          if (buffers.length === 0) return;

          const currentIndex = buffers.findIndex((b) => b.id === activeBufferId);
          const prevIndex = (currentIndex - 1 + buffers.length) % buffers.length;
          set((state) => {
            state.activeBufferId = buffers[prevIndex].id;
            state.buffers = state.buffers.map((b) => ({
              ...b,
              isActive: b.id === buffers[prevIndex].id,
            }));
          });
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
          if (!buffer || buffer.isVirtual || buffer.isImage || buffer.isSQLite) {
            return;
          }

          try {
            const content = await readFileContent(buffer.path);
            // Update buffer content and clear dirty flag
            useBufferStore.getState().actions.updateBufferContent(bufferId, content, false);
            console.log(`[FileWatcher] Reloaded buffer from disk: ${buffer.path}`);
          } catch (error) {
            console.error(`[FileWatcher] Failed to reload buffer from disk: ${buffer.path}`, error);
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

          // Get the most recent closed buffer
          const [closedBuffer, ...remainingHistory] = closedBuffersHistory;

          // Remove it from history
          set((state) => {
            state.closedBuffersHistory = remainingHistory;
          });

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
            console.warn(`Failed to reopen closed tab: ${closedBuffer.path}`, error);
          }
        },
      },
    })),
    isEqual,
  ),
);

// Ensure syntax highlighting kicks in whenever the active buffer changes,
// even if the editor component effect hasn’t run yet (e.g., fast tab switches).
{
  let lastActiveId: string | null = null;
  useBufferStore.subscribe(async (state) => {
    const activeId = state.activeBufferId;
    if (!activeId || activeId === lastActiveId) return;
    lastActiveId = activeId;
    const buffer = state.buffers.find((b) => b.id === activeId);
    if (!buffer || !buffer.path) return;
    try {
      const mod = await import("@/features/editor/extensions/builtin/syntax-highlighting");
      mod.setSyntaxHighlightingFilePath(buffer.path);
    } catch (e) {
      console.warn("[BufferStore] Failed to trigger syntax highlighting for", buffer.path, e);
    }
  });
}
