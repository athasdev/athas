export interface LineBasedSyntaxToken {
  start: number;
  end: number;
  class_name: string;
}

interface LineRange {
  startLine: number;
  endLine: number;
}

const LINE_BASED_LANGUAGE_IDS = new Set(["gitignore", "gitattributes", "lockfile"]);

export function hasLineBasedSyntaxHighlighter(languageId: string | null | undefined): boolean {
  return Boolean(languageId && LINE_BASED_LANGUAGE_IDS.has(languageId));
}

function pushToken(
  tokens: LineBasedSyntaxToken[],
  start: number,
  end: number,
  className: string,
): void {
  if (end > start) {
    tokens.push({ start, end, class_name: className });
  }
}

function tokenizeGitIgnoreLine(
  tokens: LineBasedSyntaxToken[],
  line: string,
  lineStart: number,
): void {
  if (/^\s*#/.test(line)) {
    pushToken(tokens, lineStart, lineStart + line.length, "token-comment");
    return;
  }

  const patternStart = line.search(/\S/);
  if (patternStart < 0) return;

  let index = patternStart;
  if (line[index] === "!") {
    pushToken(tokens, lineStart + index, lineStart + index + 1, "token-keyword");
    index += 1;
  }

  let segmentStart: number | null = null;
  const flushSegment = () => {
    if (segmentStart !== null) {
      pushToken(tokens, lineStart + segmentStart, lineStart + index, "token-string");
      segmentStart = null;
    }
  };

  while (index < line.length) {
    const char = line[index];

    if (char === "\\" && index + 1 < line.length) {
      if (segmentStart === null) segmentStart = index;
      index += 2;
      continue;
    }

    if (char === "/" || char === "*" || char === "?" || char === "[" || char === "]") {
      flushSegment();
      pushToken(
        tokens,
        lineStart + index,
        lineStart + index + 1,
        char === "/" ? "token-punctuation" : "token-operator",
      );
      index += 1;
      continue;
    }

    if (segmentStart === null) segmentStart = index;
    index += 1;
  }

  flushSegment();
}

function tokenizeGitAttributesLine(
  tokens: LineBasedSyntaxToken[],
  line: string,
  lineStart: number,
): void {
  if (/^\s*#/.test(line)) {
    pushToken(tokens, lineStart, lineStart + line.length, "token-comment");
    return;
  }

  const trimmedStart = line.search(/\S/);
  if (trimmedStart < 0) return;

  const fields = line.matchAll(/\S+/g);
  let fieldIndex = 0;

  for (const field of fields) {
    const text = field[0];
    const start = field.index ?? 0;
    const absoluteStart = lineStart + start;
    const absoluteEnd = absoluteStart + text.length;

    if (fieldIndex === 0) {
      pushToken(
        tokens,
        absoluteStart,
        absoluteEnd,
        text.startsWith("[attr]") ? "token-attribute" : "token-string",
      );
      fieldIndex += 1;
      continue;
    }

    const operatorLength = text[0] === "-" || text[0] === "!" ? 1 : 0;
    if (operatorLength > 0) {
      pushToken(tokens, absoluteStart, absoluteStart + operatorLength, "token-operator");
    }

    const bodyStart = absoluteStart + operatorLength;
    const equalsIndex = text.indexOf("=", operatorLength);
    if (equalsIndex >= 0) {
      pushToken(tokens, bodyStart, absoluteStart + equalsIndex, "token-property");
      pushToken(
        tokens,
        absoluteStart + equalsIndex,
        absoluteStart + equalsIndex + 1,
        "token-operator",
      );
      pushToken(tokens, absoluteStart + equalsIndex + 1, absoluteEnd, "token-string");
    } else {
      pushToken(tokens, bodyStart, absoluteEnd, "token-property");
    }

    fieldIndex += 1;
  }
}

function tokenizeLockfileLine(
  tokens: LineBasedSyntaxToken[],
  line: string,
  lineStart: number,
): void {
  if (/^\s*#/.test(line)) {
    pushToken(tokens, lineStart, lineStart + line.length, "token-comment");
    return;
  }

  let keyRange: { start: number; end: number } | null = null;
  const keyMatch = line.match(/^(\s*)(("[^"]+"|'[^']+'|[^:\s][^:]*))(?=\s*:)/);
  if (keyMatch) {
    const start = keyMatch[1].length;
    const key = keyMatch[2];
    keyRange = { start, end: start + key.length };
    pushToken(tokens, lineStart + start, lineStart + start + key.length, "token-property");
  }

  for (const match of line.matchAll(/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (keyRange && start >= keyRange.start && end <= keyRange.end) continue;
    pushToken(tokens, lineStart + start, lineStart + start + match[0].length, "token-string");
  }

  for (const match of line.matchAll(/\b(true|false|null)\b/g)) {
    const start = match.index ?? 0;
    pushToken(tokens, lineStart + start, lineStart + start + match[0].length, "token-constant");
  }

  for (const match of line.matchAll(/\b\d+(\.\d+)?\b/g)) {
    const start = match.index ?? 0;
    pushToken(tokens, lineStart + start, lineStart + start + match[0].length, "token-number");
  }

  for (const match of line.matchAll(/[{}[\],:]/g)) {
    const start = match.index ?? 0;
    pushToken(tokens, lineStart + start, lineStart + start + 1, "token-punctuation");
  }
}

export function tokenizeLineBasedSyntax(
  content: string,
  languageId: string,
  range?: LineRange,
): LineBasedSyntaxToken[] {
  if (!hasLineBasedSyntaxHighlighter(languageId)) return [];

  const tokens: LineBasedSyntaxToken[] = [];
  const lines = content.split("\n");
  let offset = 0;
  const startLine = Math.max(0, range?.startLine ?? 0);
  const endLine = Math.min(lines.length - 1, range?.endLine ?? lines.length - 1);

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const line = lines[lineNumber] ?? "";

    if (lineNumber >= startLine && lineNumber <= endLine) {
      if (languageId === "gitignore") {
        tokenizeGitIgnoreLine(tokens, line, offset);
      } else if (languageId === "gitattributes") {
        tokenizeGitAttributesLine(tokens, line, offset);
      } else if (languageId === "lockfile") {
        tokenizeLockfileLine(tokens, line, offset);
      }
    }

    offset += line.length + 1;
  }

  return tokens;
}
