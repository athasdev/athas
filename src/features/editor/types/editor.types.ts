export interface Position {
  line: number;
  column: number;
  offset: number;
}

// https://docs.rs/lsp-positions/latest/lsp_positions/struct.Position.html
export interface LSPPosition {
  line: number;
  character: number;
  offset: number;
}

export interface Range {
  start: Position;
  end: Position;
}

export interface EditorTextChange {
  rangeOffset: number;
  rangeLength: number;
  text: string;
  startLine?: number;
  startColumn?: number;
  endLine?: number;
  endColumn?: number;
}

export interface EditorModelTextChange extends EditorTextChange {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export interface EditorDocumentChangeBatch {
  sourceId: string;
  modelSessionId: string;
  modelVersionId: number;
  changes: readonly EditorModelTextChange[];
  eol: "\n" | "\r\n";
  isEolChange: boolean;
  isFlush: boolean;
  isUndoing: boolean;
  isRedoing: boolean;
  fullContent?: string;
}

export interface EditorDocumentChangeEvent extends EditorDocumentChangeBatch {
  bufferId: string;
  filePath: string;
}

export interface EditorDocumentChangeResult {
  accepted: boolean;
  synchronized: boolean;
  contentRevision: number;
}

export interface EditorContentChangeOptions {
  contentAlreadyApplied?: boolean;
  skipUndoGrouping?: boolean;
  contentChange?: EditorTextChange;
}

export interface Cursor {
  position: Position;
  selection?: Range;
  id: string; // Unique identifier for each cursor
}

export interface MultiCursorState {
  cursors: Cursor[];
  primaryCursorId: string; // ID of the primary cursor (synced with textarea)
}

export interface Decoration {
  range: Range;
  className?: string;
  type: "inline" | "overlay" | "gutter" | "line";
  content?: React.ReactNode;
}

export interface Change {
  range: Range;
  text: string;
  origin: string; // "user" | "paste" | "undo" | "redo" | extension name
}
