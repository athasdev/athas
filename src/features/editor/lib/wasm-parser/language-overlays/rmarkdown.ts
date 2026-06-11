import type { HighlightToken } from "../../../types/wasm-parser/wasm-parser.types";

function lineOffsets(content: string): number[] {
  const offsets = [0];
  for (let index = 0; index < content.length; index++) {
    if (content[index] === "\n") {
      offsets.push(index + 1);
    }
  }
  return offsets;
}

function offsetToPosition(offset: number, offsets: number[]): { row: number; column: number } {
  let low = 0;
  let high = offsets.length - 1;
  let row = 0;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    if (offsets[mid] <= offset) {
      row = mid;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return {
    row,
    column: Math.max(0, offset - (offsets[row] ?? 0)),
  };
}

function pushToken(
  tokens: HighlightToken[],
  content: string,
  offsets: number[],
  startIndex: number,
  endIndex: number,
  type: string,
) {
  if (endIndex <= startIndex || startIndex < 0 || endIndex > content.length) {
    return;
  }

  tokens.push({
    type,
    startIndex,
    endIndex,
    startPosition: offsetToPosition(startIndex, offsets),
    endPosition: offsetToPosition(endIndex, offsets),
  });
}

export function rmarkdownTokens(content: string): HighlightToken[] {
  const frontMatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/);
  if (!frontMatter) return [];

  const offsets = lineOffsets(content);
  const tokens: HighlightToken[] = [];
  const frontMatterText = frontMatter[0];
  const bodyStart = frontMatter[0].indexOf(frontMatter[1]);
  const closingFenceStart = frontMatterText.lastIndexOf("---");

  pushToken(tokens, content, offsets, 0, 3, "token-punctuation");
  pushToken(
    tokens,
    content,
    offsets,
    closingFenceStart,
    closingFenceStart + 3,
    "token-punctuation",
  );

  for (const match of frontMatter[1].matchAll(/^(\s*)([A-Za-z0-9_.-]+)(\s*:\s*)(.*)$/gm)) {
    const lineStart = bodyStart + (match.index ?? 0);
    const keyStart = lineStart + match[1].length;
    const keyEnd = keyStart + match[2].length;
    const delimiterStart = keyEnd;
    const delimiterEnd = delimiterStart + match[3].length;
    const valueStart = delimiterEnd;
    const valueEnd = lineStart + match[0].length;
    const value = match[4].trim();

    pushToken(tokens, content, offsets, keyStart, keyEnd, "token-property");
    pushToken(tokens, content, offsets, delimiterStart, delimiterEnd, "token-punctuation");

    if (value.length > 0) {
      const type = /^(true|false|null|yes|no)$/i.test(value)
        ? "token-constant"
        : /^-?\d+(\.\d+)?$/.test(value)
          ? "token-number"
          : "token-string";
      pushToken(tokens, content, offsets, valueStart, valueEnd, type);
    }
  }

  for (const match of frontMatter[1].matchAll(/^\s*-\s+/gm)) {
    const start = bodyStart + (match.index ?? 0) + match[0].lastIndexOf("-");
    pushToken(tokens, content, offsets, start, start + 1, "token-punctuation");
  }

  return tokens;
}
