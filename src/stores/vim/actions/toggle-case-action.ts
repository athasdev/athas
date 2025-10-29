/**
 * Toggle case action (~)
 */

import type { Action, EditorContext } from "../core/types";

/**
 * Toggle case action - toggles the case of the character under the cursor and moves to the next character
 */
export const toggleCaseAction: Action = {
  name: "toggleCase",
  repeatable: true,
  entersInsertMode: false,

  execute: (context: EditorContext): void => {
    const { lines, updateContent, setCursorPosition, cursor } = context;

    const repeatCount = 1;

    let currentLine = cursor.line;
    let currentColumn = cursor.column;
    const updatedLines = [...lines];

    // Toggle case for the specified number of characters
    for (let i = 0; i < repeatCount; i++) {
      // Check if we're at the end of the current line
      if (currentColumn >= updatedLines[currentLine]?.length || 0) {
        // Move to the next line if there is one
        if (currentLine < updatedLines.length - 1) {
          currentLine++;
          currentColumn = 0;
        } else {
          // We're at the end of the file, stop
          break;
        }
      }

      // Check if we have a valid position
      if (currentLine < updatedLines.length && currentColumn < updatedLines[currentLine].length) {
        const char = updatedLines[currentLine][currentColumn];
        const toggledChar = char === char.toUpperCase() ? char.toLowerCase() : char.toUpperCase();

        updatedLines[currentLine] =
          updatedLines[currentLine].slice(0, currentColumn) +
          toggledChar +
          updatedLines[currentLine].slice(currentColumn + 1);

        // Move to the next character
        currentColumn++;
      }
    }

    const toggledContent = updatedLines.join("\n");
    updateContent(toggledContent);

    // Position cursor after the last toggled character
    setCursorPosition({
      line: currentLine,
      column: currentColumn,
      offset: cursor.offset + repeatCount, // Approximate offset
    });
  },
};
