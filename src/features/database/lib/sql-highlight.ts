import type { Token } from "@/features/editor/utils/html";

export interface SqlHighlightSegment {
  text: string;
  className?: string;
}

const SQL_KEYWORDS = new Set([
  "add",
  "all",
  "alter",
  "and",
  "as",
  "asc",
  "between",
  "bigint",
  "boolean",
  "by",
  "case",
  "constraint",
  "create",
  "default",
  "delete",
  "desc",
  "distinct",
  "drop",
  "else",
  "end",
  "exists",
  "false",
  "foreign",
  "from",
  "full",
  "group",
  "having",
  "if",
  "ilike",
  "in",
  "index",
  "inner",
  "insert",
  "integer",
  "into",
  "is",
  "join",
  "json",
  "jsonb",
  "key",
  "left",
  "like",
  "limit",
  "not",
  "null",
  "offset",
  "on",
  "or",
  "order",
  "outer",
  "over",
  "partition",
  "primary",
  "references",
  "right",
  "returning",
  "select",
  "serial",
  "set",
  "table",
  "text",
  "then",
  "timestamp",
  "true",
  "union",
  "update",
  "uuid",
  "values",
  "varchar",
  "view",
  "when",
  "where",
  "with",
]);

const SQL_FUNCTIONS = new Set([
  "avg",
  "coalesce",
  "count",
  "gen_random_uuid",
  "lower",
  "max",
  "min",
  "row_number",
  "sum",
  "upper",
]);

function buildFallbackSqlTokens(value: string): Token[] {
  const tokens: Token[] = [];
  const pattern =
    /--[^\n]*|#[^\n]*|\/\*[\s\S]*?(?:\*\/|$)|'(?:''|[^'])*(?:'|$)|"(?:[^"]|"")*(?:"|$)|`(?:``|[^`])*(?:`|$)|\$\$[\s\S]*?(?:\$\$|$)|\$([A-Za-z_][A-Za-z0-9_]*)\$[\s\S]*?(?:\$\1\$|$)|::|<>|!=|<=|>=|->>|->|\|\||[=<>+\-*/%]|\$[0-9]+|[:@][A-Za-z_][A-Za-z0-9_]*|\?|\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b|\b[A-Za-z_][A-Za-z0-9_]*\b/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(value))) {
    const text = match[0];
    const lower = text.toLowerCase();
    let className: string | undefined;

    if (text.startsWith("--") || text.startsWith("#") || text.startsWith("/*")) {
      className = "token-comment";
    } else if (text.startsWith("'") || /^(?:\$[A-Za-z_][A-Za-z0-9_]*\$|\$\$)/.test(text)) {
      className = "token-string";
    } else if (/^(?:::|<>|!=|<=|>=|->>|->|\|\||[=<>+\-*/%])$/.test(text)) {
      className = "token-operator";
    } else if (
      text === "?" ||
      text.startsWith("$") ||
      text.startsWith("@") ||
      (text.startsWith(":") && value[match.index - 1] !== ":")
    ) {
      className = "token-variable";
    } else if (/^\d/.test(text)) {
      className = "token-number";
    } else if (SQL_FUNCTIONS.has(lower) && /^\s*\(/.test(value.slice(pattern.lastIndex))) {
      className = "token-function";
    } else if (SQL_KEYWORDS.has(lower)) {
      className = "token-keyword";
    }

    if (className) {
      tokens.push({ start: match.index, end: match.index + text.length, class_name: className });
    }
  }

  return tokens;
}

export function buildSqlHighlightSegments(value: string, tokens: Token[]): SqlHighlightSegment[] {
  const segments: SqlHighlightSegment[] = [];
  const sourceTokens = tokens.length > 0 ? tokens : buildFallbackSqlTokens(value);
  const sortedTokens = sourceTokens
    .filter(
      (token) =>
        Number.isFinite(token.start) && Number.isFinite(token.end) && token.end > token.start,
    )
    .sort((a, b) => a.start - b.start || b.end - a.end);
  let cursor = 0;

  for (const token of sortedTokens) {
    if (token.end <= cursor || token.start >= value.length) continue;

    const start = Math.max(cursor, token.start);
    const end = Math.min(value.length, token.end);

    if (start > cursor) {
      segments.push({ text: value.slice(cursor, start) });
    }

    segments.push({
      text: value.slice(start, end),
      className: token.class_name,
    });
    cursor = end;
  }

  if (cursor < value.length) {
    segments.push({ text: value.slice(cursor) });
  }

  return segments.length > 0 ? segments : [{ text: " " }];
}
