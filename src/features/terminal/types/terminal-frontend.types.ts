import type { ISearchOptions } from "@xterm/addon-search";

export type TerminalEngine = "xterm" | "ghostty";

export interface TerminalDisposable {
  dispose(): void;
}

export interface TerminalBufferLine {
  translateToString(trimRight?: boolean, startColumn?: number, endColumn?: number): string;
}

export interface TerminalBuffer {
  readonly length: number;
  getLine(index: number): TerminalBufferLine | undefined;
}

export interface TerminalFrontend {
  readonly buffer: {
    readonly active: TerminalBuffer;
  };
  cols: number;
  rows: number;
  element?: HTMLElement;
  textarea?: HTMLTextAreaElement;
  onData(listener: (data: string) => void): TerminalDisposable;
  onBinary?(listener: (data: string) => void): TerminalDisposable;
  onResize(listener: (size: { cols: number; rows: number }) => void): TerminalDisposable;
  onSelectionChange(listener: () => void): TerminalDisposable;
  open(parent: HTMLElement): void;
  write(data: string | Uint8Array, callback?: () => void): void;
  writeln(data: string | Uint8Array, callback?: () => void): void;
  paste(data: string): void;
  focus(): void;
  blur(): void;
  clear(): void;
  selectAll(): void;
  select(column: number, row: number, length: number): void;
  clearSelection(): void;
  getSelection(): string;
  scrollToTop(): void;
  scrollToBottom(): void;
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
  refresh?(start: number, end: number): void;
  dispose(): void;
}

export interface TerminalFitAddon {
  fit(): void;
}

export interface TerminalSearchAddon {
  onDidChangeResults(
    listener: (results: { resultIndex: number; resultCount: number }) => void,
  ): TerminalDisposable;
  findNext(term: string, options?: ISearchOptions): boolean;
  findPrevious(term: string, options?: ISearchOptions): boolean;
  clearDecorations(): void;
}

export interface TerminalSerializeAddon {
  serialize(): string;
}

export interface TerminalRuntimeAddons {
  fitAddon: TerminalFitAddon;
  searchAddon: TerminalSearchAddon;
  serializeAddon: TerminalSerializeAddon;
}
