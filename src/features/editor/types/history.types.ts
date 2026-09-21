import type { Position, Range } from "@/features/editor/types/editor.types";

export interface HistoryEntry {
  content: string;
  cursorPosition?: Position;
  selection?: Range;
  timestamp: number;
}

export interface HistoryPatchChange {
  rangeOffset: number;
  beforeText: string;
  afterText: string;
}

export interface HistoryPatchBatch {
  beforeLength: number;
  afterLength: number;
  changes: HistoryPatchChange[];
}

export interface PatchHistoryEntry {
  kind: "patch";
  patches: HistoryPatchBatch[];
  beforeLength: number;
  afterLength: number;
  cursorPosition?: Position;
  selection?: Range;
  timestamp: number;
}

export type StoredHistoryEntry = HistoryEntry | PatchHistoryEntry;

export interface HistoryState {
  past: StoredHistoryEntry[];
  future: StoredHistoryEntry[];
  maxHistorySize: number;
}

export interface BufferHistory {
  [bufferId: string]: HistoryState;
}
