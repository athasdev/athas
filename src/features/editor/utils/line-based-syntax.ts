export interface LineBasedSyntaxToken {
  start: number;
  end: number;
  class_name: string;
}

interface LineRange {
  startLine: number;
  endLine: number;
}

const LINE_BASED_LANGUAGE_IDS = new Set(["diff", "gitignore", "gitattributes", "lockfile"]);
const LINE_BASED_FALLBACK_LANGUAGE_IDS = new Set([
  ...LINE_BASED_LANGUAGE_IDS,
  "typescriptreact",
  "zig",
  "elm",
  "elisp",
]);

export function hasLineBasedSyntaxHighlighter(languageId: string | null | undefined): boolean {
  return Boolean(languageId && LINE_BASED_LANGUAGE_IDS.has(languageId));
}

export function hasLineBasedSyntaxFallback(languageId: string | null | undefined): boolean {
  return Boolean(languageId && LINE_BASED_FALLBACK_LANGUAGE_IDS.has(languageId));
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

function tokenizePatterns(
  tokens: LineBasedSyntaxToken[],
  line: string,
  lineStart: number,
  patterns: Array<[RegExp, string]>,
): void {
  for (const [pattern, className] of patterns) {
    for (const match of line.matchAll(pattern)) {
      const start = match.index ?? 0;
      pushToken(tokens, lineStart + start, lineStart + start + match[0].length, className);
    }
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

function tokenizeDiffLine(tokens: LineBasedSyntaxToken[], line: string, lineStart: number): void {
  if (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("new file mode ") ||
    line.startsWith("deleted file mode ") ||
    line.startsWith("rename from ") ||
    line.startsWith("rename to ") ||
    line.startsWith("similarity index ") ||
    line.startsWith("dissimilarity index ") ||
    line.startsWith("Binary files ")
  ) {
    pushToken(tokens, lineStart, lineStart + line.length, "token-keyword");
    return;
  }

  if (line.startsWith("@@")) {
    pushToken(tokens, lineStart, lineStart + line.length, "token-attribute");
    return;
  }

  if (line.startsWith("+++ ")) {
    pushToken(tokens, lineStart, lineStart + line.length, "token-string");
    return;
  }

  if (line.startsWith("--- ")) {
    pushToken(tokens, lineStart, lineStart + line.length, "token-variable");
    return;
  }

  if (line.startsWith("+")) {
    pushToken(tokens, lineStart, lineStart + line.length, "token-string");
    return;
  }

  if (line.startsWith("-")) {
    pushToken(tokens, lineStart, lineStart + line.length, "token-variable");
  }
}

function tokenizeTypeScriptReactLine(
  tokens: LineBasedSyntaxToken[],
  line: string,
  lineStart: number,
): void {
  const commentStart = line.indexOf("//");
  if (commentStart >= 0) {
    pushToken(tokens, lineStart + commentStart, lineStart + line.length, "token-comment");
  }

  tokenizePatterns(tokens, line, lineStart, [
    [/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'|`([^`\\]|\\.)*`/g, "token-string"],
    [/<\/?[A-Za-z][\w.]*/g, "token-tag"],
    [/\s+[A-Za-z_][\w-]*(?==)/g, "token-attribute"],
    [
      /\b(abstract|as|async|await|break|case|catch|class|const|continue|debugger|declare|default|delete|do|else|enum|export|extends|finally|for|from|function|if|implements|import|in|infer|instanceof|interface|is|keyof|let|module|namespace|new|of|package|private|protected|public|readonly|return|satisfies|static|super|switch|this|throw|try|type|typeof|var|void|while|with|yield)\b/g,
      "token-keyword",
    ],
    [
      /\b(string|number|boolean|unknown|never|any|object|symbol|bigint|null|undefined)\b/g,
      "token-type",
    ],
    [/\b(true|false|null|undefined)\b/g, "token-constant"],
    [/\b\d+(\.\d+)?\b/g, "token-number"],
  ]);
}

function tokenizeZigLine(tokens: LineBasedSyntaxToken[], line: string, lineStart: number): void {
  const commentStart = line.indexOf("//");
  if (commentStart >= 0) {
    pushToken(tokens, lineStart + commentStart, lineStart + line.length, "token-comment");
  }

  tokenizePatterns(tokens, line, lineStart, [
    [/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/g, "token-string"],
    [
      /\b(addrspace|align|allowzero|and|anyframe|anytype|asm|async|await|break|callconv|catch|comptime|const|continue|defer|else|enum|errdefer|error|export|extern|fn|for|if|inline|linksection|noalias|noinline|nosuspend|opaque|or|orelse|packed|pub|resume|return|struct|suspend|switch|test|threadlocal|try|union|unreachable|usingnamespace|var|volatile|while)\b/g,
      "token-keyword",
    ],
    [/\b(true|false|null|undefined)\b/g, "token-constant"],
    [
      /\b[ui](8|16|32|64|128|size)\b|\b(f16|f32|f64|f80|f128|bool|void|noreturn|type|anyerror|comptime_int|comptime_float)\b/g,
      "token-type",
    ],
    [/@[A-Za-z_][\w]*/g, "token-function"],
    [/\b0x[0-9a-fA-F_]+\b|\b\d[\d_]*(\.\d[\d_]*)?\b/g, "token-number"],
  ]);
}

function tokenizeElmLine(tokens: LineBasedSyntaxToken[], line: string, lineStart: number): void {
  const commentStart = line.indexOf("--");
  if (commentStart >= 0) {
    pushToken(tokens, lineStart + commentStart, lineStart + line.length, "token-comment");
  }

  tokenizePatterns(tokens, line, lineStart, [
    [/"([^"\\]|\\.)*"|'([^'\\]|\\.)*'/g, "token-string"],
    [
      /\b(alias|as|case|else|exposing|if|import|in|infix|let|module|of|port|then|type|where)\b/g,
      "token-keyword",
    ],
    [/\b(True|False)\b/g, "token-constant"],
    [/\b[A-Z][\w']*/g, "token-type"],
    [/\b[a-z_][\w']*(?=\s*=)/g, "token-function"],
    [/\b\d+(\.\d+)?\b/g, "token-number"],
  ]);
}

function tokenizeElispLine(tokens: LineBasedSyntaxToken[], line: string, lineStart: number): void {
  const commentStart = line.indexOf(";");
  if (commentStart >= 0) {
    pushToken(tokens, lineStart + commentStart, lineStart + line.length, "token-comment");
  }

  tokenizePatterns(tokens, line, lineStart, [
    [/"([^"\\]|\\.)*"/g, "token-string"],
    [
      /\b(defun|defmacro|defvar|defcustom|defgroup|defconst|let|let\*|lambda|if|when|unless|cond|pcase|progn|save-excursion|interactive|setq|setq-local|require|provide|use-package)\b/g,
      "token-keyword",
    ],
    [/\b(nil|t)\b/g, "token-constant"],
    [/:[A-Za-z0-9_-]+/g, "token-type"],
    [/\b\d+(\.\d+)?\b/g, "token-number"],
    [/[()'`,#]/g, "token-punctuation"],
  ]);
}

export function tokenizeLineBasedSyntax(
  content: string,
  languageId: string,
  range?: LineRange,
): LineBasedSyntaxToken[] {
  if (!hasLineBasedSyntaxFallback(languageId)) return [];

  const tokens: LineBasedSyntaxToken[] = [];
  const lines = content.split("\n");
  let offset = 0;
  const startLine = Math.max(0, range?.startLine ?? 0);
  const endLine = Math.min(lines.length - 1, range?.endLine ?? lines.length - 1);

  for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
    const line = lines[lineNumber] ?? "";

    if (lineNumber >= startLine && lineNumber <= endLine) {
      if (languageId === "diff") {
        tokenizeDiffLine(tokens, line, offset);
      } else if (languageId === "gitignore") {
        tokenizeGitIgnoreLine(tokens, line, offset);
      } else if (languageId === "gitattributes") {
        tokenizeGitAttributesLine(tokens, line, offset);
      } else if (languageId === "lockfile") {
        tokenizeLockfileLine(tokens, line, offset);
      } else if (languageId === "typescriptreact") {
        tokenizeTypeScriptReactLine(tokens, line, offset);
      } else if (languageId === "zig") {
        tokenizeZigLine(tokens, line, offset);
      } else if (languageId === "elm") {
        tokenizeElmLine(tokens, line, offset);
      } else if (languageId === "elisp") {
        tokenizeElispLine(tokens, line, offset);
      }
    }

    offset += line.length + 1;
  }

  return tokens.sort((a, b) => a.start - b.start || a.end - b.end);
}
