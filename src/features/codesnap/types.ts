export type SourceSnapshot = {
  /** Exact text being rendered (selected substring or full buffer). */
  text: string;
  /** 1-based line number of the first line. Used by realLineNumbers. */
  startLine: number;
  /** 1-based line number of the last line. Used for default filenames. */
  endLine: number;
  /** Tree-sitter parser id (e.g. "rust", "typescript", "markdown"). */
  language: string;
  /** Source buffer path, or null for untitled buffers. */
  bufferPath: string | null;
};

export type CodesnapShutterAction = "copy" | "save";
export type CodesnapTarget = "container" | "window";

export type CodesnapSettings = {
  backgroundColor: string;
  containerPadding: string;
  boxShadow: string;
  roundedCorners: boolean;
  showWindowControls: boolean;
  showWindowTitle: boolean;
  showLineNumbers: boolean;
  realLineNumbers: boolean;
  transparentBackground: boolean;
  target: CodesnapTarget;
  shutterAction: CodesnapShutterAction;
  defaultWidth: number;
  pixelRatio: number;
  fontFamily: string;
  useEditorTheme: boolean;
};
