import { useCallback, useReducer } from "react";
import type { Buffer, BufferAction, BufferState } from "../types/buffer";

const generateBufferId = (path: string): string => {
  return `buffer_${path.replace(/[^a-zA-Z0-9]/g, "_")}_${Date.now()}`;
};

const bufferReducer = (state: BufferState, action: BufferAction): BufferState => {
  switch (action.type) {
    case "OPEN_BUFFER": {
      const { path, name, content, isSQLite, isImage, isDiff, isVirtual } = action.payload;

      // Check if buffer already exists for this path
      const existingBuffer = state.buffers.find(buffer => buffer.path === path);
      if (existingBuffer) {
        // If it exists, just make it active
        return {
          ...state,
          activeBufferId: existingBuffer.id,
          buffers: state.buffers.map(buffer => ({
            ...buffer,
            isActive: buffer.id === existingBuffer.id,
          })),
        };
      }

      // Create new buffer
      const newBuffer: Buffer = {
        id: generateBufferId(path),
        path,
        name,
        content,
        isDirty: false,
        isSQLite,
        isImage,
        isDiff,
        isVirtual,
        isActive: true,
        isPinned: false,
        vimMode: "normal",
        cursorPosition: 0,
      };

      return {
        buffers: state.buffers.map(buffer => ({ ...buffer, isActive: false })).concat(newBuffer),
        activeBufferId: newBuffer.id,
      };
    }

    case "CLOSE_BUFFER": {
      const { id } = action.payload;
      const bufferIndex = state.buffers.findIndex(buffer => buffer.id === id);

      if (bufferIndex === -1) return state;

      const newBuffers = state.buffers.filter(buffer => buffer.id !== id);

      // If we're closing the active buffer, switch to another one
      let newActiveBufferId = state.activeBufferId;
      if (state.activeBufferId === id) {
        if (newBuffers.length > 0) {
          // Switch to the next buffer, or previous if we were at the end
          const nextIndex = bufferIndex < newBuffers.length ? bufferIndex : bufferIndex - 1;
          newActiveBufferId = newBuffers[nextIndex]?.id || null;
        } else {
          newActiveBufferId = null;
        }
      }

      return {
        buffers: newBuffers.map(buffer => ({
          ...buffer,
          isActive: buffer.id === newActiveBufferId,
        })),
        activeBufferId: newActiveBufferId,
      };
    }

    case "SET_ACTIVE_BUFFER": {
      const { id } = action.payload;
      return {
        ...state,
        activeBufferId: id,
        buffers: state.buffers.map(buffer => ({
          ...buffer,
          isActive: buffer.id === id,
        })),
      };
    }

    case "UPDATE_BUFFER_CONTENT": {
      const { id, content, markDirty = true } = action.payload;
      // Find the buffer to check if content actually changed
      const existingBuffer = state.buffers.find(buffer => buffer.id === id);
      if (existingBuffer && existingBuffer.content === content) {
        // Content hasn't changed, return state as-is
        return state;
      }

      return {
        ...state,
        buffers: state.buffers.map(buffer =>
          buffer.id === id
            ? { ...buffer, content, isDirty: markDirty ? true : buffer.isDirty }
            : buffer,
        ),
      };
    }

    case "MARK_BUFFER_DIRTY": {
      const { id, isDirty } = action.payload;
      return {
        ...state,
        buffers: state.buffers.map(buffer => (buffer.id === id ? { ...buffer, isDirty } : buffer)),
      };
    }

    case "UPDATE_BUFFER_VIM_STATE": {
      const { id, vimMode, cursorPosition } = action.payload;
      return {
        ...state,
        buffers: state.buffers.map(buffer =>
          buffer.id === id ? { ...buffer, vimMode: vimMode as any, cursorPosition } : buffer,
        ),
      };
    }

    case "UPDATE_BUFFER": {
      const { buffer } = action.payload;
      return {
        ...state,
        buffers: state.buffers.map(b => (b.id === buffer.id ? buffer : b)),
      };
    }

    case "REORDER_BUFFERS": {
      const { fromIndex, toIndex } = action.payload;
      const newBuffers = [...state.buffers];
      const [movedBuffer] = newBuffers.splice(fromIndex, 1);
      newBuffers.splice(toIndex, 0, movedBuffer);

      return {
        ...state,
        buffers: newBuffers,
      };
    }

    default:
      return state;
  }
};

export const useBuffers = () => {
  const [state, dispatch] = useReducer(bufferReducer, {
    buffers: [],
    activeBufferId: null,
  });

  const openBuffer = useCallback(
    (
      path: string,
      name: string,
      content: string,
      isSQLite: boolean = false,
      isImage: boolean = false,
      isDiff: boolean = false,
      isVirtual: boolean = false,
    ) => {
      dispatch({
        type: "OPEN_BUFFER",
        payload: { path, name, content, isSQLite, isImage, isDiff, isVirtual },
      });
    },
    [],
  );

  const closeBuffer = useCallback((id: string) => {
    dispatch({ type: "CLOSE_BUFFER", payload: { id } });
  }, []);

  const setActiveBuffer = useCallback((id: string) => {
    dispatch({ type: "SET_ACTIVE_BUFFER", payload: { id } });
  }, []);

  const updateBufferContent = useCallback(
    (id: string, content: string, markDirty: boolean = true) => {
      dispatch({ type: "UPDATE_BUFFER_CONTENT", payload: { id, content, markDirty } });
    },
    [],
  );

  const markBufferDirty = useCallback((id: string, isDirty: boolean) => {
    dispatch({ type: "MARK_BUFFER_DIRTY", payload: { id, isDirty } });
  }, []);

  const updateBufferVimState = useCallback(
    (id: string, vimMode: string, cursorPosition: number) => {
      dispatch({ type: "UPDATE_BUFFER_VIM_STATE", payload: { id, vimMode, cursorPosition } });
    },
    [],
  );

  const updateBuffer = useCallback((buffer: Buffer) => {
    dispatch({ type: "UPDATE_BUFFER", payload: { buffer } });
  }, []);

  const getActiveBuffer = useCallback((): Buffer | null => {
    return state.buffers.find(buffer => buffer.id === state.activeBufferId) || null;
  }, [state.buffers, state.activeBufferId]);

  const switchToNextBuffer = useCallback(() => {
    if (state.buffers.length <= 1) return;

    const currentIndex = state.buffers.findIndex(buffer => buffer.id === state.activeBufferId);
    const nextIndex = (currentIndex + 1) % state.buffers.length;
    const nextBuffer = state.buffers[nextIndex];

    if (nextBuffer) {
      setActiveBuffer(nextBuffer.id);
    }
  }, [state.buffers, state.activeBufferId, setActiveBuffer]);

  const switchToPreviousBuffer = useCallback(() => {
    if (state.buffers.length <= 1) return;

    const currentIndex = state.buffers.findIndex(buffer => buffer.id === state.activeBufferId);
    const prevIndex = currentIndex === 0 ? state.buffers.length - 1 : currentIndex - 1;
    const prevBuffer = state.buffers[prevIndex];

    if (prevBuffer) {
      setActiveBuffer(prevBuffer.id);
    }
  }, [state.buffers, state.activeBufferId, setActiveBuffer]);

  const reorderBuffers = useCallback((fromIndex: number, toIndex: number) => {
    dispatch({ type: "REORDER_BUFFERS", payload: { fromIndex, toIndex } });
  }, []);

  return {
    buffers: state.buffers,
    activeBufferId: state.activeBufferId,
    openBuffer,
    closeBuffer,
    setActiveBuffer,
    updateBufferContent,
    markBufferDirty,
    updateBufferVimState,
    updateBuffer,
    getActiveBuffer,
    switchToNextBuffer,
    switchToPreviousBuffer,
    reorderBuffers,
  };
};
