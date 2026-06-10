import type { QueryResult } from "../types/common.types";

interface QueryResultExportFilenameOptions {
  isCustomQuery: boolean;
  selectedTable: string | null;
  page?: number;
  totalPages?: number;
  date?: Date;
}

function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '""';
  let text: string;
  if (typeof value === "object") {
    try {
      text = JSON.stringify(value);
    } catch {
      text = String(value);
    }
  } else {
    text = String(value);
  }
  return `"${text.replace(/"/g, '""')}"`;
}

function sanitizeExportBaseName(name: string): string {
  return (
    name
      .trim()
      .replace(/[^\w.-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || "result"
  );
}

function getExportPageSuffix(page: number | undefined, totalPages: number | undefined): string {
  if (
    page === undefined ||
    totalPages === undefined ||
    !Number.isFinite(page) ||
    !Number.isFinite(totalPages)
  )
    return "";

  const normalizedTotalPages = Math.max(1, Math.trunc(totalPages));
  if (normalizedTotalPages <= 1) return "";
  const normalizedPage = Math.max(1, Math.min(Math.trunc(page), normalizedTotalPages));
  return `_page_${normalizedPage}_of_${normalizedTotalPages}`;
}

function formatExportDate(date: Date): string {
  if (!Number.isFinite(date.getTime())) return "unknown-date";
  return date.toISOString().slice(0, 10);
}

export function serializeQueryResultToCsv(queryResult: QueryResult): string {
  const headers = uniqueColumnKeys(queryResult.columns).map(escapeCsvCell).join(",");
  const rows = queryResult.rows
    .map((row) =>
      queryResult.columns.map((_, columnIndex) => escapeCsvCell(row[columnIndex])).join(","),
    )
    .join("\n");

  return rows ? `${headers}\n${rows}` : headers;
}

function uniqueColumnKeys(columns: string[]): string[] {
  const seen = new Map<string, number>();

  return columns.map((column, index) => {
    const normalizedColumn = column.trim();
    const baseKey = normalizedColumn || `column_${index + 1}`;
    const count = seen.get(baseKey) ?? 0;
    seen.set(baseKey, count + 1);
    return count === 0 ? baseKey : `${baseKey}_${count + 1}`;
  });
}

export function queryResultRowsToObjects(queryResult: QueryResult): Record<string, unknown>[] {
  const columns = uniqueColumnKeys(queryResult.columns);

  return queryResult.rows.map((row) => {
    const obj: Record<string, unknown> = {};
    columns.forEach((column, index) => {
      obj[column] = row[index];
    });
    return obj;
  });
}

export function serializeQueryResultToJson(queryResult: QueryResult): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    queryResultRowsToObjects(queryResult),
    (_, value: unknown) => {
      if (typeof value === "bigint") return value.toString();
      if (value && typeof value === "object") {
        if (seen.has(value)) return "[Circular]";
        seen.add(value);
      }
      return value;
    },
    2,
  );
}

export function buildQueryResultExportFilename({
  isCustomQuery,
  selectedTable,
  page,
  totalPages,
  date = new Date(),
}: QueryResultExportFilenameOptions): string {
  const baseName = sanitizeExportBaseName(
    isCustomQuery ? "custom_query_result" : selectedTable || "result",
  );
  const pageSuffix = isCustomQuery ? getExportPageSuffix(page, totalPages) : "";
  return `${baseName}${pageSuffix}_${formatExportDate(date)}.csv`;
}
