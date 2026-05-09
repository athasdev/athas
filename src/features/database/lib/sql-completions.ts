import type { ColumnInfo, TableInfo } from "../models/common.types";

const SQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "ORDER BY",
  "GROUP BY",
  "HAVING",
  "LIMIT",
  "INSERT INTO",
  "UPDATE",
  "DELETE FROM",
  "CREATE TABLE",
  "ALTER TABLE",
  "DROP TABLE",
  "INNER JOIN",
  "FULL JOIN",
  "UNION",
  "UNION ALL",
  "WITH",
  "OFFSET",
  "DISTINCT",
  "RETURNING",
  "OVER",
  "PARTITION BY",
  "BETWEEN",
  "LIKE",
  "ILIKE",
  "IS NULL",
  "IS NOT NULL",
  "EXISTS",
  "CASE WHEN",
  "PRIMARY KEY",
  "FOREIGN KEY",
  "REFERENCES",
  "TRUE",
  "FALSE",
];

const SQL_FUNCTIONS = [
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "COALESCE",
  "LOWER",
  "ROW_NUMBER",
  "UPPER",
];

export interface SqlCompletionItem {
  value: string;
  label: string;
  detail: "keyword" | "function" | "table" | "column";
}

export interface SqlCompletionContext {
  tables: TableInfo[];
  columns: ColumnInfo[];
}

export interface SqlCompletionState {
  prefix: string;
  start: number;
  end: number;
  items: SqlCompletionItem[];
}

function getWordRange(value: string, cursor: number) {
  const safeCursor = Number.isFinite(cursor)
    ? Math.max(0, Math.min(Math.trunc(cursor), value.length))
    : 0;
  let start = safeCursor;
  let end = safeCursor;

  while (start > 0 && /[\w$]/.test(value[start - 1])) start -= 1;
  while (end < value.length && /[\w$]/.test(value[end])) end += 1;

  return { start, end, prefix: value.slice(start, safeCursor) };
}

function isCursorInsideSqlStringOrComment(value: string, cursor: number): boolean {
  const safeCursor = Number.isFinite(cursor)
    ? Math.max(0, Math.min(Math.trunc(cursor), value.length))
    : 0;

  let index = 0;
  while (index < safeCursor) {
    const nextTwoChars = value.slice(index, index + 2);

    if (nextTwoChars === "--") {
      const lineEnd = value.indexOf("\n", index + 2);
      const end = lineEnd === -1 ? value.length : lineEnd;
      if (safeCursor > index && safeCursor <= end) return true;
      index = end + 1;
      continue;
    }

    if (value[index] === "#") {
      const lineEnd = value.indexOf("\n", index + 1);
      const end = lineEnd === -1 ? value.length : lineEnd;
      if (safeCursor > index && safeCursor <= end) return true;
      index = end + 1;
      continue;
    }

    if (nextTwoChars === "/*") {
      const commentEnd = value.indexOf("*/", index + 2);
      const end = commentEnd === -1 ? value.length : commentEnd + 2;
      if (safeCursor > index && safeCursor <= end) return true;
      index = end;
      continue;
    }

    if (value[index] === "$") {
      const delimiter = value.slice(index).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/)?.[0];
      if (delimiter) {
        const closeIndex = value.indexOf(delimiter, index + delimiter.length);
        const end = closeIndex === -1 ? value.length : closeIndex + delimiter.length;
        if (safeCursor > index && safeCursor <= end) return true;
        index = end;
        continue;
      }
    }

    if (value[index] === "'") {
      let end = index + 1;
      while (end < value.length) {
        if (value[end] === "'" && value[end + 1] === "'") {
          end += 2;
          continue;
        }
        if (value[end] === "'") {
          end += 1;
          break;
        }
        end += 1;
      }
      if (safeCursor > index && safeCursor <= end) return true;
      index = end;
      continue;
    }

    if (value[index] === '"') {
      let end = index + 1;
      while (end < value.length) {
        if (value[end] === '"' && value[end + 1] === '"') {
          end += 2;
          continue;
        }
        if (value[end] === '"') {
          end += 1;
          break;
        }
        end += 1;
      }
      if (safeCursor > index && safeCursor <= end) return true;
      index = end;
      continue;
    }

    if (value[index] === "`") {
      let end = index + 1;
      while (end < value.length) {
        if (value[end] === "`" && value[end + 1] === "`") {
          end += 2;
          continue;
        }
        if (value[end] === "`") {
          end += 1;
          break;
        }
        end += 1;
      }
      if (safeCursor > index && safeCursor <= end) return true;
      index = end;
      continue;
    }

    index += 1;
  }

  return false;
}

function normalizeCompletionRange(value: string, state: Pick<SqlCompletionState, "start" | "end">) {
  const start = Number.isFinite(state.start)
    ? Math.max(0, Math.min(Math.trunc(state.start), value.length))
    : 0;
  const end = Number.isFinite(state.end)
    ? Math.max(0, Math.min(Math.trunc(state.end), value.length))
    : start;
  return {
    start: Math.min(start, end),
    end: Math.max(start, end),
  };
}

function uniqueCompletions(items: SqlCompletionItem[]): SqlCompletionItem[] {
  const seen = new Set<string>();
  const unique: SqlCompletionItem[] = [];
  for (const item of items) {
    const key = `${item.detail}:${item.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }
  return unique;
}

function isQueryableObject(table: TableInfo): boolean {
  const kind = table.kind ?? "table";
  return kind === "table" || kind === "view" || kind === "materialized_view";
}

export function getSqlCompletions(
  value: string,
  cursor: number,
  context: SqlCompletionContext,
): SqlCompletionState {
  if (isCursorInsideSqlStringOrComment(value, cursor)) {
    const { start, end, prefix } = getWordRange(value, cursor);
    return { prefix, start, end, items: [] };
  }

  const { start, end, prefix } = getWordRange(value, cursor);
  const normalizedPrefix = prefix.toLowerCase();
  const isMemberAccess = start > 0 && value[start - 1] === ".";
  if (!normalizedPrefix && !isMemberAccess) return { prefix, start, end, items: [] };

  const objectNames = context.tables.filter(isQueryableObject).map((table) => table.name);

  const items = uniqueCompletions(
    isMemberAccess
      ? context.columns.map((column) => ({
          value: column.name,
          label: column.name,
          detail: "column" as const,
        }))
      : [
          ...SQL_KEYWORDS.map((keyword) => ({
            value: keyword,
            label: keyword,
            detail: "keyword" as const,
          })),
          ...SQL_FUNCTIONS.map((sqlFunction) => ({
            value: sqlFunction,
            label: sqlFunction,
            detail: "function" as const,
          })),
          ...objectNames.map((table) => ({
            value: table,
            label: table,
            detail: "table" as const,
          })),
          ...context.columns.map((column) => ({
            value: column.name,
            label: column.name,
            detail: "column" as const,
          })),
        ],
  )
    .filter((item) => item.value.toLowerCase().startsWith(normalizedPrefix))
    .slice(0, 8);

  return { prefix, start, end, items };
}

export function applySqlCompletion(
  value: string,
  completion: SqlCompletionItem,
  state: Pick<SqlCompletionState, "start" | "end">,
): { value: string; cursor: number } {
  const range = normalizeCompletionRange(value, state);
  const nextValue = `${value.slice(0, range.start)}${completion.value}${value.slice(range.end)}`;
  return {
    value: nextValue,
    cursor: range.start + completion.value.length,
  };
}
