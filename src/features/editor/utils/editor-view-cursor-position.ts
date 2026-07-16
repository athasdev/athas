import type { Position } from "@/features/editor/types/editor.types";

const INITIAL_CURSOR_POSITION: Position = { line: 0, column: 0, offset: 0 };

export function resolveEditorViewCursorPosition(
  editorViewKey: string | null | undefined,
  activeEditorViewKey: string | null,
  cursorPosition: Position,
  cachedPosition?: Position | null,
): Position {
  if (!editorViewKey || activeEditorViewKey === editorViewKey) {
    return cursorPosition;
  }

  return cachedPosition ?? INITIAL_CURSOR_POSITION;
}
