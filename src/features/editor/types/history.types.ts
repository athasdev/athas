import type { Position, Range } from "@/features/editor/types/editor.types";

export interface HistoryEntry {
  content: string;
  cursorPosition?: Position;
  selection?: Range;
  timestamp: number;
}

export interface HistoryState {
  past: HistoryEntry[];
  future: HistoryEntry[];
  maxHistorySize: number;
}

export interface BufferHistory {
  [bufferId: string]: HistoryState;
}
