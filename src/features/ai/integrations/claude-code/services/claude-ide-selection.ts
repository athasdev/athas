import type { EditorSelection } from "@/bindings/commands";
import { readBufferText } from "@/features/editor/services/buffer-text";
import { useBufferStore } from "@/features/editor/stores/buffer.store";
import { useEditorStateStore } from "@/features/editor/stores/state.store";
import type { Position } from "@/features/editor/types/editor.types";
import { isEditorContent } from "@/features/panes/types/pane-content.types";

/** Whether Claude, running on this machine, can open the path: an absolute local file path. */
export function isLocalFilePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path);
}

function toSelectionPosition(position: Position) {
  return { line: position.line, character: position.column };
}

/** The active editor's selection (the cursor when nothing is selected), or null without one. */
export function readActiveEditorSelection(): EditorSelection | null {
  const buffer = useBufferStore.getState().actions.getActiveBuffer();
  if (!buffer || !isEditorContent(buffer) || buffer.isVirtual || !isLocalFilePath(buffer.path)) {
    return null;
  }
  const { cursorPosition, selection } = useEditorStateStore.getState();
  const range = selection ?? { start: cursorPosition, end: cursorPosition };
  const [start, end] =
    range.start.offset <= range.end.offset ? [range.start, range.end] : [range.end, range.start];
  const text =
    start.offset === end.offset ? "" : readBufferText(buffer).slice(start.offset, end.offset);

  return {
    filePath: buffer.path,
    text,
    start: toSelectionPosition(start),
    end: toSelectionPosition(end),
  };
}
