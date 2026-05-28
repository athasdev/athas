import { getLargeContentLineText, getLineSlice } from "./large-file";

export interface ResolveGoToLineTargetOptions {
  content: string;
  lineNumber: number;
  columnNumber?: number;
  lineCount: number;
  lineOffsets?: readonly number[];
}

export interface GoToLineTarget {
  line: number;
  column: number;
  offset: number;
}

export function resolveGoToLineTarget({
  content,
  lineNumber,
  columnNumber,
  lineCount,
  lineOffsets,
}: ResolveGoToLineTargetOptions): GoToLineTarget {
  const targetLine = Math.max(0, Math.min(lineNumber - 1, Math.max(0, lineCount - 1)));
  const targetLineOffset = lineOffsets?.[targetLine];
  const targetLineSlice =
    targetLineOffset != null && lineOffsets
      ? {
          line: getLargeContentLineText(content, lineOffsets, targetLine),
          offset: targetLineOffset,
        }
      : getLineSlice(content, targetLine);
  const column = Math.max(0, Math.min((columnNumber ?? 1) - 1, targetLineSlice.line.length));

  return {
    line: targetLine,
    column,
    offset: targetLineSlice.offset + column,
  };
}
