import type { EditorSelectionContext } from "@/features/ai/types/ai-context.types";
import type { EditorContent } from "@/features/panes/types/pane-content.types";
import type { Range } from "@/features/editor/types/editor.types";

export function createEditorSelectionContext(
  buffer: EditorContent,
  selection: Range,
  languageId: string,
): EditorSelectionContext | null {
  const start = selection.start.offset <= selection.end.offset ? selection.start : selection.end;
  const end = selection.start.offset <= selection.end.offset ? selection.end : selection.start;
  if (start.offset === end.offset) return null;

  return createEditorSelectionContextFromText(
    buffer,
    { start, end },
    buffer.content.slice(start.offset, end.offset),
    languageId,
  );
}

/**
 * The same context from text already read out of the editor, so a caller holding a text model
 * can pass just the selected range instead of materializing the whole document.
 */
export function createEditorSelectionContextFromText(
  buffer: Pick<EditorContent, "id" | "path" | "name">,
  selection: Range,
  selectedText: string,
  languageId: string,
): EditorSelectionContext | null {
  const start = selection.start.offset <= selection.end.offset ? selection.start : selection.end;
  const end = selection.start.offset <= selection.end.offset ? selection.end : selection.start;
  if (start.offset === end.offset || !selectedText) return null;

  return {
    id: `editor-selection:${buffer.id}:${start.offset}:${end.offset}`,
    bufferId: buffer.id,
    filePath: buffer.path,
    fileName: buffer.name,
    languageId,
    selectedText,
    startLine: start.line + 1,
    startColumn: start.column + 1,
    endLine: end.line + 1,
    endColumn: end.column + 1,
  };
}
