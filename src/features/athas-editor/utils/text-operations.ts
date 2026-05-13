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

function countLineBreaks(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index++) {
    if (text.charCodeAt(index) === 10) {
      count++;
    }
  }
  return count;
}

function indentBlock(block: string, indent: string): string {
  if (block.length === 0) return indent;

  let result = indent;
  for (let index = 0; index < block.length; index++) {
    const char = block[index];
    result += char;
    if (char === "\n" && index < block.length - 1) {
      result += indent;
    }
  }
  return result;
}

interface OutdentBlockResult {
  text: string;
  firstRemoval: number;
  totalRemoved: number;
}

function outdentBlock(block: string, tabSize: number): OutdentBlockResult {
  let result = "";
  let firstRemoval = 0;
  let totalRemoved = 0;
  let lineStart = 0;
  let lineIndex = 0;

  const appendLine = (lineEnd: number) => {
    const line = block.slice(lineStart, lineEnd);
    const removal = getOutdentLength(line, tabSize);
    if (lineIndex === 0) {
      firstRemoval = removal;
    }
    totalRemoved += removal;
    result += line.slice(removal);
    lineIndex++;
  };

  for (let index = 0; index < block.length; index++) {
    if (block.charCodeAt(index) !== 10) continue;
    appendLine(index);
    result += "\n";
    lineStart = index + 1;
  }

  appendLine(block.length);

  return { text: result, firstRemoval, totalRemoved };
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
  const selectedBlock = content.slice(lineStart, lineEnd);
  const indentedBlock = indentBlock(selectedBlock, indent);
  const lineCount = countLineBreaks(selectedBlock) + 1;
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
  const {
    text: outdentedBlock,
    firstRemoval,
    totalRemoved,
  } = outdentBlock(content.slice(lineStart, lineEnd), tabSize);
  const nextContent = content.slice(0, lineStart) + outdentedBlock + content.slice(lineEnd);
  const removedBeforeStart =
    selectionStart === selectionEnd
      ? Math.min(firstRemoval, Math.max(0, selectionStart - lineStart))
      : selectionStart === lineStart
        ? firstRemoval
        : 0;

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
