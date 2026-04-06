/**
 * Outdent operator (d)
 */

import type { EditorContext, Operator, VimRange } from "../core/types";

/**
 * Outdent operator - outdents text in the given range
 */
export const outdentOperator: Operator = {
  name: "outdent",
  repeatable: true,
  entersInsertMode: false,

  execute: (range: VimRange, context: EditorContext): void => {
    const { lines, updateContent, setCursorPosition, cursor, tabSize } = context;

    const startLine = Math.min(range.start.line, range.end.line);
    const endLine = Math.max(range.start.line, range.end.line);

    const outdentedLines = lines.map((line, index) => {
      if (index >= startLine && index <= endLine) {
        const spacesToRemove = Math.min(tabSize, line.length - line.trimStart().length);
        return line.slice(spacesToRemove);
      }
      return line;
    });
    const outdentedContent = outdentedLines.join("\n");
    updateContent(outdentedContent);

    // Position cursor at start of deletion (or beginning of file)
    setCursorPosition({
      line: range.start.line,
      column: cursor.column,
      offset: range.start.offset,
    });

    return;
  },
};
