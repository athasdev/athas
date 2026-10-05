import type { MouseEventHandler, ReactNode } from "react";
import type {
  EditorContentChangeOptions,
  EditorDocumentChangeBatch,
  EditorDocumentChangeResult,
  Position,
  Range,
} from "./editor.types";
import type { EditorModelPositionResolver } from "../view-model/view-layout";

/** What the workbench passes to the text editor, whichever engine draws it. */
export interface CodeEditorViewProps {
  bufferId?: string;
  viewStateKey?: string;
  isActiveSurface?: boolean;
  isPreviewMode?: boolean;
  readOnly?: boolean;
  scrollable?: boolean;
  backgroundLayer?: ReactNode;
  onReadonlySurfaceClick?: (position: { line: number; column: number }) => void;
  highlightMatches?: Array<{ start: number; end: number }>;
  currentHighlightIndex?: number;
  lineNumberStart?: number;
  lineNumberMap?: Array<number | null>;
  onContentChange?: (
    content: string,
    previousContent?: string,
    previousCursorPosition?: Position,
    previousSelection?: Range,
    options?: EditorContentChangeOptions,
  ) => void;
  onDocumentChange?: (
    batch: EditorDocumentChangeBatch,
    previousCursorPosition?: Position,
    previousSelection?: Range,
  ) => EditorDocumentChangeResult;
  onScrollOffsetChange?: (scrollTop: number, scrollLeft: number) => void;
  onModelPositionResolverChange?: (resolver: EditorModelPositionResolver | null) => void;
  onMouseMove?: MouseEventHandler<HTMLDivElement>;
  onMouseLeave?: () => void;
  onMouseEnter?: () => void;
  onClick?: MouseEventHandler<HTMLDivElement>;
  className?: string;
}
