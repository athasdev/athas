export interface InlineAutocompleteCompletion {
  text: string;
  cursorOffset: number;
}

export interface InlineAutocompletePreviewLine {
  text: string;
  index: number;
}

export interface InlineAutocompletePreviewModel {
  lines: InlineAutocompletePreviewLine[];
  top: number;
  firstLineLeft: number;
  continuationLeft: number;
}

interface ResolveInlineAutocompletePreviewParams {
  completion: InlineAutocompleteCompletion | null;
  isLspCompletionVisible: boolean;
  cursorOffset: number;
  cursorColumn: number;
  visualCursorLine: number;
  lines: readonly string[];
  cursorTop?: number;
  cursorLeft?: number;
  lineHeight: number;
  editorPaddingTop: number;
  editorPaddingLeft: number;
  measureText: (text: string) => number;
}

export function resolveInlineAutocompletePreview({
  completion,
  isLspCompletionVisible,
  cursorOffset,
  cursorColumn,
  visualCursorLine,
  lines,
  cursorTop,
  cursorLeft,
  lineHeight,
  editorPaddingTop,
  editorPaddingLeft,
  measureText,
}: ResolveInlineAutocompletePreviewParams): InlineAutocompletePreviewModel | null {
  if (!completion || isLspCompletionVisible) return null;
  if (completion.cursorOffset !== cursorOffset) return null;
  if (visualCursorLine < 0 || visualCursorLine >= lines.length) return null;

  const normalized = completion.text.replace(/\r\n/g, "\n");
  if (!normalized) return null;

  const lineText = lines[visualCursorLine] || "";
  const clampedCursorColumn = Math.min(cursorColumn, lineText.length);
  const textAfterCursorOnLine = lineText.slice(clampedCursorColumn);
  if (textAfterCursorOnLine.trim().length > 0) return null;

  const previewLines: InlineAutocompletePreviewLine[] = [];

  for (const [index, text] of normalized.split("\n").entries()) {
    if (index > 0 && lines[visualCursorLine + index]?.trim()) {
      break;
    }
    previewLines.push({ text, index });
  }

  if (previewLines.every((line) => line.text.length === 0)) return null;

  return {
    lines: previewLines,
    top: cursorTop ?? visualCursorLine * lineHeight + editorPaddingTop,
    firstLineLeft:
      cursorLeft ?? measureText(lineText.slice(0, clampedCursorColumn)) + editorPaddingLeft,
    continuationLeft: editorPaddingLeft,
  };
}
