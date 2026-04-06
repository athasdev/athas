/**
 * Join lines without space action (gJ)
 *
 * Joins the current line with the next line without inserting a space,
 * and without removing leading whitespace from the next line.
 */

import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
import type { Action, EditorContext } from "../core/types";

export const joinLinesNoSpaceAction: Action = {
  name: "joinLinesNoSpace",
  repeatable: true,
  entersInsertMode: false,

  execute: (context: EditorContext): void => {
    const { lines, cursor, updateContent, setCursorPosition } = context;

    if (cursor.line >= lines.length - 1) {
      return;
    }

    const currentLine = lines[cursor.line];
    const nextLine = lines[cursor.line + 1];
    const joinColumn = currentLine.length;

    const joined = currentLine + nextLine;
    const newLines = [...lines];
    newLines[cursor.line] = joined;
    newLines.splice(cursor.line + 1, 1);

    updateContent(newLines.join("\n"));
    setCursorPosition({
      line: cursor.line,
      column: joinColumn,
      offset: calculateOffsetFromPosition(cursor.line, joinColumn, newLines),
    });
  },
};
