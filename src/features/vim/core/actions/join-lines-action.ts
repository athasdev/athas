/**
 * Join lines action (J)
 *
 * Joins the current line with the next line, replacing the line break
 * with a single space. Leading whitespace on the next line is removed.
 */

import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
import type { Action, EditorContext } from "../core/types";

export const joinLinesAction: Action = {
  name: "joinLines",
  repeatable: true,
  entersInsertMode: false,

  execute: (context: EditorContext): void => {
    const { lines, cursor, updateContent, setCursorPosition } = context;

    if (cursor.line >= lines.length - 1) {
      return;
    }

    const currentLine = lines[cursor.line];
    const nextLine = lines[cursor.line + 1].trimStart();
    const joinColumn = currentLine.length;

    const joined = currentLine + (nextLine ? " " + nextLine : "");
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
