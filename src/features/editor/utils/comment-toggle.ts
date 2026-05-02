export interface ToggleLineCommentInput {
  content: string;
  selectionStart: number;
  selectionEnd: number;
  token?: string;
}

export interface ToggleLineCommentResult {
  content: string;
  selectionStart: number;
  selectionEnd: number;
}

interface TextEdit {
  start: number;
  end: number;
  text: string;
}

const LINE_COMMENT_TOKENS: Partial<Record<string, string>> = {
  bash: "#",
  c: "//",
  cpp: "//",
  csharp: "//",
  dart: "//",
  elixir: "#",
  go: "//",
  java: "//",
  javascript: "//",
  javascriptreact: "//",
  kotlin: "//",
  lua: "--",
  php: "//",
  python: "#",
  ruby: "#",
  rust: "//",
  scala: "//",
  shell: "#",
  sql: "--",
  swift: "//",
  toml: "#",
  typescript: "//",
  typescriptreact: "//",
  yaml: "#",
  zig: "//",
};

export function getLineCommentTokenForLanguage(languageId?: string | null): string {
  return (languageId && LINE_COMMENT_TOKENS[languageId]) || "//";
}

function getLineStart(content: string, offset: number): number {
  return content.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
}

function getLineEnd(content: string, offset: number): number {
  const lineEnd = content.indexOf("\n", offset);
  return lineEnd === -1 ? content.length : lineEnd;
}

function getNextLineStart(content: string, offset: number): number {
  const lineEnd = content.indexOf("\n", offset);
  return lineEnd === -1 ? content.length : lineEnd + 1;
}

function transformOffset(offset: number, edits: TextEdit[]): number {
  let nextOffset = offset;

  for (const edit of edits) {
    const oldLength = edit.end - edit.start;
    const delta = edit.text.length - oldLength;

    if (oldLength === 0) {
      if (offset >= edit.start) {
        nextOffset += delta;
      }
      continue;
    }

    if (offset > edit.end) {
      nextOffset += delta;
    } else if (offset >= edit.start) {
      nextOffset = edit.start;
    }
  }

  return Math.max(0, nextOffset);
}

function applyEdits(content: string, edits: TextEdit[]): string {
  let nextContent = content;

  for (const edit of [...edits].reverse()) {
    nextContent = nextContent.slice(0, edit.start) + edit.text + nextContent.slice(edit.end);
  }

  return nextContent;
}

export function toggleLineComment({
  content,
  selectionStart,
  selectionEnd,
  token = "//",
}: ToggleLineCommentInput): ToggleLineCommentResult {
  const start = Math.min(selectionStart, selectionEnd);
  const end = Math.max(selectionStart, selectionEnd);
  const effectiveEnd = end > start && content[end - 1] === "\n" ? end - 1 : end;
  const blockStart = getLineStart(content, start);
  const blockEnd = getLineEnd(content, effectiveEnd);
  const lineStarts: number[] = [];

  for (let offset = blockStart; offset <= blockEnd; offset = getNextLineStart(content, offset)) {
    lineStarts.push(offset);
    const nextLineStart = getNextLineStart(content, offset);
    if (nextLineStart <= offset || nextLineStart > blockEnd) break;
  }

  const commentableLines = lineStarts
    .map((lineStart) => {
      const lineEnd = getLineEnd(content, lineStart);
      const line = content.slice(lineStart, lineEnd);
      const indent = line.match(/^[\t ]*/)?.[0] ?? "";
      return { lineStart, lineEnd, line, indent };
    })
    .filter(({ line }) => line.trim().length > 0);

  if (commentableLines.length === 0) {
    return { content, selectionStart, selectionEnd };
  }

  const tokenPattern = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const commentPattern = new RegExp(`^([\\t ]*)${tokenPattern}(?: )?`);
  const shouldUncomment = commentableLines.every(({ line }) => commentPattern.test(line));

  const edits: TextEdit[] = commentableLines.map(({ lineStart, line, indent }) => {
    if (shouldUncomment) {
      const match = line.match(commentPattern);
      const removeStart = lineStart + (match?.[1].length ?? indent.length);
      const removeEnd = lineStart + (match?.[0].length ?? indent.length);
      return { start: removeStart, end: removeEnd, text: "" };
    }

    return {
      start: lineStart + indent.length,
      end: lineStart + indent.length,
      text: `${token} `,
    };
  });

  return {
    content: applyEdits(content, edits),
    selectionStart: transformOffset(selectionStart, edits),
    selectionEnd: transformOffset(selectionEnd, edits),
  };
}
