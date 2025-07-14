export type VimMode = "normal" | "insert" | "visual" | "visual-line" | "visual-block" | "command";

export interface VimState {
  mode: VimMode;
  cursorPosition: number;
  register: string;
  lastFindChar: string;
  lastFindDirection: "forward" | "backward";
  pendingOperator: string | null;
  pendingCount: number;
  visualStart?: number;
  commandBuffer: string;
}

export interface VimContext {
  textarea: HTMLTextAreaElement | HTMLDivElement;
  content: string;
  cursorPosition: number;
  updateContent: (content: string) => void;
  setCursorPosition: (pos: number) => void;
  state: VimState;
  setState: (state: Partial<VimState>) => void;
  showCommandLine?: (initialCommand?: string) => void;
}

export interface VimCommand {
  key: string;
  mode: VimMode | VimMode[];
  execute: (context: VimContext) => void;
  description?: string;
}

export interface VimMotion {
  key: string;
  execute: (context: VimContext) => number;
  description?: string;
}

export interface VimOperator {
  key: string;
  execute: (context: VimContext, start: number, end: number) => void;
  description?: string;
}
