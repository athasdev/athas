/**
 * Editor facade interface for vim mode
 *
 * Abstracts all editor surface interactions so vim core logic never
 * touches DOM class names directly. The only DOM-coupled code lives
 * in the DOM implementation of this facade.
 */

import type { Position } from "@/features/editor/types/editor";

export interface ViewportMetrics {
  topLine: number;
  bottomLine: number;
  visibleLines: number;
}

export interface VimEditorFacade {
  /** Current editor content as a single string */
  getContent(): string;

  /** Replace the entire editor content. Pass markDirty=false to suppress the dirty flag. */
  setContent(value: string, markDirty?: boolean): void;

  /** Current content split into lines */
  getLines(): string[];

  /** Current cursor position */
  getCursorPosition(): Position;

  /** Move the cursor */
  setCursorPosition(position: Position): void;

  /** Set the native selection range (start..end) */
  setSelection(start: number, end: number): void;

  /** Collapse selection to a single offset */
  collapseSelection(offset: number): void;

  /** Focus the editor input surface */
  focus(): void;

  /** Blur the editor input surface */
  blur(): void;

  /** Return viewport metrics needed for H/M/L motions */
  getViewportMetrics(): ViewportMetrics;

  /** Push current state to the undo stack */
  saveUndoState(): void;

  /** Set the read-only attribute on the editor surface */
  setReadOnly(readonly: boolean): void;

  /** Set or remove the data-vim-mode attribute */
  setDataVimMode(mode: string | null): void;

  /** Set the CSS caret-color */
  setCaretColor(color: string): void;

  /** Return the currently focused element */
  getActiveElement(): Element | null;

  /** Whether the editor surface currently has focus */
  isFocused(): boolean;
}
