import type { Change, Decoration, Position, Range } from "../types/editor-types";

export interface Command {
  id: string;
  name: string;
  execute: (args?: any) => void | Promise<void>;
  when?: () => boolean;
}

export interface EditorAPI {
  // Content operations
  getContent: () => string;
  setContent: (content: string) => void;
  insertText: (text: string, position?: Position) => void;
  deleteRange: (range: Range) => void;
  replaceRange: (range: Range, text: string) => void;

  // Selection operations
  getSelection: () => Range | null;
  setSelection: (range: Range) => void;
  getCursorPosition: () => Position;
  setCursorPosition: (position: Position) => void;

  // Decoration operations
  addDecoration: (decoration: Decoration) => string;
  removeDecoration: (id: string) => void;
  updateDecoration: (id: string, decoration: Partial<Decoration>) => void;
  clearDecorations: () => void;

  // Line operations
  getLines: () => string[];
  getLine: (lineNumber: number) => string | undefined;
  getLineCount: () => number;

  // History operations
  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;

  // Settings
  getSettings: () => EditorSettings;
  updateSettings: (settings: Partial<EditorSettings>) => void;

  // Events
  on: (event: EditorEvent, handler: EventHandler) => () => void;
  off: (event: EditorEvent, handler: EventHandler) => void;
  emitEvent: (event: EditorEvent, data?: any) => void;

  // Internal - set textarea ref for cursor sync
  setTextareaRef?: (ref: HTMLTextAreaElement | null) => void;
}

export interface EditorSettings {
  fontSize: number;
  tabSize: number;
  lineNumbers: boolean;
  wordWrap: boolean;
  theme: string;
}

export type EditorEvent =
  | "contentChange"
  | "selectionChange"
  | "cursorChange"
  | "settingsChange"
  | "decorationChange";

export type EventHandler = (data?: any) => void;

export interface EditorExtension {
  name: string;
  version?: string;
  description?: string;

  // Lifecycle
  initialize?: (editor: EditorAPI) => void | Promise<void>;
  dispose?: () => void;

  // Features
  commands?: Command[];
  keybindings?: Record<string, string>; // key combo -> commandId
  decorations?: () => Decoration[];

  // Event handlers
  onContentChange?: (content: string, changes: Change[], affectedLines?: Set<number>) => void;
  onSelectionChange?: (selection: Range | null) => void;
  onCursorChange?: (position: Position) => void;
  onSettingsChange?: (settings: Partial<EditorSettings>) => void;
}

export interface ExtensionContext {
  editor: EditorAPI;
  extensionId: string;
  storage: ExtensionStorage;
}

interface ExtensionStorage {
  get: <T>(key: string) => T | undefined;
  set: <T>(key: string, value: T) => void;
  delete: (key: string) => void;
  clear: () => void;
}
