const BLOCK_COMMENT_LANGUAGES = new Set([
  "c",
  "cpp",
  "csharp",
  "css",
  "dart",
  "go",
  "java",
  "javascript",
  "javascriptreact",
  "php",
  "rust",
  "scala",
  "swift",
  "typescript",
  "typescriptreact",
]);

const LINE_COMMENT_TOKENS: Partial<Record<string, string>> = {
  bash: "#",
  c: "//",
  cpp: "//",
  csharp: "//",
  dart: "//",
  dotenv: "#",
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
  typescript: "//",
  typescriptreact: "//",
  yaml: "#",
  toml: "#",
  zig: "//",
};

export interface SmartEnterInsert {
  insertText: string;
  cursorOffset: number;
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isBlockCommentLanguage(languageId: string | null): boolean {
  return Boolean(languageId && BLOCK_COMMENT_LANGUAGES.has(languageId));
}

export function getLineCommentToken(languageId: string | null): string | null {
  if (!languageId) return null;
  return LINE_COMMENT_TOKENS[languageId] || null;
}

export function getCommentContinuation(
  languageId: string | null,
  linePrefix: string,
  lineSuffix: string,
): SmartEnterInsert | null {
  const indentMatch = linePrefix.match(/^[\t ]*/);
  const indent = indentMatch?.[0] ?? "";
  const trimmedPrefix = linePrefix.trimStart();
  const trimmedSuffix = lineSuffix.trim();

  if (isBlockCommentLanguage(languageId)) {
    const openingBlockMatch = trimmedPrefix.match(/^\/\*\*?(?:\s.*)?$/);
    const starLineMatch = trimmedPrefix.match(/^\*(?:\s.*)?$/);
    const isInlineBlockPair =
      (trimmedPrefix === "/*" || trimmedPrefix === "/**") &&
      (lineSuffix.startsWith(" */") || lineSuffix.startsWith("*/"));

    if (isInlineBlockPair) {
      const insertText = `\n${indent} * \n${indent}`;
      return {
        insertText,
        cursorOffset: insertText.length - (indent.length + 1),
      };
    }

    if (openingBlockMatch || starLineMatch) {
      const insertText = `\n${indent} * `;
      return {
        insertText,
        cursorOffset: insertText.length,
      };
    }
  }

  const lineCommentToken = getLineCommentToken(languageId);
  if (!lineCommentToken) {
    return null;
  }

  const lineCommentPattern = new RegExp(
    `^([\\t ]*)${escapeForRegex(lineCommentToken)}(?:\\s?(.*))?$`,
  );
  const lineCommentMatch = linePrefix.match(lineCommentPattern);
  if (!lineCommentMatch) {
    return null;
  }

  const commentIndent = lineCommentMatch[1] ?? indent;
  const commentBody = lineCommentMatch[2] ?? "";

  if (commentBody.length === 0 && trimmedSuffix.length === 0) {
    return null;
  }

  const insertText = `\n${commentIndent}${lineCommentToken} `;
  return {
    insertText,
    cursorOffset: insertText.length,
  };
}

export function getSmartEnterInsertText(
  lineText: string,
  column: number,
  languageId: string | null = null,
): SmartEnterInsert {
  const safeColumn = Math.max(0, Math.min(column, lineText.length));
  const prefix = lineText.slice(0, safeColumn);
  const suffix = lineText.slice(safeColumn);
  const commentContinuation = getCommentContinuation(languageId, prefix, suffix);
  if (commentContinuation) return commentContinuation;

  const insertText = getAutoIndentInsertText(lineText, column);
  return {
    insertText,
    cursorOffset: insertText.length,
  };
}

export function getBlockCommentExpansion(
  languageId: string | null,
  previousCharacter: string,
): SmartEnterInsert | null {
  if (previousCharacter !== "/" || !isBlockCommentLanguage(languageId)) {
    return null;
  }

  return {
    insertText: "* */",
    cursorOffset: 2,
  };
}

export function getAutoIndentInsertText(lineText: string, column: number): string {
  const prefix = lineText.slice(0, Math.max(0, Math.min(column, lineText.length)));
  const indentMatch = prefix.match(/^[\t ]*/);
  return `\n${indentMatch?.[0] ?? ""}`;
}
