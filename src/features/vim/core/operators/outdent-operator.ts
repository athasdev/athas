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
    const outdentLevel = tabSize;

    // Handle linewise outdent
    const startLine = Math.min(range.start.line, range.end.line);
    const endLine = Math.max(range.start.line, range.end.line);

    const outdentedLines = lines.map((line, index) => {
      if (index >= startLine && index <= endLine) {
        let resultLine = line;
        // Remove up to 4 spaces per outdent level
        for (let i = 0; i < outdentLevel; i++) {
          resultLine = resultLine.replace(/^ {1,4}/, "");
        }
        return resultLine;
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
