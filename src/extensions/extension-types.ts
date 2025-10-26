import type { Change, Decoration, LSPPosition, Position, Range } from "../types/editor-types";

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
  | "decorationChange"
  | "keydown";

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
  onKeyDown?: (data: { event: KeyboardEvent; content: string; position: LSPPosition }) => void;
}

export interface Extension {
  readonly id: string;
  readonly displayName: string;
  readonly description?: string;
  readonly version: string;
  readonly category?: string;

  contributes?: {
    languages?: LanguageContribution[];
    commands?: CommandContribution[];
    keybindings?: KeybindingContribution[];
    settings?: SettingContribution[];
    themes?: ThemeContribution[];
  };

  activate(context: ExtensionContext): Promise<void> | void;
  deactivate(): Promise<void> | void;

  getSettings?(): Record<string, any>;
  updateSettings?(settings: Record<string, any>): void;
}

export interface LanguageContribution {
  id: string;
  extensions: string[];
  aliases?: string[];
  configuration?: string;
}

export interface CommandContribution {
  id: string;
  title: string;
  category?: string;
  when?: string;
}

export interface KeybindingContribution {
  command: string;
  key: string;
  when?: string;
}

export interface SettingContribution {
  id: string;
  title: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  default: any;
  description?: string;
  enum?: any[];
}

export interface ThemeContribution {
  id: string;
  label: string;
  path: string;
}

export interface ExtensionContext {
  editor: EditorAPI;
  extensionId: string;
  storage: ExtensionStorage;
  registerCommand: (id: string, handler: (...args: any[]) => any) => void;
  registerLanguage: (language: LanguageContribution) => void;
}

interface ExtensionStorage {
  get: <T>(key: string) => T | undefined;
  set: <T>(key: string, value: T) => void;
  delete: (key: string) => void;
  clear: () => void;
}

export interface LanguageExtension extends Extension {
  readonly languageId: string;
  readonly extensions: string[];
  readonly aliases?: string[];
  readonly filenames?: string[];

  getTokens(content: string): Promise<Token[]>;
}

export interface Token {
  start: number;
  end: number;
  token_type: string;
  class_name: string;
}

export interface LanguageProvider {
  id: string;
  extensions: string[];
  aliases?: string[];
  filenames?: string[];
  getTokens(content: string): Promise<Token[]>;
}
