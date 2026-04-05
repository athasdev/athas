/**
 * Case operators (gu, gU)
 *
 * gu + motion: lowercase text in range
 * gU + motion: uppercase text in range
 */

import { calculateOffsetFromPosition } from "@/features/editor/utils/position";
import type { EditorContext, Operator, VimRange } from "../core/types";

const applyCaseTransform = (
  range: VimRange,
  context: EditorContext,
  transform: (text: string) => string,
): void => {
  const { content, lines, updateContent, setCursorPosition } = context;

  if (range.linewise) {
    const startLine = Math.min(range.start.line, range.end.line);
    const endLine = Math.max(range.start.line, range.end.line);

    const newLines = [...lines];
    for (let i = startLine; i <= endLine; i++) {
      newLines[i] = transform(newLines[i]);
    }

    updateContent(newLines.join("\n"));

    const newOffset = calculateOffsetFromPosition(startLine, 0, newLines);
    setCursorPosition({
      line: startLine,
      column: 0,
      offset: newOffset,
    });
    return;
  }

  const startOffset = Math.min(range.start.offset, range.end.offset);
  const endOffset = Math.max(range.start.offset, range.end.offset);
  const actualEndOffset = range.inclusive ? endOffset + 1 : endOffset;

  const before = content.slice(0, startOffset);
  const target = content.slice(startOffset, actualEndOffset);
  const after = content.slice(actualEndOffset);

  const newContent = before + transform(target) + after;
  updateContent(newContent);

  const newLines = newContent.split("\n");
  let line = 0;
  let offset = 0;
  for (let i = 0; i < newLines.length; i++) {
    if (offset + newLines[i].length >= startOffset) {
      line = i;
      break;
    }
    offset += newLines[i].length + 1;
  }

  const column = startOffset - offset;
  setCursorPosition({
    line,
    column: Math.max(0, column),
    offset: startOffset,
  });
};

export const lowercaseOperator: Operator = {
  name: "lowercase",
  repeatable: true,
  entersInsertMode: false,

  execute: (range: VimRange, context: EditorContext): void => {
    applyCaseTransform(range, context, (text) => text.toLowerCase());
  },
};

export const uppercaseOperator: Operator = {
  name: "uppercase",
  repeatable: true,
  entersInsertMode: false,

  execute: (range: VimRange, context: EditorContext): void => {
    applyCaseTransform(range, context, (text) => text.toUpperCase());
  },
};
