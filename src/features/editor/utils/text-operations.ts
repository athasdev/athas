export interface TextOperationResult {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

function getLineStart(content: string, offset: number): number {
  return content.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

function getLineEnd(content: string, offset: number): number {
  const nextLineBreak = content.indexOf("\n", offset);
  return nextLineBreak === -1 ? content.length : nextLineBreak;
}

function getSelectedLineRange(content: string, selectionStart: number, selectionEnd: number) {
  const lineStart = getLineStart(content, selectionStart);
  const adjustedSelectionEnd =
    selectionEnd > selectionStart && content[selectionEnd - 1] === "\n"
      ? selectionEnd - 1
      : selectionEnd;
  const lineEnd = getLineEnd(content, adjustedSelectionEnd);

  return { lineStart, lineEnd };
}

export function indentText(
  content: string,
  selectionStart: number,
  selectionEnd: number,
  indent: string,
): TextOperationResult {
  if (selectionStart === selectionEnd) {
    return {
      content: content.slice(0, selectionStart) + indent + content.slice(selectionEnd),
      selectionStart: selectionStart + indent.length,
      selectionEnd: selectionStart + indent.length,
    };
  }

  const { lineStart, lineEnd } = getSelectedLineRange(content, selectionStart, selectionEnd);
  const selectedLines = content.slice(lineStart, lineEnd).split("\n");
  const indentedBlock = selectedLines.map((line) => indent + line).join("\n");
  const lineCount = selectedLines.length;
  const nextContent = content.slice(0, lineStart) + indentedBlock + content.slice(lineEnd);

  return {
    content: nextContent,
    selectionStart: selectionStart + (selectionStart === lineStart ? indent.length : 0),
    selectionEnd: selectionEnd + indent.length * lineCount,
  };
}

function getOutdentLength(line: string, tabSize: number): number {
  if (line.startsWith("\t")) return 1;

  let spaces = 0;
  while (spaces < tabSize && line[spaces] === " ") {
    spaces++;
  }
  return spaces;
}

export function outdentText(
  content: string,
  selectionStart: number,
  selectionEnd: number,
  tabSize: number,
): TextOperationResult {
  const { lineStart, lineEnd } = getSelectedLineRange(content, selectionStart, selectionEnd);
  const selectedLines = content.slice(lineStart, lineEnd).split("\n");
  const removals = selectedLines.map((line) => getOutdentLength(line, tabSize));
  const outdentedBlock = selectedLines.map((line, index) => line.slice(removals[index])).join("\n");
  const nextContent = content.slice(0, lineStart) + outdentedBlock + content.slice(lineEnd);
  const removedBeforeStart =
    selectionStart === selectionEnd
      ? Math.min(removals[0] ?? 0, Math.max(0, selectionStart - lineStart))
      : selectionStart === lineStart
        ? (removals[0] ?? 0)
        : 0;
  const totalRemoved = removals.reduce((sum, value) => sum + value, 0);

  return {
    content: nextContent,
    selectionStart: Math.max(lineStart, selectionStart - removedBeforeStart),
    selectionEnd:
      selectionStart === selectionEnd
        ? Math.max(lineStart, selectionEnd - removedBeforeStart)
        : Math.max(lineStart, selectionEnd - totalRemoved),
  };
}

export function toggleCaseText(
  content: string,
  selectionStart: number,
  selectionEnd: number,
): TextOperationResult {
  if (selectionStart === selectionEnd) {
    return { content, selectionStart, selectionEnd };
  }

  const selectedText = content.slice(selectionStart, selectionEnd);
  const hasLowercase = selectedText !== selectedText.toUpperCase();
  const replacement = hasLowercase ? selectedText.toUpperCase() : selectedText.toLowerCase();

  return {
    content: content.slice(0, selectionStart) + replacement + content.slice(selectionEnd),
    selectionStart,
    selectionEnd,
  };
}
