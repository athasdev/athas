import type { RefObject } from "react";
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import { EDITOR_CONSTANTS } from "@/features/editor/config/constants";
import type { Cursor, MultiCursorState, Position, Range } from "@/features/editor/types/editor";
import { getLineHeight } from "@/features/editor/utils/position";
import { createSelectors } from "@/utils/zustand-selectors";
import { useBufferStore } from "./buffer-store";
import { useEditorSettingsStore } from "./settings-store";

// Position Cache Manager
class PositionCacheManager {
  private cache = new Map<string, Position>();
  private readonly MAX_CACHE_SIZE = EDITOR_CONSTANTS.MAX_POSITION_CACHE_SIZE;

  set(bufferId: string, position: Position): void {
    const cachedPosition = this.cache.get(bufferId);
    if (cachedPosition && this.positionsEqual(cachedPosition, position)) {
      return;
    }

    if (this.cache.size >= this.MAX_CACHE_SIZE && !this.cache.has(bufferId)) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) {
        this.cache.delete(firstKey);
      }
    }

    this.cache.set(bufferId, { ...position });
  }

  get(bufferId: string): Position | null {
    const cachedPosition = this.cache.get(bufferId);
    if (!cachedPosition) return null;
    return { ...cachedPosition };
  }

  clear(bufferId?: string): void {
    if (bufferId) {
      this.cache.delete(bufferId);
    } else {
      this.cache.clear();
    }
  }

  private positionsEqual(pos1: Position, pos2: Position): boolean {
    return pos1.line === pos2.line && pos1.column === pos2.column && pos1.offset === pos2.offset;
  }
}

const positionCache = new PositionCacheManager();

const ensureCursorVisible = (position: Position) => {
  if (typeof window === "undefined") return;

  const viewport = document.querySelector(".editor-viewport") as HTMLDivElement | null;
  if (!viewport) return;

  const fontSize = useEditorSettingsStore.getState().fontSize;
  const lineHeight = getLineHeight(fontSize);
  const targetTop = position.line * lineHeight;
  const targetBottom = targetTop + lineHeight;
  const currentScrollTop = viewport.scrollTop;
  const viewportHeight = viewport.clientHeight || 0;

  if (targetTop < currentScrollTop) {
    viewport.scrollTop = targetTop;
  } else if (targetBottom > currentScrollTop + viewportHeight) {
    viewport.scrollTop = Math.max(0, targetBottom - viewportHeight);
  }

  const textarea = document.querySelector(".editor-textarea") as HTMLTextAreaElement | null;
  if (textarea && textarea.scrollTop !== viewport.scrollTop) {
    textarea.scrollTop = viewport.scrollTop;
  }
};

// State Interface
interface EditorState {
  // Cursor state
  cursorPosition: Position;
  selection?: Range;
  desiredColumn?: number;
  cursorVisible: boolean;

  // Multi-cursor state
  multiCursorState: MultiCursorState | null;

  // Layout state
  scrollTop: number;
  scrollLeft: number;
  viewportHeight: number;

  // Instance state
  value: string;
  onChange: (value: string) => void;
  filePath: string;
  editorRef: RefObject<HTMLDivElement | null> | null;
  placeholder?: string;
  disabled: boolean;

  // Actions
  actions: EditorStateActions;
}

interface EditorStateActions {
  // Cursor actions
  setCursorPosition: (position: Position) => void;
  setSelection: (selection?: Range) => void;
  setDesiredColumn: (column?: number) => void;
  setCursorVisibility: (visible: boolean) => void;
  getCachedPosition: (bufferId: string) => Position | null;
  clearPositionCache: (bufferId?: string) => void;
  restorePositionForFile: (bufferId: string) => boolean;

  // Multi-cursor actions
  enableMultiCursor: () => void;
  disableMultiCursor: () => void;
  addCursor: (position: Position, selection?: Range) => void;
  removeCursor: (cursorId: string) => void;
  updateCursor: (cursorId: string, position: Position, selection?: Range) => void;
  clearSecondaryCursors: () => void;

  // Layout actions
  setScroll: (scrollTop: number, scrollLeft: number) => void;
  setViewportHeight: (height: number) => void;

  // Instance actions
  setRefs: (refs: { editorRef: RefObject<HTMLDivElement | null> }) => void;
  setContent: (value: string, onChange: (value: string) => void) => void;
  setFileInfo: (filePath: string) => void;
  setPlaceholder: (placeholder?: string) => void;
  setDisabled: (disabled: boolean) => void;
}

export const useEditorStateStore = createSelectors(
  create<EditorState>()(
    subscribeWithSelector((set) => ({
      // Cursor state
      cursorPosition: { line: 0, column: 0, offset: 0 },
      cursorVisible: false,
      selection: undefined,
      desiredColumn: undefined,

      // Multi-cursor state
      multiCursorState: null,

      // Layout state
      scrollTop: 0,
      scrollLeft: 0,
      viewportHeight: EDITOR_CONSTANTS.DEFAULT_VIEWPORT_HEIGHT,

      // Instance state
      value: "",
      onChange: () => {},
      filePath: "",
      editorRef: null,
      placeholder: undefined,
      disabled: false,

      // Actions
      actions: {
        // Cursor actions
        setCursorPosition: (position) => {
          const activeBufferId = useBufferStore.getState().activeBufferId;
          if (activeBufferId) {
            positionCache.set(activeBufferId, position);
          }
          set({ cursorPosition: position });
          ensureCursorVisible(position);
        },
        setSelection: (selection) => set({ selection }),
        setDesiredColumn: (column) => set({ desiredColumn: column }),
        setCursorVisibility: (visible) => set({ cursorVisible: visible }),
        getCachedPosition: (bufferId) => positionCache.get(bufferId),
        clearPositionCache: (bufferId) => positionCache.clear(bufferId),
        restorePositionForFile: (bufferId) => {
          const cachedPosition = positionCache.get(bufferId);
          if (cachedPosition) {
            set({ cursorPosition: cachedPosition });
            return true;
          }
          // Reset to beginning for files with no cached position
          set({ cursorPosition: { line: 0, column: 0, offset: 0 } });
          return false;
        },

        // Multi-cursor actions
        enableMultiCursor: () =>
          set((state) => {
            if (state.multiCursorState) return state;

            const primaryCursorId = `cursor-${Date.now()}-0`;
            return {
              multiCursorState: {
                cursors: [
                  {
                    id: primaryCursorId,
                    position: state.cursorPosition,
                    selection: state.selection,
                  },
                ],
                primaryCursorId,
              },
            };
          }),

        disableMultiCursor: () => set({ multiCursorState: null }),

        addCursor: (position, selection) =>
          set((state) => {
            if (!state.multiCursorState) return state;

            // Check for duplicate cursor at the same position
            const isDuplicate = state.multiCursorState.cursors.some(
              (cursor) =>
                cursor.position.line === position.line &&
                cursor.position.column === position.column,
            );
            if (isDuplicate) return state;

            const newCursorId = `cursor-${Date.now()}-${state.multiCursorState.cursors.length}`;
            const newCursor: Cursor = {
              id: newCursorId,
              position,
              selection,
            };

            return {
              multiCursorState: {
                ...state.multiCursorState,
                cursors: [...state.multiCursorState.cursors, newCursor],
              },
            };
          }),

        removeCursor: (cursorId) =>
          set((state) => {
            if (!state.multiCursorState) return state;

            const cursors = state.multiCursorState.cursors.filter((c) => c.id !== cursorId);

            if (cursors.length === 0) {
              return { multiCursorState: null };
            }

            let primaryCursorId = state.multiCursorState.primaryCursorId;
            if (cursorId === primaryCursorId && cursors.length > 0) {
              primaryCursorId = cursors[0].id;
            }

            return {
              multiCursorState: {
                cursors,
                primaryCursorId,
              },
            };
          }),

        updateCursor: (cursorId, position, selection) =>
          set((state) => {
            if (!state.multiCursorState) return state;

            const cursors = state.multiCursorState.cursors.map((cursor) =>
              cursor.id === cursorId
                ? { ...cursor, position, selection: selection ?? cursor.selection }
                : cursor,
            );

            return {
              multiCursorState: {
                ...state.multiCursorState,
                cursors,
              },
            };
          }),

        clearSecondaryCursors: () =>
          set((state) => {
            if (!state.multiCursorState) return state;

            const primaryCursor = state.multiCursorState.cursors.find(
              (c) => c.id === state.multiCursorState!.primaryCursorId,
            );

            if (!primaryCursor) {
              return { multiCursorState: null };
            }

            return {
              multiCursorState: {
                cursors: [primaryCursor],
                primaryCursorId: primaryCursor.id,
              },
              cursorPosition: primaryCursor.position,
              selection: primaryCursor.selection,
            };
          }),

        // Layout actions
        setScroll: (scrollTop, scrollLeft) => set({ scrollTop, scrollLeft }),
        setViewportHeight: (height) => set({ viewportHeight: height }),

        // Instance actions
        setRefs: (refs) => set(refs),
        setContent: (value, onChange) => set({ value, onChange }),
        setFileInfo: (filePath) => set({ filePath }),
        setPlaceholder: (placeholder) => set({ placeholder }),
        setDisabled: (disabled) => set({ disabled }),
      },
    })),
  ),
);
