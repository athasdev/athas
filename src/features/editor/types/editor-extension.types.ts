import type { Change, Decoration, Position, Range } from "../types/editor.types";

export interface EditorAPI {
  // Content operations
  getContent: () => string;
  setContent: (content: string) => void;
  insertText: (text: string, position?: Position) => void;
  deleteRange: (range: Range) => void;
  replaceRange: (range: Range, text: string) => void;

  // Selection operations
  getSelection: () => Range | null;
  setSelection: (range?: Range | null) => void;
  getCursorPosition: () => Position;
  setCursorPosition: (position: Position) => void;
  selectAll: () => void;
  openFind: (replace?: boolean) => boolean;
  addSelectionToNextFindMatch: () => boolean;
  addSelectionToPreviousFindMatch: () => boolean;
  selectAllFindMatches: () => boolean;

  // Decoration operations
  addDecoration: (decoration: Decoration) => string;
  removeDecoration: (id: string) => void;
  updateDecoration: (id: string, decoration: Partial<Decoration>) => void;
  clearDecorations: () => void;

  // Line operations
  getLines: () => string[];
  getLine: (lineNumber: number) => string | undefined;
  getLineCount: () => number;
  duplicateLine: () => void;
  deleteLine: () => void;
  toggleComment: () => void;
  goToMatchingBracket: () => void;
  selectToBracket: (selectBrackets?: boolean) => void;
  removeBrackets: () => void;
  expandSelection: () => void;
  shrinkSelection: () => void;
  insertCursorAbove: () => void;
  insertCursorBelow: () => void;
  insertCursorsAtLineEnds: () => void;
  removeSecondaryCursors: () => void;
  moveLineUp: () => void;
  moveLineDown: () => void;
  copyLineUp: () => void;
  copyLineDown: () => void;

  // History operations
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Settings
  getSettings: () => EditorSettings;
  updateSettings: (settings: Partial<EditorSettings>) => void;

  // Events - Type-safe event subscription
  on: <E extends EditorEvent>(event: E, handler: EventHandler<E>) => () => void;
  off: <E extends EditorEvent>(event: E, handler: EventHandler<E>) => void;
  emitEvent: <E extends EditorEvent>(event: E, data: EditorEventPayload[E]) => void;

  // Internal - set textarea ref for cursor sync
  setTextareaRef?: (ref: HTMLTextAreaElement | null) => void;
}

export interface EditorSettings {
  fontSize: number;
  lineHeight: number;
  tabSize: number;
  lineNumbers: boolean;
  wordWrap: boolean;
  renderWhitespace: "none" | "boundary" | "trailing" | "all";
  renderIndentGuides: boolean;
  theme: string;
}

// Event payload types for type-safe event handling
export type EditorEventPayload = {
  contentChange: { content: string; changes: Change[] };
  selectionChange: Range | null;
  cursorChange: Position;
  settingsChange: Partial<EditorSettings>;
  decorationChange:
    | { type: "add"; decoration: Decoration; id: string }
    | { type: "remove"; id: string }
    | { type: "update"; id: string; decoration: Partial<Decoration> }
    | { type: "clear" };
  keydown: { event: KeyboardEvent; content: string; position: Position };
};

export type EditorEvent = keyof EditorEventPayload;

export type EventHandler<E extends EditorEvent = EditorEvent> = (
  data: EditorEventPayload[E],
) => void;
