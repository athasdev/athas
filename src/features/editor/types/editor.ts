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

export interface LineToken {
  startColumn: number;
  endColumn: number;
  className: string;
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
