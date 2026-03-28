/**
 * Toggle case action (~)
 *
 * When called with a count (e.g. 3~), the command executor invokes this action
 * count times. Each invocation reads the fresh cursor position from the store
 * so that successive calls advance correctly.
 */

import { useEditorStateStore } from "@/features/editor/stores/state-store";
import { useEditorViewStore } from "@/features/editor/stores/view-store";
import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
import type { Action, EditorContext } from "../core/types";

export const toggleCaseAction: Action = {
  name: "toggleCase",
  repeatable: true,
  entersInsertMode: false,

  execute: (context: EditorContext): void => {
    const { updateContent, setCursorPosition } = context;

    // Read fresh cursor and lines so repeated invocations advance correctly
    const cursor = useEditorStateStore.getState().cursorPosition;
    const lines = [...useEditorViewStore.getState().lines];

    const currentLine = cursor.line;
    let currentColumn = cursor.column;

    if (currentLine >= lines.length) return;

    // If at end of line, nothing to toggle
    if (currentColumn >= lines[currentLine].length) return;

    const char = lines[currentLine][currentColumn];
    const toggledChar = char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase();

    lines[currentLine] =
      lines[currentLine].slice(0, currentColumn) +
      toggledChar +
      lines[currentLine].slice(currentColumn + 1);

    currentColumn++;

    const toggledContent = lines.join("\n");
    updateContent(toggledContent);

    const newOffset = calculateOffsetFromPosition(currentLine, currentColumn, lines);
    setCursorPosition({
      line: currentLine,
      column: currentColumn,
      offset: newOffset,
    });
  },
};
