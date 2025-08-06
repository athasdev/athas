import isEqual from "fast-deep-equal";
import { immer } from "zustand/middleware/immer";
import { createWithEqualityFn } from "zustand/traditional";
import { createSelectors } from "@/utils/zustand-selectors";
import type { MultiFileDiff } from "../components/diff-viewer/utils/types";
import { readFileContent } from "../file-system/controllers/file-operations";
import { useRecentFilesStore } from "../file-system/controllers/recent-files-store";
import type { GitDiff } from "../utils/git";

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

interface BufferState {
  buffers: Buffer[];
  activeBufferId: string | null;
  maxOpenTabs: number;
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
}

const generateBufferId = (path: string): string => {
  return `buffer_${path.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
};

export const useBufferStore = createSelectors(
  createWithEqualityFn<BufferState>()(
    immer((set, get) => ({
      buffers: [],
      activeBufferId: null,
      maxOpenTabs: 10,
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

          return newBuffer.id;
        },

        closeBuffer: (bufferId: string) => {
          const { buffers, activeBufferId } = get();
          const bufferIndex = buffers.findIndex((b) => b.id === bufferId);

          if (bufferIndex === -1) return;

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
              // Don't clear tokens - syntax highlighter will update them
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
        },

        handleCloseOtherTabs: (keepBufferId: string) => {
          const { buffers } = get();
          const buffersToClose = buffers.filter((b) => b.id !== keepBufferId && !b.isPinned);
          buffersToClose.forEach((buffer) => get().actions.closeBuffer(buffer.id));
        },

        handleCloseAllTabs: () => {
          const { buffers } = get();
          const buffersToClose = buffers.filter((b) => !b.isPinned);
          buffersToClose.forEach((buffer) => get().actions.closeBuffer(buffer.id));
        },

        handleCloseTabsToRight: (bufferId: string) => {
          const { buffers } = get();
          const bufferIndex = buffers.findIndex((b) => b.id === bufferId);
          if (bufferIndex === -1) return;

          const buffersToClose = buffers.slice(bufferIndex + 1).filter((b) => !b.isPinned);
          buffersToClose.forEach((buffer) => get().actions.closeBuffer(buffer.id));
        },

        reorderBuffers: (startIndex: number, endIndex: number) => {
          set((state) => {
            const result = Array.from(state.buffers);
            const [removed] = result.splice(startIndex, 1);
            result.splice(endIndex, 0, removed);
            state.buffers = result;
          });
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
      },
    })),
    isEqual,
  ),
);
