/** Line lookups that scan only as far as the requested line, for very long documents. */

export function getLineSlice(content: string, lineIndex: number): { line: string; offset: number } {
  const targetLine = Math.max(0, lineIndex);

  let currentLine = 0;
  let lineStart = 0;

  const buildResult = (lineEnd: number) => {
    const end =
      lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
    return {
      line: content.slice(lineStart, end),
      offset: lineStart,
    };
  };

  for (let index = 0; index < content.length; index++) {
    if (content.charCodeAt(index) !== 10) continue;

    if (currentLine === targetLine) {
      return buildResult(index);
    }

    currentLine++;
    lineStart = index + 1;
  }

  if (currentLine === targetLine) {
    return buildResult(content.length);
  }

  return {
    line: "",
    offset: content.length,
  };
}
