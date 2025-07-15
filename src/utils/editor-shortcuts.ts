// Editor shortcut utilities

export function getCurrentLine(
  text: string,
  position: number,
): { start: number; end: number; content: string } {
  const lines = text.split("\n");
  let currentPos = 0;

  for (let i = 0; i < lines.length; i++) {
    const lineLength = lines[i].length;
    if (position <= currentPos + lineLength) {
      return {
        start: currentPos,
        end: currentPos + lineLength,
        content: lines[i],
      };
    }
    currentPos += lineLength + 1; // +1 for newline
  }

  return { start: 0, end: 0, content: "" };
}

export function getLineAtPosition(text: string, position: number): number {
  const textBeforePosition = text.substring(0, position);
  return textBeforePosition.split("\n").length - 1;
}

export function duplicateLine(
  text: string,
  position: number,
): { newText: string; newPosition: number } {
  const line = getCurrentLine(text, position);
  const lineText = line.content;
  const beforeLine = text.substring(0, line.end);
  const afterLine = text.substring(line.end);

  const newText = `${beforeLine}\n${lineText}${afterLine}`;
  const newPosition = line.end + lineText.length + 1;

  return { newText, newPosition };
}

export function moveLine(
  text: string,
  position: number,
  direction: "up" | "down",
): { newText: string; newPosition: number } {
  const lines = text.split("\n");
  const currentLineIndex = getLineAtPosition(text, position);

  if (
    (direction === "up" && currentLineIndex === 0) ||
    (direction === "down" && currentLineIndex === lines.length - 1)
  ) {
    return { newText: text, newPosition: position };
  }

  const targetIndex = direction === "up" ? currentLineIndex - 1 : currentLineIndex + 1;

  // Swap lines
  [lines[currentLineIndex], lines[targetIndex]] = [lines[targetIndex], lines[currentLineIndex]];

  const newText = lines.join("\n");

  // Calculate new cursor position
  let newLineStart = 0;
  for (let i = 0; i < targetIndex; i++) {
    newLineStart += lines[i].length + 1;
  }

  const lineOffset = position - getCurrentLine(text, position).start;
  const newPosition = newLineStart + Math.min(lineOffset, lines[targetIndex].length);

  return { newText, newPosition };
}

export function deleteLine(
  text: string,
  position: number,
): { newText: string; newPosition: number } {
  const lines = text.split("\n");
  const currentLineIndex = getLineAtPosition(text, position);

  if (lines.length === 1) {
    return { newText: "", newPosition: 0 };
  }

  lines.splice(currentLineIndex, 1);
  const newText = lines.join("\n");

  // Calculate new cursor position
  let newPosition = 0;
  for (let i = 0; i < Math.min(currentLineIndex, lines.length); i++) {
    newPosition += lines[i].length + 1;
  }

  return { newText, newPosition: Math.max(0, newPosition - 1) };
}

export function toggleComment(
  text: string,
  position: number,
  language: string,
): { newText: string; newPosition: number } {
  const commentSymbols: Record<string, string> = {
    javascript: "//",
    typescript: "//",
    javascriptreact: "//",
    typescriptreact: "//",
    python: "#",
    ruby: "#",
    shell: "#",
    bash: "#",
    css: "/*",
    scss: "//",
    html: "<!--",
    xml: "<!--",
    java: "//",
    c: "//",
    cpp: "//",
    csharp: "//",
    go: "//",
    rust: "//",
    php: "//",
    sql: "--",
    yaml: "#",
    toml: "#",
    json: "//", // JSON doesn't support comments, but we'll use // for convenience
  };

  const symbol = commentSymbols[language] || "//";
  const line = getCurrentLine(text, position);
  const lineContent = line.content;
  const trimmedLine = lineContent.trim();

  let newLineContent: string;
  let positionAdjustment = 0;

  if (trimmedLine.startsWith(symbol)) {
    // Remove comment
    const afterSymbol = lineContent.substring(lineContent.indexOf(symbol) + symbol.length);
    const leadingSpaces = lineContent.match(/^\s*/)?.[0] || "";
    newLineContent = leadingSpaces + afterSymbol.replace(/^\s/, ""); // Remove one space after symbol if present
    positionAdjustment = -(symbol.length + (afterSymbol.startsWith(" ") ? 1 : 0));
  } else {
    // Add comment
    const leadingSpaces = lineContent.match(/^\s*/)?.[0] || "";
    const contentAfterSpaces = lineContent.substring(leadingSpaces.length);
    newLineContent = `${leadingSpaces + symbol} ${contentAfterSpaces}`;
    positionAdjustment = symbol.length + 1;
  }

  const beforeLine = text.substring(0, line.start);
  const afterLine = text.substring(line.end);
  const newText = beforeLine + newLineContent + afterLine;

  // Adjust cursor position
  const newPosition = Math.max(line.start, position + positionAdjustment);

  return { newText, newPosition };
}

export function selectWord(
  text: string,
  position: number,
): { start: number; end: number; word: string } {
  const wordRegex = /[\w$]+/g;
  let match: RegExpExecArray | null;

  match = wordRegex.exec(text);
  while (match !== null) {
    if (match.index <= position && position <= match.index + match[0].length) {
      return {
        start: match.index,
        end: match.index + match[0].length,
        word: match[0],
      };
    }
    match = wordRegex.exec(text);
  }

  // If no word found, select current position
  return { start: position, end: position, word: "" };
}

export function indentSelection(
  text: string,
  selectionStart: number,
  selectionEnd: number,
  indent: boolean = true,
): { newText: string; newSelectionStart: number; newSelectionEnd: number } {
  const indentSize = 2; // You can make this configurable
  const indentString = " ".repeat(indentSize);

  // Get all lines in selection
  const beforeSelection = text.substring(0, selectionStart);
  const afterSelection = text.substring(selectionEnd);

  // Find the start of the first line in selection
  const lineStartIndex = beforeSelection.lastIndexOf("\n") + 1;
  const extendedSelectionStart = lineStartIndex;

  // Find the end of the last line in selection
  let extendedSelectionEnd = selectionEnd;
  const nextNewline = afterSelection.indexOf("\n");
  if (nextNewline !== -1 && selectionEnd > selectionStart) {
    // Only extend if we have a selection, not just a cursor
    const lastSelectedChar = text[selectionEnd - 1];
    if (lastSelectedChar === "\n") {
      extendedSelectionEnd = selectionEnd - 1;
    }
  }

  const extendedSelection = text.substring(extendedSelectionStart, extendedSelectionEnd);
  const lines = extendedSelection.split("\n");

  let modifiedLines: string[];
  let totalChange = 0;

  if (indent) {
    // Add indentation
    modifiedLines = lines.map(line => {
      if (line.length > 0) {
        totalChange += indentSize;
        return indentString + line;
      }
      return line;
    });
  } else {
    // Remove indentation
    modifiedLines = lines.map(line => {
      const match = line.match(new RegExp(`^\\s{1,${indentSize}}`));
      if (match) {
        totalChange -= match[0].length;
        return line.substring(match[0].length);
      }
      return line;
    });
  }

  const newSelection = modifiedLines.join("\n");
  const newText =
    text.substring(0, extendedSelectionStart) + newSelection + text.substring(extendedSelectionEnd);

  // Adjust selection positions
  const firstLineChange = indent
    ? indentSize
    : -Math.min(indentSize, lines[0].match(/^\s*/)?.[0].length || 0);
  const newSelectionStart =
    selectionStart + (selectionStart === extendedSelectionStart ? 0 : firstLineChange);
  const newSelectionEnd = selectionEnd + totalChange;

  return { newText, newSelectionStart, newSelectionEnd };
}
