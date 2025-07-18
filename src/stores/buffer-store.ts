import { create } from "zustand";
import { combine } from "zustand/middleware";
import { immer } from "zustand/middleware/immer";

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
  vimMode?: "normal" | "insert" | "visual";
  cursorPosition?: number;
}

interface BufferState {
  buffers: Buffer[];
  activeBufferId: string | null;
  maxOpenTabs: number;
}

const generateBufferId = (path: string): string => {
  return `buffer_${path.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
};

export const useBufferStore = create(
  immer(
    combine(
      {
        buffers: [],
        activeBufferId: null,
        maxOpenTabs: 10,
      } as BufferState,
      (set, get) => ({
        // Core buffer operations
        openBuffer: (
          path: string,
          name: string,
          content: string,
          isImage = false,
          isSQLite = false,
          isDiff = false,
          isVirtual = false,
        ) => {
          const { buffers, maxOpenTabs } = get();

          // Check if already open
          const existing = buffers.find(b => b.path === path);
          if (existing) {
            set(state => {
              state.activeBufferId = existing.id;
              state.buffers = state.buffers.map(b => ({
                ...b,
                isActive: b.id === existing.id,
              }));
            });
            return existing.id;
          }

          // Handle max tabs limit
          let newBuffers = [...buffers];
          if (newBuffers.filter(b => !b.isPinned).length >= maxOpenTabs) {
            const unpinnedBuffers = newBuffers.filter(b => !b.isPinned);
            const lruBuffer = unpinnedBuffers[0]; // Simplified LRU
            newBuffers = newBuffers.filter(b => b.id !== lruBuffer.id);
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
            vimMode: "normal",
            cursorPosition: 0,
          };

          set(state => {
            state.buffers = [...newBuffers.map(b => ({ ...b, isActive: false })), newBuffer];
            state.activeBufferId = newBuffer.id;
          });

          return newBuffer.id;
        },

        closeBuffer: (bufferId: string) => {
          const { buffers, activeBufferId } = get();
          const bufferIndex = buffers.findIndex(b => b.id === bufferId);

          if (bufferIndex === -1) return;

          const newBuffers = buffers.filter(b => b.id !== bufferId);
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

          set(state => {
            state.buffers = newBuffers.map(b => ({
              ...b,
              isActive: b.id === newActiveId,
            }));
            state.activeBufferId = newActiveId;
          });
        },

        setActiveBuffer: (bufferId: string) => {
          set(state => {
            state.activeBufferId = bufferId;
            state.buffers = state.buffers.map(b => ({
              ...b,
              isActive: b.id === bufferId,
            }));
          });
        },

        updateBufferContent: (bufferId: string, content: string, markDirty = true) => {
          const buffer = get().buffers.find(b => b.id === bufferId);
          if (!buffer || buffer.content === content) {
            // Content hasn't changed, don't update
            return;
          }

          set(state => {
            const buffer = state.buffers.find(b => b.id === bufferId);
            if (buffer) {
              buffer.content = content;
              if (markDirty && !buffer.isVirtual) {
                buffer.isDirty = true;
              }
            }
          });
        },

        markBufferDirty: (bufferId: string, isDirty: boolean) => {
          set(state => {
            const buffer = state.buffers.find(b => b.id === bufferId);
            if (buffer) {
              buffer.isDirty = isDirty;
            }
          });
        },

        updateBuffer: (updatedBuffer: Buffer) => {
          set(state => {
            const index = state.buffers.findIndex(b => b.id === updatedBuffer.id);
            if (index !== -1) {
              state.buffers[index] = updatedBuffer;
            }
          });
        },

        updateBufferVimState: (bufferId: string, vimMode: string, cursorPosition: number) => {
          set(state => {
            const buffer = state.buffers.find(b => b.id === bufferId);
            if (buffer) {
              buffer.vimMode = vimMode as any;
              buffer.cursorPosition = cursorPosition;
            }
          });
        },

        // Tab operations - all in one place!
        handleTabClick: (bufferId: string) => {
          set(state => {
            state.activeBufferId = bufferId;
            state.buffers = state.buffers.map(b => ({
              ...b,
              isActive: b.id === bufferId,
            }));
          });
        },

        handleTabClose: (bufferId: string) => {
          useBufferStore.getState().closeBuffer(bufferId);
        },

        handleTabPin: (bufferId: string) => {
          set(state => {
            const buffer = state.buffers.find(b => b.id === bufferId);
            if (buffer) {
              buffer.isPinned = !buffer.isPinned;
            }
          });
        },

        handleCloseOtherTabs: (keepBufferId: string) => {
          const { buffers } = get();
          const buffersToClose = buffers.filter(b => b.id !== keepBufferId && !b.isPinned);
          buffersToClose.forEach(buffer => useBufferStore.getState().closeBuffer(buffer.id));
        },

        handleCloseAllTabs: () => {
          const { buffers } = get();
          const buffersToClose = buffers.filter(b => !b.isPinned);
          buffersToClose.forEach(buffer => useBufferStore.getState().closeBuffer(buffer.id));
        },

        handleCloseTabsToRight: (bufferId: string) => {
          const { buffers } = get();
          const bufferIndex = buffers.findIndex(b => b.id === bufferId);
          if (bufferIndex === -1) return;

          const buffersToClose = buffers.slice(bufferIndex + 1).filter(b => !b.isPinned);
          buffersToClose.forEach(buffer => useBufferStore.getState().closeBuffer(buffer.id));
        },

        reorderBuffers: (startIndex: number, endIndex: number) => {
          set(state => {
            const result = Array.from(state.buffers);
            const [removed] = result.splice(startIndex, 1);
            result.splice(endIndex, 0, removed);
            state.buffers = result;
          });
        },

        // Navigation
        switchToNextBuffer: () => {
          const { buffers, activeBufferId } = get();
          if (buffers.length === 0) return;

          const currentIndex = buffers.findIndex(b => b.id === activeBufferId);
          const nextIndex = (currentIndex + 1) % buffers.length;
          set(state => {
            state.activeBufferId = buffers[nextIndex].id;
            state.buffers = state.buffers.map(b => ({
              ...b,
              isActive: b.id === buffers[nextIndex].id,
            }));
          });
        },

        switchToPreviousBuffer: () => {
          const { buffers, activeBufferId } = get();
          if (buffers.length === 0) return;

          const currentIndex = buffers.findIndex(b => b.id === activeBufferId);
          const prevIndex = (currentIndex - 1 + buffers.length) % buffers.length;
          set(state => {
            state.activeBufferId = buffers[prevIndex].id;
            state.buffers = state.buffers.map(b => ({
              ...b,
              isActive: b.id === buffers[prevIndex].id,
            }));
          });
        },

        // Helpers
        getActiveBuffer: (): Buffer | null => {
          const { buffers, activeBufferId } = get();
          return buffers.find(b => b.id === activeBufferId) || null;
        },

        setMaxOpenTabs: (max: number) => {
          set(state => {
            state.maxOpenTabs = max;
          });
        },
      }),
    ),
  ),
);
