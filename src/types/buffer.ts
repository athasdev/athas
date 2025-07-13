export interface Buffer {
  id: string;
  path: string;
  name: string;
  content: string;
  isDirty: boolean; // Has unsaved changes
  isSQLite: boolean;
  isImage: boolean;
  isDiff: boolean; // Diff view files
  isVirtual: boolean; // Virtual files aren't saved to disk
  isActive: boolean;
  isPinned?: boolean; // Whether the tab is pinned
  vimMode?: "normal" | "insert" | "visual";
  cursorPosition?: number;
}

export interface BufferState {
  buffers: Buffer[];
  activeBufferId: string | null;
}

export type BufferAction =
  | {
      type: "OPEN_BUFFER";
      payload: {
        path: string;
        name: string;
        content: string;
        isSQLite: boolean;
        isImage: boolean;
        isDiff: boolean;
        isVirtual: boolean;
      };
    }
  | { type: "CLOSE_BUFFER"; payload: { id: string } }
  | { type: "SET_ACTIVE_BUFFER"; payload: { id: string } }
  | { type: "UPDATE_BUFFER_CONTENT"; payload: { id: string; content: string; markDirty?: boolean } }
  | { type: "MARK_BUFFER_DIRTY"; payload: { id: string; isDirty: boolean } }
  | {
      type: "UPDATE_BUFFER_VIM_STATE";
      payload: { id: string; vimMode: string; cursorPosition: number };
    }
  | { type: "UPDATE_BUFFER"; payload: { buffer: Buffer } }
  | { type: "REORDER_BUFFERS"; payload: { fromIndex: number; toIndex: number } };
