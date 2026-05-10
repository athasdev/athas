import type { QueryResult } from "../models/common.types";

function normalizePageSize(pageSize: number): number {
  if (!Number.isFinite(pageSize)) return 50;
  return Math.max(1, Math.min(Math.trunc(pageSize), 500));
}

export function parseQueryResultPageInput(pageInput: string, totalPages: number): number | null {
  const normalizedInput = pageInput.trim();
  if (!/^\d+$/.test(normalizedInput)) return null;
  const page = Number(normalizedInput);
  if (
    !Number.isSafeInteger(page) ||
    !Number.isFinite(totalPages) ||
    page < 1 ||
    page > Math.trunc(totalPages)
  ) {
    return null;
  }
  return page;
}

export function getQueryResultTotalPages(
  queryResult: QueryResult | null,
  pageSize: number,
): number {
  if (!queryResult) return 1;
  return Math.max(1, Math.ceil(queryResult.rows.length / normalizePageSize(pageSize)));
}

export function paginateQueryResult(
  queryResult: QueryResult,
  currentPage: number,
  pageSize: number,
): QueryResult {
  const safePageSize = normalizePageSize(pageSize);
  const totalPages = getQueryResultTotalPages(queryResult, safePageSize);
  const safePage = Number.isFinite(currentPage)
    ? Math.max(1, Math.min(Math.trunc(currentPage), totalPages))
    : 1;
  const start = (safePage - 1) * safePageSize;
  return {
    columns: queryResult.columns,
    rows: queryResult.rows.slice(start, start + safePageSize),
  };
}
