/**
 * Core types for the keymaps system
 */

export interface Keybinding {
  key: string;
  command: string;
  when?: string;
  args?: unknown;
  source: "user" | "extension" | "default";
  enabled?: boolean;
}

export interface Command {
  id: string;
  title: string;
  category?: string;
  keybinding?: string;
  execute: (args?: unknown) => void | Promise<void>;
}

export interface KeymapContext {
  editorFocus: boolean;
  vimMode: boolean;
  vimNormalMode: boolean;
  vimInsertMode: boolean;
  vimVisualMode: boolean;
  terminalFocus: boolean;
  sidebarFocus: boolean;
  findWidgetVisible: boolean;
  hasSelection: boolean;
  [key: string]: boolean;
}

export interface KeymapStore {
  keybindings: Keybinding[];
  contexts: Partial<KeymapContext>;
}
