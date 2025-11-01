/**
 * Indent operator (d)
 */

import type { EditorContext, Operator, VimRange } from "../core/types";

/**
 * Indent operator - indents text in the given range
 */
export const indentOperator: Operator = {
  name: "indent",
  repeatable: true,
  entersInsertMode: false,

  execute: (range: VimRange, context: EditorContext): void => {
    const { lines, updateContent, setCursorPosition, cursor, tabSize } = context;
    const indentLevel = tabSize;

    console.log("Range:: ", range);
    // Handle linewise indent
    const startLine = Math.min(range.start.line, range.end.line);
    const endLine = Math.max(range.start.line, range.end.line);

    const indentedLines = lines.map((line, index) => {
      if (index >= startLine && index <= endLine) {
        return " ".repeat(tabSize * indentLevel) + line;
      }
      return line;
    });
    const indentedContent = indentedLines.join("\n");
    updateContent(indentedContent);

    // Position cursor at start of deletion (or beginning of file)
    setCursorPosition({
      line: range.start.line,
      column: cursor.column,
      offset: range.start.offset,
    });

    return;
  },
};
